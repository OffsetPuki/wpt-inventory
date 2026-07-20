import type { Express } from "express";
import fs from "fs";
import path from "path";
import { sqlite } from "./storage";
import { requireElevated } from "./auth";
import { mailEnabled, sendMail, sendOwnerMail } from "./mailer";
// Leaf module like mailer — snapshot/rotation mechanics live there, the
// scheduling (nightly + weekly offsite, steps 21/21b) lives here.
import { maybeNightlyBackup, latestSnapshot } from "./backup";
// Deliberate exception to this module's no-imports stance (Phase B #9): the
// email-activity logger lives with the crm_activities table it writes, is
// deferred + try/catch'd internally, and every mail this sweep sends should
// land on the customer's timeline.
import { logEmailActivity } from "./crm";

// ─── Business automations ────────────────────────────────────────────────────
// Hourly cross-module sweep (plus one on boot), same shape as
// startMarketingAutomations in marketing.ts: chases money, nudges customers,
// expires stale paperwork, and sends the daily owner digest. Raw sqlite on
// purpose — this module reads a dozen other modules' tables and shouldn't
// import any of them. Every step runs in its own try/catch so one broken
// table never kills the rest of the sweep.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://www.cjmmetals.com";

// ─── Additive migrations (import time) ───────────────────────────────────────
// Columns this sweep stamps on tables owned by other modules — added here with
// the same try/catch ALTER pattern as quotes.ts so their files stay untouched.
// index.ts imports ./routes (→ every module's DDL) before this module, so the
// tables already exist when these run.
for (const ddl of [
  "ALTER TABLE fin_invoices ADD COLUMN reminded_at INTEGER", // last chase email, unix ms
  "ALTER TABLE quotes ADD COLUMN nudge_sent_at INTEGER", // one-shot customer nudge, unix ms
  "ALTER TABLE hr_attendance ADD COLUMN overdue_notified_at INTEGER", // clock-out nag, unix ms
  "ALTER TABLE mk_settings ADD COLUMN lead_time_updated_at INTEGER", // stamped on settings save
  "ALTER TABLE mk_settings ADD COLUMN last_digest_date TEXT", // 'YYYY-MM-DD' of last owner digest
  "ALTER TABLE mk_settings ADD COLUMN last_backup_week TEXT", // 'YYYY-WW' of last weekly offsite email/reminder
]) {
  try {
    sqlite.exec(ddl);
  } catch {
    /* column already exists */
  }
}

// ─── Small helpers ───────────────────────────────────────────────────────────

