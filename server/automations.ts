import type { Express } from "express";
import fs from "fs";
import path from "path";
import { sqlite, storage } from "./storage";
import { requireElevated } from "./auth";
import { mailEnabled, sendMail, sendOwnerMail, isOptedOut } from "./mailer";
import { renderTemplate, runCustomEmailSweep, firstNameOf } from "./email-templates";
import { ymdLocal as localDate, fmtUsd } from "./http-util";
// Leaf module like mailer — snapshot/rotation mechanics live there, the
// scheduling (nightly + weekly offsite, steps 21/21b) lives here.
import { maybeNightlyBackup, latestSnapshot } from "./backup";
// Deliberate exception to this module's no-imports stance (Phase B #9): the
// email-activity logger lives with the crm_activities table it writes, is
// deferred + try/catch'd internally, and every mail this sweep sends should
// land on the customer's timeline.
import { logEmailActivity } from "./crm";
// Schema-only (no server module): the per-site dead-pipe alarm names the shop
// whose pipe went quiet.
import { LEAD_SITES, SITE_DOMAINS } from "../shared/crm-schema";

// ─── Business automations ────────────────────────────────────────────────────
// THE hourly cross-module sweep (plus one on boot): chases money, nudges
// customers, flags stale leads, expires stale paperwork, and sends the daily
// owner digest. Raw sqlite on purpose — this module reads a dozen other
// modules' tables and shouldn't import any of them. Every step runs in its
// own try/catch so one broken table never kills the rest of the sweep.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://www.cjmmetals.com";
// Where the suite ITSELF is reachable — the /q/optout unsubscribe endpoint
// lives on this server, not the marketing site. Set PUBLIC_APP_URL to the
// suite's public URL (e.g. the Railway domain); the website fallback needs a
// /q/optout proxy page on the site.
const APP_URL = process.env.PUBLIC_APP_URL || PUBLIC_SITE_URL;