// Local calendar date — same reasoning as finance.ts: "overdue" flips at the
// shop's midnight, not UTC's.
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ISO week key ("2026-29") for the weekly offsite-backup dedupe.
function isoWeek(ms: number): string {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // the Thursday of this week
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-${String(week).padStart(2, "0")}`;
}

// Whole dollars when clean, cents otherwise (same as marketing.ts).
function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

// hasOpenTask-style dedupe, mirroring marketing.ts. Its sweep keys open tasks
// by lead_id; these subjects span invoices/POs/items/contracts, so the stable
// key rides in notes instead. Returns true when a task was actually created.
// ponytail: open-only check like marketing's — a done/dismissed task whose
// condition persists gets re-created next sweep; check all statuses if it nags.
function ensureTask(
  key: string,
  title: string,
  kind = "other",
  leadId: number | null = null,
  projectId: number | null = null, // Phase D #20: surfaces the task on the job hub
): boolean {
  const open = sqlite.prepare(
    "SELECT id FROM mk_tasks WHERE status = 'open' AND notes = ?",
  ).get(key);
  if (open) return false;
  sqlite.prepare(`
    INSERT INTO mk_tasks (title, kind, lead_id, project_id, status, auto_created, due_at, notes)
    VALUES (?, ?, ?, ?, 'open', 1, ?, ?)
  `).run(title, kind, leadId, projectId, Date.now(), key);
  return true;
}

// One failing step must never kill the rest of the sweep.
function step(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`[automations] ${name} failed`, e);
  }
}

interface SweepSettings {
  quote_follow_up_days: number;
  lead_time_weeks: number | null;
  lead_time_updated_at: number | null;
  last_digest_date: string | null;
  last_backup_week: string | null;
}

function getSettings(): SweepSettings {
  try {
    const row = sqlite.prepare(`
      SELECT quote_follow_up_days, lead_time_weeks, lead_time_updated_at, last_digest_date, last_backup_week
      FROM mk_settings WHERE id = 1
    `).get() as SweepSettings | undefined;
    if (row) return row;
  } catch {
    /* mk_settings not migrated yet — fall through to defaults */
  }
  return { quote_follow_up_days: 3, lead_time_weeks: null, lead_time_updated_at: null, last_digest_date: null, last_backup_week: null };
}

// ─── The sweep ───────────────────────────────────────────────────────────────

function runBusinessSweep(): void {
  const now = Date.now();
  const today = localDate(now);
  const cfg = getSettings();

  // 1. Overdue invoice chase — email the client (re-remind every 7 days), or
  // queue a task when there's no address on file.
  step("invoice chase", () => {
    const rows = sqlite.prepare(`
      SELECT i.id, i.number, i.due_date, i.reminded_at, i.client_id, i.lead_id,
             i.total_cents - i.paid_cents AS balance,
             c.name AS client_name, c.email
      FROM fin_invoices i LEFT JOIN crm_clients c ON c.id = i.client_id
      WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue')
        AND i.due_date IS NOT NULL AND i.due_date < ?
        AND i.total_cents - i.paid_cents > 0
    `).all(today) as any[];
    for (const inv of rows) {
      if (inv.email && mailEnabled()) {
        if (inv.reminded_at != null && inv.reminded_at > now - 7 * DAY_MS) continue;
        setImmediate(async () => {
          const first = String(inv.client_name ?? "").trim().split(/\s+/)[0] || "there";
          const ok = await sendMail({
            to: inv.email,
            subject: `Friendly reminder — invoice ${inv.number} — CJM Metals`,
            text:
              `Hi ${first},\n\n` +
              `Just a friendly reminder that invoice ${inv.number} has an outstanding ` +
              `balance of ${fmtUsd(inv.balance)} (it was due ${inv.due_date}). If you've ` +
              `already sent payment, please disregard this note.\n\n` +
              `Questions? Just reply to this email or give us a call.\n\n` +
              `— CJM Metals · Arlington, TX`,
          });
          if (ok) {
            sqlite.prepare("UPDATE fin_invoices SET reminded_at = ? WHERE id = ?")
              .run(Date.now(), inv.id);
            logEmailActivity({
              clientId: inv.client_id, leadId: inv.lead_id,
              subject: `Overdue reminder — ${inv.number}, ${fmtUsd(inv.balance)} outstanding`,
            });
          }
        });
      } else {
        // No address on file, or mailer unconfigured — either way, a task.
        ensureTask(`auto:invoice-chase:${inv.number}`,
          `Chase ${inv.number} — ${fmtUsd(inv.balance)} overdue`);
      }
    }
  });

  // 2. Quote Builder follow-up — sent, then silence past the configured window.
  step("quote follow-up", () => {
    const cutoff = now - cfg.quote_follow_up_days * DAY_MS;
    const rows = sqlite.prepare(`
      SELECT number, customer_name FROM quotes
      WHERE deleted_at IS NULL AND status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?
    `).all(cutoff) as any[];
    for (const q of rows) {
      ensureTask(`auto:quote-follow-up:${q.number}`,
        `Follow up on ${q.number} with ${q.customer_name || "the customer"}`, "quote_reminder");
    }
  });

  // 3. Customer quote nudge — once ever per quote, email them their share link.
  step("quote nudge", () => {
    if (!mailEnabled()) return;
    const cutoff = now - cfg.quote_follow_up_days * DAY_MS;
    const rows = sqlite.prepare(`
      SELECT id, number, customer_name, payload, design_ref, share_token FROM quotes
      WHERE deleted_at IS NULL AND status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?
        AND nudge_sent_at IS NULL AND share_token IS NOT NULL
    `).all(cutoff) as any[];
    for (const q of rows) {
      // Email: the builder's customer card (in the payload), else the website
      // design the quote was started from.
      let email: string | undefined;
      try {
        email = JSON.parse(q.payload)?.customer?.email || undefined;
      } catch {
        /* malformed payload — fall through to the design */
      }
      if (!email && q.design_ref) {
        const d = sqlite.prepare("SELECT email FROM web_designs WHERE upper(ref) = ?")
          .get(String(q.design_ref).toUpperCase()) as any;
        email = d?.email || undefined;
      }
      if (!email) continue;
      const url = `${PUBLIC_SITE_URL}/quote/${q.share_token}`;
      setImmediate(async () => {
        const ok = await sendMail({
          to: email!,
          subject: `Your quote from CJM Metals — ${q.number}`,
          text:
            `Hi ${q.customer_name || "there"},\n\n` +
            `Your quote ${q.number} from CJM Metals is ready when you are. ` +
            `View it (and accept it online) here:\n\n` +
            `${url}\n\n` +
            `Questions? Just reply to this email or give us a call.\n\n` +
            `— CJM Metals · Arlington, TX`,
        });
        if (ok) {
          sqlite.prepare("UPDATE quotes SET nudge_sent_at = ? WHERE id = ?").run(Date.now(), q.id);
          logEmailActivity({
            email,
            subject: `Quote nudge — ${q.number} share link re-sent`,
          });
        }
      });
    }
  });

  // 4. Stale draft invoices.
  step("stale draft invoices", () => {
    const rows = sqlite.prepare(`
      SELECT number FROM fin_invoices
      WHERE deleted_at IS NULL AND status = 'draft' AND created_at < ?
    `).all(now - 7 * DAY_MS) as any[];
    for (const inv of rows) {
      ensureTask(`auto:draft-invoice:${inv.number}`,
        `${inv.number} has sat in draft — send or void it`);
    }
  });

  // 4b. Unbilled-work chaser (Phase A #5) — billable expenses/time sitting on
  // a job with no invoice_id stamp (same predicate as finance's
  // collectUnbilled), where the job is done or the oldest item is 14+ days
  // old. The month in the dedupe key re-nags monthly until it's billed.
  // Labor priced at the HR pay rate (salary pro-rated at 2080 h/yr), no
  // markups — it's a nag amount, not an invoice.
  // ponytail: two lookups per live project — fine at shop scale.
  step("unbilled-work chaser", () => {
    const month = today.slice(0, 7); // "YYYY-MM"
    const projs = sqlite.prepare(
      "SELECT id, name, status FROM projects WHERE deleted_at IS NULL",
    ).all() as any[];
    const expQ = sqlite.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS cents, MIN(created_at) AS oldest
      FROM fin_expenses
      WHERE deleted_at IS NULL AND billable = 1 AND invoice_id IS NULL AND project_id = ?
    `);
    const timeQ = sqlite.prepare(`
      SELECT COALESCE(SUM(CAST(te.duration_min AS REAL) / 60.0 *
               CASE WHEN e.pay_type = 'salary' THEN COALESCE(e.pay_rate_cents, 0) / 2080.0
                    ELSE COALESCE(e.pay_rate_cents, 0) END), 0) AS cents,
             MIN(te.started_at) AS oldest
      FROM pm_time_entries te
      LEFT JOIN hr_employees e ON e.user_id = te.user_id AND e.deleted_at IS NULL
      WHERE te.project_id = ? AND te.billable = 1 AND te.invoice_id IS NULL
        AND te.ended_at IS NOT NULL AND te.duration_min > 0
    `);
    for (const p of projs) {
      const ex = expQ.get(p.id) as any;
      const tm = timeQ.get(p.id) as any;
      const cents = Math.round((ex?.cents ?? 0) + (tm?.cents ?? 0));
      if (cents <= 0) continue;
      const oldest = Math.min(ex?.oldest ?? Infinity, tm?.oldest ?? Infinity);
      if (p.status !== "done" && oldest > now - 14 * DAY_MS) continue;
      ensureTask(`auto:unbilled:${p.id}:${month}`,
        `Unbilled work on ${p.name}: ${fmtUsd(cents)} waiting — pull it into an invoice`,
        "other", null, p.id);
    }
  });

  // 5. Late vendor POs.
  step("late vendor POs", () => {
    const rows = sqlite.prepare(`
      SELECT number, vendor FROM fin_purchase_orders
      WHERE deleted_at IS NULL AND status = 'sent'
        AND expected_date IS NOT NULL AND expected_date < ?
    `).all(today) as any[];
    for (const po of rows) {
      ensureTask(`auto:late-po:${po.number}`, `Check on ${po.number} from ${po.vendor}`);
    }
  });

  // 6. Missing receipts — one batched task, not one per expense.
  step("missing receipts", () => {
    const r = sqlite.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM fin_expenses
      WHERE deleted_at IS NULL AND (receipt_url IS NULL OR receipt_url = '')
        AND amount_cents >= 7500 AND created_at < ?
    `).get(now - 3 * DAY_MS) as any;
    if (r.n > 0) {
      ensureTask("auto:missing-receipts",
        `${r.n} expense${r.n === 1 ? "" : "s"} missing receipts — ${fmtUsd(r.total)} total`);
    }
  });

  // 7. Estimate auto-expire — the status flip is the natural dedupe.
  step("estimate auto-expire", () => {
    const rows = sqlite.prepare(`
      SELECT id, number FROM crm_estimates
      WHERE deleted_at IS NULL AND status = 'sent'
        AND valid_until IS NOT NULL AND valid_until < ?
    `).all(today) as any[];
    const flip = sqlite.prepare("UPDATE crm_estimates SET status = 'expired' WHERE id = ?");
    for (const e of rows) {
      flip.run(e.id);
      ensureTask(`auto:estimate-expired:${e.number}`,
        `${e.number} expired — re-quote or chase?`, "quote_reminder");
    }
  });

  // 7b. Estimate pre-expiry nudge (Phase D #24a) — still 'sent' (step 7 flips
  // lapsed ones to 'expired' after the date) and valid_until inside 3 days:
  // chase the customer BEFORE the price lapses, not after.
  step("estimate pre-expiry nudge", () => {
    const rows = sqlite.prepare(`
      SELECT e.id, e.number, e.valid_until,
             COALESCE(c.name, l.name, e.title) AS who
      FROM crm_estimates e
      LEFT JOIN crm_clients c ON c.id = e.client_id
      LEFT JOIN crm_leads l ON l.id = e.lead_id
      WHERE e.deleted_at IS NULL AND e.status = 'sent'
        AND e.valid_until IS NOT NULL AND e.valid_until >= ? AND e.valid_until <= ?
    `).all(today, localDate(now + 3 * DAY_MS)) as any[];
    for (const e of rows) {
      ensureTask(`auto:estimate-expiring:${e.id}`,
        `Estimate ${e.number} for ${e.who} expires ${e.valid_until} — follow up before it lapses`,
        "quote_reminder");
    }
  });

  // 8. Lead follow-up dates — NULLing the column makes each date fire once.
  step("lead follow-up dates", () => {
    const rows = sqlite.prepare(`
      SELECT id, name FROM crm_leads
      WHERE deleted_at IS NULL AND stage NOT IN ('won','lost')
        AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= ?
    `).all(now) as any[];
    const clear = sqlite.prepare("UPDATE crm_leads SET next_follow_up_at = NULL WHERE id = ?");
    for (const l of rows) {
      ensureTask(`auto:lead-follow-up:${l.id}`, `Follow up with ${l.name}`, "follow_up", l.id);
      clear.run(l.id);
    }
  });

  // 8b. Stale deals (Phase B #11) — open pipeline money untouched for 14+
  // days. updated_at is stamped by the deal PATCH; older rows fall back to
  // created_at. The month in the dedupe key re-nags monthly until it moves.
  step("stale deals", () => {
    const month = today.slice(0, 7); // "YYYY-MM"
    const rows = sqlite.prepare(`
      SELECT id, title, COALESCE(updated_at, created_at) AS touched
      FROM crm_deals
      WHERE deleted_at IS NULL AND stage NOT IN ('won','lost')
        AND COALESCE(updated_at, created_at) < ?
    `).all(now - 14 * DAY_MS) as any[];
    for (const d of rows) {
      const days = Math.floor((now - d.touched) / DAY_MS);
      ensureTask(`auto:stale-deal:${d.id}:${month}`,
        `Deal '${d.title}' has sat untouched for ${days} days`, "follow_up");
    }
  });

  // 9. Campaign auto-end.
  step("campaign auto-end", () => {
    sqlite.prepare(`
      UPDATE mk_campaigns SET status = 'ended'
      WHERE deleted_at IS NULL AND status = 'active'
        AND end_date IS NOT NULL AND end_date < ?
    `).run(today);
  });

  // 10. Unquoted website designs — same design↔quote join as the public
  // status tracker (public-portal.ts), minus its sent/accepted narrowing.
  step("unquoted designs", () => {
    const rows = sqlite.prepare(`
      SELECT d.ref, d.name FROM web_designs d
      WHERE d.created_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM quotes q
          WHERE q.deleted_at IS NULL AND q.status != 'draft'
            AND upper(q.design_ref) = upper(d.ref)
        )
    `).all(now - 48 * HOUR_MS) as any[];
    for (const d of rows) {
      ensureTask(`auto:unquoted-design:${d.ref}`,
        `Quote design ${d.ref} for ${d.name || "the customer"}`, "quote_reminder");
    }
  });

  // 11. Review-ask retry — queueReviewRequest (finance.ts) only stamps
  // review_requests.sent_at when its send succeeded, so a NULL there with an
  // email on file means the ask never went out. Same wording, same stamp.
  step("review-ask retry", () => {
    if (!mailEnabled()) return;
    const rows = sqlite.prepare(`
      SELECT id, token, name, email FROM review_requests
      WHERE email IS NOT NULL AND email != ''
        AND sent_at IS NULL AND submitted_at IS NULL AND created_at >= ?
        AND created_at < ?
    `).all(now - 30 * DAY_MS, now - 15 * 60 * 1000) as any[];
    // 15-min age floor: finance.ts stamps sent_at only after its send resolves,
    // so a brand-new row may still be in flight — don't race it into a double send.
    for (const rr of rows) {
      setImmediate(async () => {
        const first = String(rr.name ?? "").trim().split(/\s+/)[0] || "there";
        const ok = await sendMail({
          to: rr.email,
          subject: "How did we do? — CJM Metals",
          text:
            `Hi ${first},\n\n` +
            `Thanks for choosing CJM Metals for your project. If you have a ` +
            `minute, we'd really appreciate a quick review — it takes about ` +
            `30 seconds:\n\n` +
            `${PUBLIC_SITE_URL}/review/${rr.token}\n\n` +
            `Thank you!\n\n` +
            `— CJM Metals · Arlington, TX`,
        });
        if (ok) {
          sqlite.prepare("UPDATE review_requests SET sent_at = ? WHERE id = ?")
            .run(Date.now(), rr.id);
        }
      });
    }
  });

  // 12. Lead-time banner staleness — the settings save stamps
  // lead_time_updated_at; 30+ days without a touch earns a nudge.
  step("lead-time staleness", () => {
    if (cfg.lead_time_weeks == null) return;
    if (cfg.lead_time_updated_at != null && cfg.lead_time_updated_at > now - 30 * DAY_MS) return;
    ensureTask("auto:lead-time-stale",
      `Still quoting ${cfg.lead_time_weeks} weeks out? Update or clear it in Marketing settings`);
  });

  // 12b. Material-price staleness — the quote engine prices everything off the
  // shared material library (quote_settings.price_book → materials.*). The
  // builder stamps materials.<id>.updatedAt when a cost is edited; a material
  // with no stamp is still on the SEED placeholder price. 90+ days (or never
  // touched) earns a nudge — steel moves, stale prices eat margin silently.
  step("material-price staleness", () => {
    const row = sqlite.prepare(
      "SELECT price_book FROM quote_settings WHERE id = 1",
    ).get() as { price_book?: string } | undefined;
    let book: any = null;
    try { book = row?.price_book ? JSON.parse(row.price_book) : null; } catch { return; }
    const mats = book?.materials;
    if (!mats || typeof mats !== "object") {
      // Price book never customized since the material library shipped —
      // every product (and the website ballpark) is quoting off seed prices.
      ensureTask("auto:material-prices-stale",
        "Set your real material prices — the quote engine is still on placeholder seed prices (Quotes → Price book → Materials)");
      return;
    }
    const stale: string[] = [];
    for (const [id, m] of Object.entries(mats as Record<string, any>)) {
      if (!m || typeof m !== "object") continue;
      const at = Number(m.updatedAt) || null;
      if (at == null || at < now - 90 * DAY_MS) stale.push(String(m.name || id));
    }
    if (stale.length === 0) return;
    const head = stale.slice(0, 4).join(", ");
    ensureTask("auto:material-prices-stale",
      `Review material prices — ${stale.length} seed or 90+ days old (${head}${stale.length > 4 ? ", …" : ""})`);
  });

  // 13. Dead-pipe heartbeat — the ≥5 floor keeps brand-new installs quiet;
  // the open task doubles as the once-per-quiet-period dedupe for the email.
  step("dead-pipe heartbeat", () => {
    const r = sqlite.prepare(`
      SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM crm_leads
      WHERE deleted_at IS NULL AND source IN ('website','facebook','instagram')
    `).get() as any;
    if (r.n < 5 || r.newest == null || r.newest > now - 10 * DAY_MS) return;
    if (ensureTask("auto:dead-pipe", "No website leads in 10+ days — check the site")) {
      setImmediate(() => {
        void sendOwnerMail({
          subject: "[CJM Suite] No website leads in 10+ days",
          text:
            `The newest website/social lead is ${Math.floor((now - r.newest) / DAY_MS)} days old.\n\n` +
            `Worth checking that cjmmetals.com, its quote form, and the ad campaigns are still working.`,
        });
      });
    }
  });

  // 14. Low stock — one task per item under its threshold.
  step("low stock", () => {
    const rows = sqlite.prepare(`
      SELECT id, name, quantity FROM items
      WHERE deleted_at IS NULL AND low_stock_threshold > 0 AND quantity <= low_stock_threshold
    `).all() as any[];
    for (const i of rows) {
      ensureTask(`auto:low-stock:${i.id}`, `Reorder ${i.name} — ${i.quantity} left`);
    }
  });

  // 15. Tool checkout chase — per user+item, FIFO-match check-ins against
  // checkouts; the oldest uncovered checkout is what they still owe.
  // ponytail: naive full-scan + JS walk — fine at shop scale.
  step("tool checkout chase", () => {
    const rows = sqlite.prepare(`
      SELECT t.user_id, t.item_id, t.type, t.quantity, t.created_at,
             u.name AS user_name, i.name AS item_name
      FROM transactions t
      JOIN items i ON i.id = t.item_id
      JOIN users u ON u.id = t.user_id
      WHERE i.item_type = 'tool' AND i.deleted_at IS NULL
      ORDER BY t.created_at, t.id
    `).all() as any[];
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const k = `${r.user_id}:${r.item_id}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(r);
    }
    for (const [key, g] of groups) {
      const out: { at: number; qty: number }[] = [];
      for (const r of g) {
        if (r.type === "check_out") {
          out.push({ at: r.created_at, qty: r.quantity });
        } else {
          let back = r.quantity;
          while (back > 0 && out.length > 0) {
            const take = Math.min(back, out[0].qty);
            out[0].qty -= take;
            back -= take;
            if (out[0].qty === 0) out.shift();
          }
        }
      }
      if (out.length === 0 || out[0].at > now - 14 * DAY_MS) continue;
      const days = Math.floor((now - out[0].at) / DAY_MS);
      ensureTask(`auto:tool-chase:${key}`,
        `Chase ${g[0].user_name} for ${g[0].item_name} — out ${days} days`);
    }
  });

  // 16. Clock-out nag — one owner mail per batch, each shift nagged once.
  step("clock-out nag", () => {
    if (!mailEnabled()) return;
    const rows = sqlite.prepare(`
      SELECT a.id, a.clock_in, e.first_name || ' ' || e.last_name AS who
      FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
      WHERE a.clock_out IS NULL AND a.overdue_notified_at IS NULL AND a.clock_in < ?
    `).all(now - 14 * HOUR_MS) as any[];
    if (rows.length === 0) return;
    const text =
      `These shifts were never clocked out:\n\n` +
      rows.map((r) => `  - ${r.who} — clocked in ${new Date(r.clock_in).toLocaleString()}`).join("\n") +
      `\n\nFix them in HR → Attendance.`;
    setImmediate(async () => {
      const ok = await sendOwnerMail({
        subject: `[CJM Suite] ${rows.length} shift${rows.length === 1 ? "" : "s"} never clocked out`,
        text,
      });
      if (ok) {
        const stamp = sqlite.prepare("UPDATE hr_attendance SET overdue_notified_at = ? WHERE id = ?");
        for (const r of rows) stamp.run(Date.now(), r.id);
      }
    });
  });

  // 17. Runaway timer auto-stop — same math as POST /api/pm/time/stop, then
  // one owner mail listing everything stopped this tick.
  step("runaway timers", () => {
    const rows = sqlite.prepare(`
      SELECT te.id, te.started_at, u.name AS user_name
      FROM pm_time_entries te JOIN users u ON u.id = te.user_id
      WHERE te.ended_at IS NULL AND te.started_at < ?
    `).all(now - 12 * HOUR_MS) as any[];
    if (rows.length === 0) return;
    const stop = sqlite.prepare("UPDATE pm_time_entries SET ended_at = ?, duration_min = ? WHERE id = ?");
    for (const r of rows) {
      stop.run(now, Math.max(0, Math.round((now - r.started_at) / 60000)), r.id);
    }
    const text =
      `These timers ran past 12 hours and were stopped automatically:\n\n` +
      rows.map((r) => `  - ${r.user_name} — started ${new Date(r.started_at).toLocaleString()}`).join("\n") +
      `\n\nAdjust the entries in Projects → Time if the hours are wrong.`;
    setImmediate(() => {
      void sendOwnerMail({
        subject: `[CJM Suite] Auto-stopped ${rows.length} runaway timer${rows.length === 1 ? "" : "s"}`,
        text,
      });
    });
  });

  // 18. Contract expiry — flip the lapsed ones, warn about the next 30 days.
  step("contract expiry", () => {
    sqlite.prepare(`
      UPDATE pm_contracts SET status = 'expired'
      WHERE deleted_at IS NULL AND status IN ('signed','active')
        AND end_date IS NOT NULL AND end_date < ?
    `).run(today);
    const ending = sqlite.prepare(`
      SELECT id, title, end_date FROM pm_contracts
      WHERE deleted_at IS NULL AND status IN ('signed','active')
        AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ?
    `).all(today, localDate(now + 30 * DAY_MS)) as any[];
    for (const c of ending) {
      ensureTask(`auto:contract-ending:${c.id}`, `Contract ${c.title} ends ${c.end_date}`);
    }
  });

  // 18b. Warranty windows (Phase D #22) — signed/active contracts with a
  // warranty_months and a completed linked job: warranty end = completion +
  // months; inside the last 30 days, queue the callback/inspection task.
  step("warranty windows", () => {
    const rows = sqlite.prepare(`
      SELECT c.id, c.warranty_months, p.id AS project_id, p.name AS project_name, p.completed_at
      FROM pm_contracts c JOIN projects p ON p.id = c.project_id
      WHERE c.deleted_at IS NULL AND c.status IN ('signed','active')
        AND c.warranty_months > 0
        AND p.deleted_at IS NULL AND p.completed_at IS NOT NULL
    `).all() as any[];
    for (const r of rows) {
      const end = new Date(r.completed_at);
      end.setMonth(end.getMonth() + r.warranty_months);
      const endMs = end.getTime();
      if (endMs < now || endMs > now + 30 * DAY_MS) continue;
      ensureTask(`auto:warranty:${r.id}`,
        `Warranty on ${r.project_name} ends ${localDate(endMs)} — schedule the callback/inspection`,
        "other", null, r.project_id);
    }
  });

  // 19. Payroll reminder — anything payable within 2 days and not yet paid.
  step("payroll reminder", () => {
    const runs = sqlite.prepare(`
      SELECT id, period_start, period_end, pay_date, status FROM hr_payroll_runs
      WHERE status != 'paid' AND pay_date IS NOT NULL AND pay_date <= ?
    `).all(localDate(now + 2 * DAY_MS)) as any[];
    for (const r of runs) {
      ensureTask(`auto:payroll-due:${r.id}`,
        `Payroll run for ${r.period_start} – ${r.period_end} is due ${r.pay_date} and still ${r.status}`);
    }
  });

  // 20. Daily owner digest — once per day, first sweep at/after 7am local.
  step("owner digest", () => {
    if (!mailEnabled()) return; // don't burn the day's send on a no-op
    if (new Date(now).getHours() < 7) return;
    if (cfg.last_digest_date === today) return;
    // ponytail: stamp before sending — a failed send waits for tomorrow, but a
    // slow one can never double-fire.
    sqlite.prepare("UPDATE mk_settings SET last_digest_date = ? WHERE id = 1").run(today);
    const text = buildDigest(now, today) || "Nothing needs your attention today.";
    setImmediate(() => {
      void sendOwnerMail({ subject: `[CJM Suite] Daily digest — ${today}`, text });
    });
  });

  // 21. Nightly DB snapshot (Phase E) — >20h age gate makes it fire about once
  // a day off the hourly tick; rotation keeps the 7 newest in DATA_DIR/backups.
  step("nightly backup", () => {
    maybeNightlyBackup(now);
  });

  // 21b. Weekly offsite copy (Phase E) — small enough and SMTP configured:
  // email the latest snapshot to the owner; otherwise a reminder task to use
  // Admin → Download backup. Stamped before either branch (same stance as the
  // digest) so one week never gets both, or two of either.
  step("weekly offsite backup", () => {
    const week = isoWeek(now);
    if (cfg.last_backup_week === week) return;
    const snap = latestSnapshot(); // step 21 just ran, so this exists
    if (!snap) return;
    sqlite.prepare("UPDATE mk_settings SET last_backup_week = ? WHERE id = 1").run(week);
    if (mailEnabled() && snap.bytes < 8 * 1024 * 1024) {
      const filename = path.basename(snap.file);
      setImmediate(() => {
        void sendOwnerMail({
          subject: `CJM Suite weekly backup — ${today}`,
          text:
            `Attached is this week's gzipped snapshot of the suite database (${filename}).\n\n` +
            `Keep a copy somewhere off the server — your PC, OneDrive, a USB stick. ` +
            `See RESTORE.md in the repo for how to restore it.`,
          attachments: [{ filename, content: fs.readFileSync(snap.file) }],
        });
      });
    } else {
      ensureTask(`auto:backup-download:${week}`,
        "Download an offsite backup of the suite database (Admin → Download backup)");
    }
  });
}