// ─── Additive migrations (import time) ───────────────────────────────────────
// Columns this sweep stamps on tables owned by other modules — added here with
// the same try/catch ALTER pattern as quotes.ts so their files stay untouched.
// index.ts imports ./routes (→ every module's DDL) before this module, so the
// tables already exist when these run.
for (const ddl of [
  "ALTER TABLE fin_invoices ADD COLUMN reminded_at INTEGER", // last chase email, unix ms
  "ALTER TABLE quotes ADD COLUMN nudge_sent_at INTEGER", // follow-up #1 (pre-Phase-F: one-shot nudge), unix ms
  "ALTER TABLE quotes ADD COLUMN fu2_sent_at INTEGER", // follow-up #2 ("last note"), unix ms
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
// `localDate` (ymdLocal) and `fmtUsd` live in ./http-util.

// ISO week key ("2026-29") for the weekly offsite-backup dedupe.
function isoWeek(ms: number): string {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // the Thursday of this week
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-${String(week).padStart(2, "0")}`;
}

// Dedupe on auto_key (Package C: automation tasks live on the pm board now).
// Returns true when a task was actually created.
//
// "Done" sticks for a week rather than forever. The check used to match OPEN
// tasks only, so an auto card the owner ticked off came back within the hour,
// re-dated to today and back in the next morning's digest — which made tidying
// the board the very thing that caused it to nag, and taught him to stop
// reading both. Checking all statuses forever is wrong in the other direction:
// `auto:dead-pipe`, the low-stock and document-expiry cards and the tool chase
// are standing alarms that MUST re-arm once the condition persists. A cooldown
// gives both what they need.
// ponytail: one fixed period for every key — give a key its own interval only
// if one of them turns out to genuinely need a different one.
const TASK_COOLDOWN_MS = 7 * DAY_MS;

function ensureTask(
  key: string,
  title: string,
  kind = "other",
  leadId: number | null = null,
  projectId: number | null = null, // Phase D #20: surfaces the task on the job hub
): boolean {
  const open = sqlite.prepare(`
    SELECT id FROM pm_tasks
    WHERE deleted_at IS NULL AND auto_key = ?
      AND (status != 'done' OR COALESCE(completed_at, 0) > ?)
  `).get(key, Date.now() - TASK_COOLDOWN_MS);
  if (open) return false;
  sqlite.prepare(`
    INSERT INTO pm_tasks (title, kind, lead_id, project_id, status, auto_created, due_date, auto_key)
    VALUES (?, ?, ?, ?, 'todo', 1, ?, ?)
  `).run(title, kind, leadId, projectId, localDate(Date.now()), key);
  return true;
}

// "One open follow-up per lead" — mirrors the old marketing sweep's
// hasOpenTask: any non-terminal board row chasing this lead blocks another.
function hasOpenLeadFollowUp(leadId: number): boolean {
  return !!sqlite.prepare(`
    SELECT 1 FROM pm_tasks
    WHERE deleted_at IS NULL AND status != 'done'
      AND lead_id = ? AND kind IN ('follow_up', 'quote_reminder')
  `).get(leadId);
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
  stale_lead_days: number;
  quote_follow_up_days: number;
  lead_time_weeks: number | null;
  lead_time_updated_at: number | null;
  last_digest_date: string | null;
  last_backup_week: string | null;
}

function getSettings(): SweepSettings {
  try {
    const row = sqlite.prepare(`
      SELECT stale_lead_days, quote_follow_up_days, lead_time_weeks, lead_time_updated_at, last_digest_date, last_backup_week
      FROM mk_settings WHERE id = 1
    `).get() as SweepSettings | undefined;
    if (row) return row;
  } catch {
    /* mk_settings not migrated yet — fall through to defaults */
  }
  return { stale_lead_days: 7, quote_follow_up_days: 3, lead_time_weeks: null, lead_time_updated_at: null, last_digest_date: null, last_backup_week: null };
}

// ─── The sweep ───────────────────────────────────────────────────────────────

function runBusinessSweep(): void {
  const now = Date.now();
  const today = localDate(now);
  const cfg = getSettings();

  // 1. Overdue invoice chase — email the client (re-remind every 7 days), or
  // queue a task when there's no address on file.
  step("invoice chase", () => {
    // Balance is retainage-aware (Phase G #3): held retainage isn't due yet,
    // so a GC that paid everything-but-retainage must not get dunned for it.
    const rows = sqlite.prepare(`
      SELECT i.id, i.number, i.due_date, i.reminded_at, i.client_id, i.lead_id,
             i.total_cents - COALESCE(i.retainage_cents, 0) - i.paid_cents AS balance,
             c.name AS client_name, c.email
      FROM fin_invoices i LEFT JOIN crm_clients c ON c.id = i.client_id
      WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue')
        AND i.due_date IS NOT NULL AND i.due_date < ?
        AND i.total_cents - COALESCE(i.retainage_cents, 0) - i.paid_cents > 0
    `).all(today) as any[];
    for (const inv of rows) {
      if (inv.email && mailEnabled() && !isOptedOut(inv.email)) {
        if (inv.reminded_at != null && inv.reminded_at > now - 7 * DAY_MS) continue;
        setImmediate(async () => {
          const first = firstNameOf(inv.client_name);
          // Wording lives in the Emails section; null = the owner switched
          // this reminder off.
          const msg = renderTemplate("invoice.overdue", {
            firstName: first,
            invoiceNumber: String(inv.number),
            balance: fmtUsd(inv.balance),
            dueDate: String(inv.due_date ?? ""),
          });
          if (!msg) return;
          const ok = await sendMail({ to: inv.email, ...msg });
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

  // 3. Customer follow-up ladder (Phase F) — two automated emails per shared
  // quote with a customer email: #1 at ≥2 days ("any questions?"), #2 at
  // ≥7 days ("last note"). nudge_sent_at (the pre-Phase-F one-shot nudge
  // stamp) doubles as the FU1 stamp, so already-nudged quotes go straight to
  // FU2. Stops for good on accept/decline/delete or an email_optouts row;
  // every send carries the /q/optout unsubscribe link (token = share token).
  step("quote follow-up ladder", () => {
    if (!mailEnabled()) return;
    const rows = sqlite.prepare(`
      SELECT id, number, customer_name, total_cents, payload, design_ref,
             share_token, sent_at, nudge_sent_at
      FROM quotes
      WHERE deleted_at IS NULL AND status = 'sent' AND share_token IS NOT NULL
        AND sent_at IS NOT NULL AND sent_at < ?
        AND (nudge_sent_at IS NULL OR (fu2_sent_at IS NULL AND sent_at < ?))
    `).all(now - 2 * DAY_MS, now - 7 * DAY_MS) as any[];
    for (const q of rows) {
      const stage = q.nudge_sent_at == null ? 1 : 2;
      // A late FU1 (mailer was off for a week) never chains straight into FU2
      // on the next hourly tick — give it the same 2-day gap.
      if (stage === 2 && q.nudge_sent_at > now - 2 * DAY_MS) continue;
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
      if (!email || isOptedOut(email)) continue;
      const url = `${PUBLIC_SITE_URL}/quote/${q.share_token}`;
      const first = firstNameOf(q.customer_name);
      // Both rungs of the ladder are owner-editable in the Emails section; the
      // unsubscribe link is re-attached there if it was deleted.
      const msg = renderTemplate(stage === 1 ? "quote.followup1" : "quote.followup2", {
        firstName: first,
        customerName: String(q.customer_name ?? "there"),
        quoteNumber: String(q.number),
        quoteTotal: fmtUsd(q.total_cents),
        quoteUrl: url,
        unsubscribeUrl: `${APP_URL}/q/optout?token=${q.share_token}`,
      });
      if (!msg) continue; // switched off by the owner
      setImmediate(async () => {
        const ok = await sendMail({ to: email!, ...msg });
        if (!ok) return;
        sqlite.prepare(
          `UPDATE quotes SET ${stage === 1 ? "nudge_sent_at" : "fu2_sent_at"} = ? WHERE id = ?`,
        ).run(Date.now(), q.id);
        logEmailActivity({
          email,
          subject: `Quote follow-up #${stage} — ${q.number} share link re-sent`,
        });
        try {
          storage.appendAudit({
            userName: "automations",
            action: "quote.follow_up",
            targetType: "quote",
            targetId: q.id,
            targetName: q.number,
            details: { stage, email },
          });
        } catch {
          /* audit is best-effort */
        }
      });
    }
  });

  // 4. Draft invoices that are actually ready to go out.
  //
  // This used to be purely time-based — 7 days after the invoice row appeared,
  // which for a quote accepted online is 7 days after the customer said yes.
  // On a six-week gate job that lands in week two, while holding the draft is
  // exactly the right thing to do, and it said "send or void it" every hour
  // until he did one or the other. Meanwhile the case that actually costs
  // money — the job is finished and the draft is still sitting there — got no
  // prompt at all, because by then the invoice was older than the nag.
  //
  // So: branch on the JOB, not the clock. Finished (or never linked to a job,
  // where the clock is the only signal there is) earns the nag; still running
  // stays quiet.
  step("stale draft invoices", () => {
    const rows = sqlite.prepare(`
      SELECT i.number, p.name AS project_name, p.status AS project_status
      FROM fin_invoices i
      LEFT JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
      WHERE i.deleted_at IS NULL AND i.status = 'draft' AND i.created_at < ?
        AND (p.id IS NULL OR p.status = 'done')
    `).all(now - 7 * DAY_MS) as any[];
    for (const inv of rows) {
      ensureTask(`auto:draft-invoice:${inv.number}`,
        inv.project_name
          ? `${inv.project_name} is finished — send invoice ${inv.number}`
          : `${inv.number} has sat in draft — send or void it`);
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
      WHERE deleted_at IS NULL AND status = 'open'
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

  // 8b. Stale leads (moved from marketing.ts, Package C) — no touch (last
  // contact, else creation) in stale_lead_days. Won/lost leads are settled.
  // Flags crm_leads.stale, and queues a re-engagement task the moment a lead
  // turns stale — one open follow-up per lead, monthly re-nag via the key.
  step("stale leads", () => {
    const candidates = sqlite.prepare(`
      SELECT id, name, stale FROM crm_leads
      WHERE deleted_at IS NULL AND stage NOT IN ('won', 'lost')
        AND COALESCE(last_contact_at, created_at) < ?
    `).all(now - cfg.stale_lead_days * DAY_MS) as any[];
    const newlyStale = candidates.filter((l) => !l.stale);
    if (newlyStale.length === 0) return;
    const mark = sqlite.prepare("UPDATE crm_leads SET stale = 1 WHERE id = ?");
    const month = today.slice(0, 7); // "YYYY-MM"
    for (const l of newlyStale) {
      mark.run(l.id);
      if (hasOpenLeadFollowUp(l.id)) continue;
      ensureTask(`auto:stale-lead:${l.id}:${month}`,
        `Re-engage ${l.name} — no contact in ${cfg.stale_lead_days} days`,
        "follow_up", l.id);
    }
  });

  // 8c. Lead quote chase (moved from marketing.ts, Package C) — quote sent,
  // then silence past the configured window. Same one-open-follow-up rule.
  step("lead quote chase", () => {
    const rows = sqlite.prepare(`
      SELECT id, name FROM crm_leads
      WHERE deleted_at IS NULL AND stage = 'quote_sent'
        AND COALESCE(last_contact_at, created_at) < ?
    `).all(now - cfg.quote_follow_up_days * DAY_MS) as any[];
    for (const l of rows) {
      if (hasOpenLeadFollowUp(l.id)) continue;
      ensureTask(`auto:lead-quote-chase:${l.id}`,
        `Follow up on quote for ${l.name} — no response in ${cfg.quote_follow_up_days} days`,
        "quote_reminder", l.id);
    }
  });

  // 9. (Campaign auto-end deleted with the campaigns screen — mk_campaigns has
  // had no writer since marketing was cut back to Overview/Reviews/Portfolio/
  // Settings, so this only ever re-ran over frozen rows. The table is left
  // alone; only the reader is gone.)

  // 10. Unquoted website designs — same design↔quote join as the public
  // status tracker (public-portal.ts), minus its sent/accepted narrowing.
  // Bounded at 30 days: past a month the design is cold and the card is just
  // noise the owner cannot dismiss. All four brands' refs qualify — a CJT-
  // trades plan is quotable and tends to be the biggest job on the board.
  step("unquoted designs", () => {
    const rows = sqlite.prepare(`
      SELECT d.ref, d.name FROM web_designs d
      WHERE d.created_at < ? AND d.created_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM quotes q
          WHERE q.deleted_at IS NULL AND q.status != 'draft'
            AND upper(q.design_ref) = upper(d.ref)
        )
    `).all(now - 48 * HOUR_MS, now - 30 * DAY_MS) as any[];
    for (const d of rows) {
      ensureTask(`auto:unquoted-design:${d.ref}`,
        `Quote design ${d.ref} for ${d.name || "the customer"}`, "quote_reminder");
    }
  });

  // 11. Review-ask retry — queueReviewRequest (finance.ts) only stamps
  // review_requests.sent_at when its send succeeded, so a NULL there with an
  // email on file means the ask never went out.
  //
  // It goes back out through renderTemplate, exactly like the first attempt.
  // This step used to carry its own hardcoded copy of the email, which made a
  // NULL sent_at ambiguous: it also covers the case where the owner switched
  // the template OFF (renderTemplate returns null and finance.ts never stamps),
  // so the retry cheerfully sent the factory wording 15 minutes after he
  // switched it off — and quietly reverted any rewording he had done.
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
      if (isOptedOut(rr.email)) continue;
      setImmediate(async () => {
        const msg = renderTemplate("review.request", {
          firstName: firstNameOf(rr.name),
          reviewUrl: `${PUBLIC_SITE_URL}/review/${rr.token}`,
        });
        if (!msg) return; // switched off in the Emails section — respect it
        const ok = await sendMail({ to: rr.email, ...msg });
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

  // 13. Dead-pipe heartbeat — PER SITE.
  //
  // This used to count all four brands in one bucket with no `site` predicate,
  // which made it useless for exactly the three sites that need it: metals
  // volume kept the counter healthy, so concrete/insulation/trades could stop
  // delivering leads entirely and no alarm would ever fire. Those three also
  // have no backup channel, so a broken pipe there loses the enquiry outright.
  //
  // Each brand is judged against its OWN history rather than a fixed floor: a
  // shop that normally gets one lead a week is flagged in about three weeks
  // instead of never, and a brand with no traffic yet (< 3 lifetime leads)
  // never nags. This can only ever catch "worked, then stopped" — the intake
  // endpoint's own 401 counter (public-api.ts) is what catches "never worked".
  step("dead-pipe heartbeat", () => {
    for (const site of LEAD_SITES) {
      const rows = sqlite.prepare(`
        SELECT created_at FROM crm_leads
        WHERE deleted_at IS NULL AND source IN ('website','facebook','instagram')
          AND COALESCE(site, 'metals') = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(site) as { created_at: number }[];
      // Under 3 lifetime leads is a brand that hasn't started, not a dead pipe.
      const total = sqlite.prepare(`
        SELECT COUNT(*) AS n FROM crm_leads
        WHERE deleted_at IS NULL AND source IN ('website','facebook','instagram')
          AND COALESCE(site, 'metals') = ?
      `).get(site) as { n: number };
      if (total.n < 3 || rows.length === 0) continue;

      // Median gap between this brand's recent leads → what "quiet" means here.
      const gaps: number[] = [];
      for (let i = 1; i < rows.length; i++) gaps.push(rows[i - 1].created_at - rows[i].created_at);
      gaps.sort((a, b) => a - b);
      const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
      const quietMs = Math.max(10 * DAY_MS, 3 * median);

      const newest = rows[0].created_at;
      if (newest > now - quietMs) continue;

      const days = Math.floor((now - newest) / DAY_MS);
      const domain = SITE_DOMAINS[site];
      if (ensureTask(`auto:dead-pipe:${site}`, `No leads from ${domain} in ${days} days — check the site`)) {
        setImmediate(() => {
          void sendOwnerMail({
            subject: `[CJM Suite] No leads from ${domain} in ${days} days`,
            text:
              `The newest lead from ${domain} is ${days} days old.\n\n` +
              `Worth checking that the site, its quote form and any ad campaigns are still working — ` +
              `and, on the sister sites, that SUITE_BASE_URL and SUITE_LEAD_KEY are still set on its Railway service.`,
          });
        });
      }
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

  // 18c. Expiring compliance documents (Phase G #4) — a COI or lien waiver
  // lapsing mid-job stops commercial work cold; nag 30 days out so there's
  // time to get the renewal from the insurer.
  step("expiring documents", () => {
    const kindLabel: Record<string, string> = {
      coi: "COI", w9: "W-9", lien_waiver: "Lien waiver", contract: "Contract", other: "Document",
    };
    const rows = sqlite.prepare(`
      SELECT id, kind, title, expires_at, project_id FROM pm_documents
      WHERE deleted_at IS NULL AND expires_at IS NOT NULL
        AND expires_at >= ? AND expires_at <= ?
    `).all(today, localDate(now + 30 * DAY_MS)) as any[];
    for (const d of rows) {
      ensureTask(`auto:doc-expiring:${d.id}`,
        `${kindLabel[d.kind] ?? "Document"} '${d.title}' expires ${d.expires_at} — renew it`,
        "other", null, d.project_id ?? null);
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

  // 21b. Weekly offsite copy (Phase E) — small enough and mail configured:
  // email the latest snapshot to the owner; otherwise a reminder task to use
  // Admin → Download backup.
  //
  // Unlike the digest, the week is stamped only once the mail has actually gone
  // out. Stamping first (the digest's stance, where losing one day's summary
  // costs nothing) meant a failed send silently burned the whole week: no
  // email, no reminder card, and the next attempt not until the following
  // Monday — which would do the same thing again. A backup nobody is told is
  // missing is the one failure this file must not have.
  step("weekly offsite backup", () => {
    const week = isoWeek(now);
    if (cfg.last_backup_week === week) return;
    const snap = latestSnapshot(); // step 21 just ran, so this exists
    if (!snap) return;
    const stampWeek = () =>
      sqlite.prepare("UPDATE mk_settings SET last_backup_week = ? WHERE id = 1").run(week);

    if (mailEnabled() && snap.bytes < 8 * 1024 * 1024) {
      const filename = path.basename(snap.file);
      setImmediate(async () => {
        const ok = await sendOwnerMail({
          subject: `CJM Suite weekly backup — ${today}`,
          text:
            `Attached is this week's gzipped snapshot of the suite database (${filename}).\n\n` +
            `Keep a copy somewhere off the server — your PC, OneDrive, a USB stick. ` +
            `See RESTORE.md in the repo for how to restore it.`,
          attachments: [{ filename, content: fs.readFileSync(snap.file) }],
        });
        // A failed send falls through to the card, so the week still produces
        // exactly one prompt — it just isn't the email.
        if (ok) stampWeek();
        else {
          ensureTask(`auto:backup-download:${week}`,
            "Download an offsite backup of the suite database (Admin → Download backup) — this week's backup email failed to send");
          stampWeek();
        }
      });
    } else {
      ensureTask(`auto:backup-download:${week}`,
        "Download an offsite backup of the suite database (Admin → Download backup)");
      stampWeek();
    }
  });

  // 22. Payroll not booked for last month.
  //
  // Twenty-odd steps above chase invoices, quotes, leads, stock, tools and
  // backups. None of them mentioned wages — the shop's biggest cost and the
  // only one with no prompt anywhere. Forgotten, that labour never reaches the
  // books at all, so job costing under-reports and the monthly P&L in the
  // digest reads better than the business actually did.
  //
  // ponytail: assumes a calendar-month pay period, because nothing in the
  // schema records a cadence. Month-keyed like the unbilled and stale-lead
  // nags, so it asks once per month rather than once per sweep.
  step("payroll booked", () => {
    const d = new Date(now);
    // Only from the 2nd — on the 1st, last month's payroll isn't late yet.
    if (d.getDate() < 2) return;
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

    const staff = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM hr_employees WHERE deleted_at IS NULL AND status = 'active'",
    ).get() as { n: number };
    if (staff.n === 0) return; // no crew, no payroll

    const booked = sqlite.prepare(`
      SELECT 1 FROM fin_expenses
      WHERE deleted_at IS NULL AND category = 'payroll' AND date LIKE ?
    `).get(`${prevMonth}-%`);
    if (booked) return;

    ensureTask(`auto:payroll:${prevMonth}`,
      `Payroll for ${prevMonth} isn't in the books yet — run it in HR → Payroll and record the expense`);
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

  // One task list (Package C): the digest covers every open board task —
  // follow-ups and plain cards alike — due today or overdue.
  const dueToday = sqlite.prepare(
    "SELECT title FROM pm_tasks WHERE deleted_at IS NULL AND status != 'done' AND due_date = ? ORDER BY created_at",
  ).all(today) as any[];
  const overdueTasks = (sqlite.prepare(
    "SELECT COUNT(*) AS n FROM pm_tasks WHERE deleted_at IS NULL AND status != 'done' AND due_date IS NOT NULL AND due_date < ?",
  ).get(today) as any).n;
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
           i.total_cents - COALESCE(i.retainage_cents, 0) - i.paid_cents AS balance, i.due_date
    FROM fin_invoices i LEFT JOIN crm_clients c ON c.id = i.client_id
    WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue')
      AND i.due_date IS NOT NULL AND i.due_date < ?
      AND i.total_cents - COALESCE(i.retainage_cents, 0) - i.paid_cents > 0
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

  // Emails that failed in the last 24h. A bounced or rejected send is logged
  // and then resolves false — nothing surfaces it, so an invoice the customer
  // never received looks identical to one they are ignoring. The audit row is
  // already written (mailer.recordSend); this just reads it back.
  const failedMail = sqlite.prepare(`
    SELECT target_name AS who, details FROM audit_log
    WHERE action = 'email.failed' AND created_at > ?
    ORDER BY created_at DESC LIMIT 10
  `).all(now - DAY_MS) as any[];
  if (failedMail.length > 0) {
    parts.push([
      `EMAILS THAT DID NOT GO OUT (${failedMail.length})`,
      ...failedMail.map((f) => {
        let subject = "", error = "";
        try {
          const d = f.details ? JSON.parse(f.details) : {};
          subject = d.subject ?? "";
          error = d.error ?? "";
        } catch { /* details is a nicety */ }
        return `  - ${f.who || "(no recipient)"}${subject ? ` · ${subject}` : ""}${error ? ` · ${error}` : ""}`;
      }),
    ].join("\n"));
  }

  // Oldest first, capped. A quote stays 'sent' until someone accepts or
  // declines it, and nothing ever marks one lost — so this section grew without
  // limit and, after a year, buried the two things that actually needed him
  // today under a wall of quotes that were never coming back.
  const DIGEST_QUOTE_LIMIT = 10;
  const waiting = sqlite.prepare(
    "SELECT number, customer_name, total_cents FROM quotes WHERE deleted_at IS NULL AND status = 'sent' ORDER BY sent_at",
  ).all() as any[];
  if (waiting.length > 0) {
    const shown = waiting.slice(0, DIGEST_QUOTE_LIMIT);
    const rest = waiting.length - shown.length;
    parts.push([
      `QUOTES WAITING ON CUSTOMERS (${waiting.length})`,
      ...shown.map((q) => `  - ${q.number} · ${q.customer_name || "(no name)"} · ${fmtUsd(q.total_cents)}`),
      ...(rest > 0 ? [`  …and ${rest} older — mark the dead ones lost in Quotes to clear this list.`] : []),
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
      SELECT COALESCE(SUM(total_cents - COALESCE(retainage_cents, 0) - paid_cents), 0) AS n
      FROM fin_invoices
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
// stock); the task list is pm_tasks — open follow-ups + overdue board cards.
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
      // Local calendar date "YYYY-MM-DD" (pm_tasks.due_date) — the client
      // formats it as a local day; an epoch would land a day early.
      dueAt: string | null;
      overdue: boolean;
      projectId: number | null;
    };
    const tasks: AttentionTask[] = [];
    // One task list (Package C): both feeds read pm_tasks now — open
    // follow-ups (any due date) keep the "marketing" source so the dashboard
    // chip still reads Follow-up; overdue plain cards stay source "pm".
    try {
      const mk = sqlite.prepare(`
        SELECT id, title, due_date, project_id FROM pm_tasks
        WHERE deleted_at IS NULL AND status != 'done' AND kind != 'task'
        ORDER BY due_date IS NULL, due_date, created_at DESC LIMIT 8
      `).all() as any[];
      for (const t of mk) {
        tasks.push({
          // Send the calendar date through as "YYYY-MM-DD" — the client's
          // formatDate parses that in LOCAL time, where Date.parse of a bare
          // date is UTC midnight and renders as the day before out here.
          source: "marketing", id: t.id, title: t.title,
          dueAt: t.due_date ?? null,
          overdue: t.due_date != null && t.due_date < today,
          projectId: t.project_id ?? null,
        });
      }
    } catch { /* pm module absent */ }
    try {
      const pm = sqlite.prepare(`
        SELECT id, title, due_date, project_id FROM pm_tasks
        WHERE deleted_at IS NULL AND status != 'done' AND kind = 'task'
          AND due_date IS NOT NULL AND due_date < ?
        ORDER BY due_date LIMIT 8
      `).all(today) as any[];
      for (const t of pm) {
        tasks.push({
          source: "pm", id: t.id, title: t.title,
          dueAt: t.due_date ?? null,
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
          AND due_date IS NOT NULL AND due_date < ?
          AND total_cents - COALESCE(retainage_cents, 0) - paid_cents > 0
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

// Same shape as startSessionReaper in auth.ts: run once on boot, then hourly;
// unref() so the timer never keeps a shutting-down process alive.
export function startBusinessAutomations(): void {
  const tick = () => {
    try {
      runBusinessSweep();
    } catch (e) {
      console.error("[automations] sweep failed", e);
    }
    // The owner's own event-timed emails ("30 days after a job is finished").
    // Separate try/catch: a template with a bad anchor must not take the rest
    // of the sweep down with it.
    void runCustomEmailSweep().catch((e) =>
      console.error("[automations] custom email sweep failed", e));
  };
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}