// ─── Owner digest body ───────────────────────────────────────────────────────
// Plain text, sections skipped when empty. Monday adds the weekly funnel;
// the 1st adds last month's books (same rollup rules as finance.ts /reports).

function buildDigest(now: number, today: string): string {
  const d = new Date(now);
  const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  const todayMs = Date.parse(today);
  const parts: string[] = [];

  const dueToday = sqlite.prepare(
    "SELECT title FROM mk_tasks WHERE status = 'open' AND due_at >= ? AND due_at < ? ORDER BY due_at",
  ).all(startOfToday, startOfToday + DAY_MS) as any[];
  const overdueTasks = (sqlite.prepare(
    "SELECT COUNT(*) AS n FROM mk_tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?",
  ).get(startOfToday) as any).n;
  if (dueToday.length > 0 || overdueTasks > 0) {
    parts.push([
      `TASKS TODAY (${dueToday.length} due, ${overdueTasks} overdue)`,
      ...dueToday.map((t) => `  - ${t.title}`),
    ].join("\n"));
  }

  const yLeads = sqlite.prepare(
    "SELECT name, source FROM crm_leads WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?",
  ).all(startOfToday - DAY_MS, startOfToday) as any[];
  if (yLeads.length > 0) {
    parts.push([
      `NEW LEADS YESTERDAY (${yLeads.length})`,
      ...yLeads.map((l) => `  - ${l.name} (${l.source})`),
    ].join("\n"));
  }

  const overdueInv = sqlite.prepare(`
    SELECT i.number, COALESCE(c.name, i.client_name, '(no client)') AS who,
           i.total_cents - i.paid_cents AS balance, i.due_date
    FROM fin_invoices i LEFT JOIN crm_clients c ON c.id = i.client_id
    WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue')
      AND i.due_date IS NOT NULL AND i.due_date < ? AND i.total_cents - i.paid_cents > 0
    ORDER BY i.due_date
  `).all(today) as any[];
  if (overdueInv.length > 0) {
    parts.push([
      `OVERDUE INVOICES (${overdueInv.length})`,
      ...overdueInv.map((i) => {
        const days = Math.max(1, Math.floor((todayMs - Date.parse(i.due_date)) / DAY_MS));
        return `  - ${i.number} · ${i.who} · ${fmtUsd(i.balance)} · ${days}d overdue`;
      }),
    ].join("\n"));
  }

  const waiting = sqlite.prepare(
    "SELECT number, customer_name, total_cents FROM quotes WHERE deleted_at IS NULL AND status = 'sent' ORDER BY sent_at",
  ).all() as any[];
  if (waiting.length > 0) {
    parts.push([
      `QUOTES WAITING ON CUSTOMERS (${waiting.length})`,
      ...waiting.map((q) => `  - ${q.number} · ${q.customer_name || "(no name)"} · ${fmtUsd(q.total_cents)}`),
    ].join("\n"));
  }

  const low = sqlite.prepare(`
    SELECT name, quantity FROM items
    WHERE deleted_at IS NULL AND low_stock_threshold > 0 AND quantity <= low_stock_threshold
    ORDER BY name
  `).all() as any[];
  if (low.length > 0) {
    parts.push([
      `LOW STOCK (${low.length})`,
      ...low.map((i) => `  - ${i.name} — ${i.quantity} left`),
    ].join("\n"));
  }

  if (d.getDay() === 1) {
    const weekAgo = now - 7 * DAY_MS;
    const n = (q: string, ...args: unknown[]): number => (sqlite.prepare(q).get(...args) as any).n;
    const lines = [
      "WEEKLY FUNNEL (last 7 days)",
      `  Leads in: ${n("SELECT COUNT(*) AS n FROM crm_leads WHERE deleted_at IS NULL AND created_at >= ?", weekAgo)}`,
      `  Designs submitted: ${n("SELECT COUNT(*) AS n FROM web_designs WHERE created_at >= ?", weekAgo)}`,
      `  Quotes sent: ${n("SELECT COUNT(*) AS n FROM quotes WHERE deleted_at IS NULL AND sent_at >= ?", weekAgo)}`,
      `  Quotes accepted: ${n("SELECT COUNT(*) AS n FROM quotes WHERE deleted_at IS NULL AND accepted_at >= ?", weekAgo)}`,
      `  Reviews received: ${n("SELECT COUNT(*) AS n FROM mk_reviews WHERE created_at >= ?", weekAgo)}`,
    ];
    const unpub = n("SELECT COUNT(*) AS n FROM mk_reviews WHERE source = 'website' AND published = 0");
    if (unpub > 0) lines.push(`  Unpublished website reviews: ${unpub}`);
    // Today IS Monday here, so startOfToday is this week's start. Walk back a
    // calendar week from noon so a DST shift can't land us on Sunday 23:00.
    const lm = new Date(startOfToday + 12 * 60 * 60 * 1000);
    lm.setDate(lm.getDate() - 7);
    lm.setHours(0, 0, 0, 0);
    const lastMonday = lm.getTime();
    const laggards = sqlite.prepare(`
      SELECT DISTINCT u.name FROM pm_time_entries te JOIN users u ON u.id = te.user_id
      WHERE te.started_at >= ? AND te.started_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM pm_timesheets ts
          WHERE ts.user_id = te.user_id AND ts.week_start = ? AND ts.status IN ('submitted','approved')
        )
    `).all(lastMonday, startOfToday, localDate(lastMonday)) as any[];
    if (laggards.length > 0) {
      lines.push(`  Timesheets missing for last week: ${laggards.map((l) => l.name).join(", ")}`);
    }
    parts.push(lines.join("\n"));
  }

  if (d.getDate() === 1) {
    const mStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth(), 1);
    const prefix = `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, "0")}`;
    const income = (sqlite.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS n FROM fin_invoice_payments
      WHERE (paid_at LIKE ?) OR (paid_at IS NULL AND created_at >= ? AND created_at < ?)
    `).get(`${prefix}%`, mStart.getTime(), mEnd.getTime()) as any).n;
    const spent = (sqlite.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) AS n FROM fin_expenses WHERE deleted_at IS NULL AND date LIKE ?",
    ).get(`${prefix}%`) as any).n;
    const ar = (sqlite.prepare(`
      SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS n FROM fin_invoices
      WHERE deleted_at IS NULL AND status IN ('sent','partial','overdue')
    `).get() as any).n;
    parts.push([
      `LAST MONTH (${prefix})`,
      `  Income: ${fmtUsd(income)}`,
      `  Expenses: ${fmtUsd(spent)}`,
      `  Net: ${fmtUsd(income - spent)}`,
      `  AR outstanding today: ${fmtUsd(ar)}`,
    ].join("\n"));
  }

  return parts.join("\n\n");
}

// ─── Dashboard "Needs attention" feed (Phase D #20c) ─────────────────────────
// Lives here because the money-signal queries are the same ones the owner
// digest and sweep already run (overdue invoices, contracts ending ≤30d, low
// stock); the task list is the mk_tasks automation sink + overdue pm_tasks.
// Registered from index.ts right after registerRoutes. Each block try/catch'd
// so a missing module table degrades to zeros, same stance as the sweep.

export function registerAttentionRoute(app: Express): void {
  app.get("/api/dashboard/attention", requireElevated, (_req, res) => {
    const now = Date.now();
    const today = localDate(now);
    type AttentionTask = {
      source: "marketing" | "pm";
      id: number;
      title: string;
      dueAt: number | null;
      overdue: boolean;
      projectId: number | null;
    };
    const tasks: AttentionTask[] = [];
    try {
      const mk = sqlite.prepare(`
        SELECT id, title, due_at, project_id FROM mk_tasks WHERE status = 'open'
        ORDER BY due_at IS NULL, due_at, created_at DESC LIMIT 8
      `).all() as any[];
      for (const t of mk) {
        tasks.push({
          source: "marketing", id: t.id, title: t.title,
          dueAt: t.due_at ?? null,
          overdue: t.due_at != null && t.due_at < now,
          projectId: t.project_id ?? null,
        });
      }
    } catch { /* marketing module absent */ }
    try {
      const pm = sqlite.prepare(`
        SELECT id, title, due_date, project_id FROM pm_tasks
        WHERE deleted_at IS NULL AND status != 'done'
          AND due_date IS NOT NULL AND due_date < ?
        ORDER BY due_date LIMIT 8
      `).all(today) as any[];
      for (const t of pm) {
        tasks.push({
          source: "pm", id: t.id, title: t.title,
          dueAt: Date.parse(t.due_date) || null,
          overdue: true,
          projectId: t.project_id ?? null,
        });
      }
    } catch { /* pm module absent */ }

    const n = (q: string, ...args: unknown[]): number => {
      try {
        return (sqlite.prepare(q).get(...args) as any)?.n ?? 0;
      } catch {
        return 0;
      }
    };
    res.json({
      tasks,
      // Same predicates as the owner digest / sweep steps 1, 18 and 14.
      overdueInvoices: n(`
        SELECT COUNT(*) AS n FROM fin_invoices
        WHERE deleted_at IS NULL AND status IN ('sent','partial','overdue')
          AND due_date IS NOT NULL AND due_date < ? AND total_cents - paid_cents > 0
      `, today),
      contractsExpiring: n(`
        SELECT COUNT(*) AS n FROM pm_contracts
        WHERE deleted_at IS NULL AND status IN ('signed','active')
          AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ?
      `, today, localDate(now + 30 * DAY_MS)),
      lowStock: n(`
        SELECT COUNT(*) AS n FROM items
        WHERE deleted_at IS NULL AND low_stock_threshold > 0 AND quantity <= low_stock_threshold
      `),
    });
  });
}

// Same shape as startMarketingAutomations: run once on boot, then hourly;
// unref() so the timer never keeps a shutting-down process alive.
export function startBusinessAutomations(): void {
  const tick = () => {
    try {
      runBusinessSweep();
    } catch (e) {
      console.error("[automations] sweep failed", e);
    }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}
