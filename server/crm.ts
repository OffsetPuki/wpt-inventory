import type { Express } from "express";
import {
  eq, and, or, desc, isNull, sql, like, gte, lte, notInArray, type SQL,
} from "drizzle-orm";
import { sqlite, db } from "./storage";
import { audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import {
  clients, leads, crmActivities,
  insertClientSchema, insertLeadSchema, insertCrmActivitySchema,
  LEAD_SOURCES, LEAD_STAGES, CLIENT_STATUSES,
  type Lead, type LeadStage, type LeadSource, type ClientStatus,
} from "../shared/crm-schema";
// Cross-module automation hooks. These TABLE OBJECTS are safe to import (pure
// schema definitions); the underlying tables are created by the owning
// module's DDL, not ours — so every read/write against them below is wrapped
// in try/catch and degrades to a no-op / defaults if that module isn't loaded.
// Package C: follow-up tasks live on the pm board (pm_tasks) now.
import { marketingSettings } from "../shared/marketing-schema";
import { pmTasks } from "../shared/pm-schema";
// Wiring plan, Fix 2 — projects carry a soft clientId ref; the client detail
// view lists the jobs behind it. Core table, always present.
import { projects } from "../shared/schema";
import {
  pid, qstr, todayLocal, ymdLocal, isElevated,
  registerSoftDelete, registerGetById, registerCreate,
} from "./http-util";

// ─── Table creation (synchronous DDL) ────────────────────────────────────────
// Mirrors shared/crm-schema.ts exactly. crm_leads.campaign_id is a soft
// reference to mk_campaigns (owned by the marketing module) — no REFERENCES
// clause, so table-creation order between modules doesn't matter.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS crm_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    zip TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    tags TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    -- Soft delete: NULL = active.
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_crm_clients_status ON crm_clients(status);
  CREATE INDEX IF NOT EXISTS idx_crm_clients_created ON crm_clients(created_at);

  CREATE TABLE IF NOT EXISTS crm_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    source TEXT NOT NULL DEFAULT 'other',
    -- Soft ref to mk_campaigns (marketing module owns that table); no FK to
    -- avoid cross-module creation-order coupling.
    campaign_id INTEGER,
    service_requested TEXT,
    service_area TEXT,
    estimated_value_cents INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'new',
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES crm_clients(id) ON DELETE SET NULL,
    last_contact_at INTEGER,
    next_follow_up_at INTEGER,
    stale INTEGER NOT NULL DEFAULT 0,
    win_loss_reason TEXT,
    revenue_closed_cents INTEGER NOT NULL DEFAULT 0,
    photos TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_client ON crm_leads(client_id);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign ON crm_leads(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_last_contact ON crm_leads(last_contact_at);

  CREATE TABLE IF NOT EXISTS crm_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'note',
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_crm_activities_entity ON crm_activities(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_crm_activities_created ON crm_activities(created_at);
`);

// Additive migration: raw UTM columns arrived after installs existed (the
// website intake writes them for attribution reporting). SQLite has no
// IF NOT EXISTS for columns — the throw on re-run is expected.
for (const col of ["utm_source", "utm_medium", "utm_campaign"]) {
  try {
    sqlite.exec(`ALTER TABLE crm_leads ADD COLUMN ${col} TEXT`);
  } catch {
    /* column already exists */
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Automation knobs live in mk_settings (marketing module). If that module
// hasn't registered yet (table missing) or the singleton row doesn't exist,
// fall back to the schema defaults so CRM side effects still behave sanely.
function getAutomationSettings(): { quoteFollowUpDays: number; autoReviewRequest: boolean } {
  try {
    const row = db.select().from(marketingSettings).limit(1).get();
    if (row) {
      return { quoteFollowUpDays: row.quoteFollowUpDays, autoReviewRequest: row.autoReviewRequest };
    }
  } catch {
    // mk_settings not created yet — marketing module owns it.
  }
  return { quoteFollowUpDays: 3, autoReviewRequest: true };
}

// Canonical client-name lookup (this module owns crm_clients). finance.ts
// uses it to snapshot names onto invoices — no deleted_at filter on purpose,
// matching the copy it replaced: the snapshot is display text, not a live
// link, so a soft-deleted client still resolves. try/catch → null keeps the
// cross-module stance (a broken table degrades to "no name").
export function clientNameById(id: number): string | null {
  try {
    return db.select({ name: clients.name }).from(clients)
      .where(eq(clients.id, id)).get()?.name ?? null;
  } catch {
    return null;
  }
}

// Quote-sent side effect: schedule a follow-up task on the pm board unless
// the lead already has an open quote reminder (dedupe, so re-sending an
// estimate doesn't stack reminders).
function ensureQuoteReminder(lead: Lead, now: number): void {
  try {
    const open = db.select({ id: pmTasks.id }).from(pmTasks)
      .where(and(
        eq(pmTasks.leadId, lead.id),
        eq(pmTasks.kind, "quote_reminder"),
        sql`${pmTasks.status} != 'done'`,
        isNull(pmTasks.deletedAt),
      ))
      .get();
    if (open) return;
    db.insert(pmTasks).values({
      title: `Follow up on quote — ${lead.name}`,
      kind: "quote_reminder",
      leadId: lead.id,
      autoCreated: true,
      dueDate: ymdLocal(now + getAutomationSettings().quoteFollowUpDays * DAY_MS),
    }).run();
  } catch {
    // pm_tasks not created yet — automation is best-effort, never block CRM.
  }
}

// Won side effect: ask the customer for a review (if the automation knob is
// on). Due in 3 days — soon enough that the job is fresh in their mind.
function maybeCreateReviewTask(lead: Lead, now: number): void {
  try {
    if (!getAutomationSettings().autoReviewRequest) return;
    // Dedupe like ensureQuoteReminder: re-winning a corrected lead must not
    // stack a second "ask for a review" task on top of an open one.
    const open = db.select({ id: pmTasks.id }).from(pmTasks)
      .where(and(
        eq(pmTasks.leadId, lead.id),
        eq(pmTasks.kind, "review_request"),
        sql`${pmTasks.status} != 'done'`,
        isNull(pmTasks.deletedAt),
      ))
      .get();
    if (open) return;
    db.insert(pmTasks).values({
      title: `Ask ${lead.name} for a review`,
      kind: "review_request",
      leadId: lead.id,
      autoCreated: true,
      dueDate: ymdLocal(now + 3 * DAY_MS),
    }).run();
  } catch {
    // pm_tasks not created yet — see ensureQuoteReminder.
  }
}

// Sending an estimate linked to a lead should move that lead forward in the
// funnel: new/contacted → quote_sent (never regress a lead that's already in
// follow_up/won/lost). Bumping counts as contact, and the quote-reminder task
// is scheduled the same as a manual stage change to quote_sent.
function bumpLeadForQuote(leadId: number, now: number): void {
  const lead = db.select().from(leads)
    .where(and(eq(leads.id, leadId), isNull(leads.deletedAt)))
    .get();
  if (!lead) return;
  if (lead.stage === "new" || lead.stage === "contacted") {
    db.update(leads)
      .set({ stage: "quote_sent", lastContactAt: now, stale: false })
      .where(eq(leads.id, lead.id))
      .run();
    ensureQuoteReminder(lead, now);
  } else if (lead.stage === "quote_sent") {
    // Already at quote_sent (e.g. a second estimate) — dedupe handles stacking.
    ensureQuoteReminder(lead, now);
  }
}

// ─── Quote builder lifecycle bridge ──────────────────────────────────────────
// Called by quotes.ts (share → sent) and public-portal.ts (customer accepted).
// Builder quotes carry no lead/client FK — only free-text contact details — so
// this matches the most recent live lead by normalized email or digits-only
// phone (same rule as public-api's findRecentDuplicate), falling back to the
// linked web design's contact when the builder's customer card is empty.
// Deferred + try/catch: quote flows must never fail over a CRM nicety.
// Normalize North American numbers so "+1 (817) 555-0123" from browser
// autofill matches "817-555-0123" typed in the builder months later: strip
// non-digits, then drop a leading country-code "1" from an 11-digit number so
// both forms collapse to the same 10 digits. Everything else keeps its FULL
// digits — a blind last-10 slice would let an 11-digit +44 number collide with
// a 10-digit US number, so we compare full normalized digits instead.
const contactDigits = (s: string | null | undefined): string => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

export interface QuoteContactInfo {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  designRef?: string | null;
}

// Normalized contact channels for matching, falling back to the linked web
// design's contact when the builder's customer card is empty.
function resolveQuoteContact(info: QuoteContactInfo): { emailNorm: string; phoneDigits: string } {
  let emailNorm = (info.email ?? "").trim().toLowerCase();
  let phoneDigits = contactDigits(info.phone);
  if ((!emailNorm || !phoneDigits) && info.designRef) {
    try {
      const d = sqlite.prepare(
        "SELECT email, phone FROM web_designs WHERE upper(ref) = upper(?)",
      ).get(info.designRef) as { email?: string | null; phone?: string | null } | undefined;
      emailNorm ||= (d?.email ?? "").trim().toLowerCase();
      phoneDigits ||= contactDigits(d?.phone);
    } catch {
      // web_designs belongs to the website module — absent is fine.
    }
  }
  return { emailNorm, phoneDigits };
}

// Fix 3 (wiring plan): resolve a contact to a CRM client id, creating the
// client when nobody matches. Requires at least one contact channel — a bare
// name is too spoofable/collidable to auto-create from a public flow.
// Synchronous by design so accept hooks can use the id for invoice/project
// linkage; callers are already inside setImmediate + try/catch.
export function findOrCreateClientByContact(info: QuoteContactInfo): number | null {
  const { emailNorm, phoneDigits } = resolveQuoteContact(info);
  if (!emailNorm && !phoneDigits) return null;
  // ponytail: JS scan over live clients, newest first — fine at shop scale.
  const existing = db.select().from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(desc(clients.createdAt), desc(clients.id))
    .all()
    .find((c) => {
      const cEmail = (c.email ?? "").trim().toLowerCase();
      const cPhone = contactDigits(c.phone);
      return (!!emailNorm && !!cEmail && cEmail === emailNorm)
        || (!!phoneDigits && !!cPhone && cPhone === phoneDigits);
    });
  if (existing) return existing.id;
  const row = db.insert(clients).values({
    name: (info.name ?? "").trim() || emailNorm || `Customer …${phoneDigits}`,
    email: (info.email ?? "").trim() || (emailNorm || null),
    phone: (info.phone ?? "").trim() || null,
    notes: "Auto-created from a quote (wiring plan, Fix 3)",
  }).returning().get();
  return row.id;
}

// Shared "quote accepted → win the linked lead" side effect. Idempotent per
// quote number (fix 2): a second accept of the SAME quote for this lead (a
// portal double-click, or an estimate re-PATCHed to accepted) neither
// double-counts revenue nor logs a duplicate activity — it detects the prior
// acceptance activity and returns. Used by onQuoteEvent("accepted") and the
// estimate PATCH→accepted path (fix 4).
function winLeadForAcceptedQuote(
  lead: Lead,
  quoteNumber: string,
  addCents: number,
  now: number,
): void {
  // Already recorded this quote's acceptance on this lead → nothing to do.
  const already = db.select({ id: crmActivities.id }).from(crmActivities)
    .where(and(
      eq(crmActivities.entityType, "lead"),
      eq(crmActivities.entityId, lead.id),
      like(crmActivities.notes, `Accepted quote ${quoteNumber} on cjmmetals.com%`),
    ))
    .get();
  if (already) return;

  if (lead.stage !== "won") {
    // First win — a lost lead flips too (the customer just said yes). Same
    // fallback chain as a manual win: a $0 display total (quote saved before
    // pricing) must not clobber known value.
    db.update(leads).set({
      stage: "won",
      winLossReason: "good_fit",
      lastContactAt: now,
      stale: false,
      revenueClosedCents: addCents || lead.revenueClosedCents || lead.estimatedValueCents || 0,
    }).where(eq(leads.id, lead.id)).run();
    maybeCreateReviewTask(lead, now);
  } else {
    // Repeat business — the lead stays won; ADD the new job's revenue so the
    // closed-revenue KPI agrees with the monthly chart, and refresh the stamp.
    db.update(leads).set({
      lastContactAt: now,
      stale: false,
      revenueClosedCents: (lead.revenueClosedCents || 0) + addCents,
    }).where(eq(leads.id, lead.id)).run();
  }
  db.insert(crmActivities).values({
    entityType: "lead",
    entityId: lead.id,
    kind: "note",
    notes: `Accepted quote ${quoteNumber} on cjmmetals.com`
      + (addCents ? ` — $${(addCents / 100).toFixed(2)}` : ""),
  }).run();
}

// Phase A #6: tie the accept hook's auto-created invoice to the lead so a
// later full payment can push realized revenue back onto it (finance.ts,
// queuePaidCloseLoop). The invoice hook runs in an earlier-queued setImmediate
// on the same tick, so the row exists by the time this runs. fin_invoices
// belongs to finance → raw SQL + try/catch; lead_id IS NULL keeps a re-accept
// from re-pointing an already-stamped invoice.
function stampInvoiceLead(quoteNumber: string, leadId: number): void {
  try {
    sqlite.prepare(
      "UPDATE fin_invoices SET lead_id = ? WHERE deleted_at IS NULL AND lead_id IS NULL AND notes LIKE ?",
    ).run(leadId, `From quote ${quoteNumber} — %`);
  } catch {
    /* finance module absent */
  }
}

// Phase B #9: every automated customer email leaves a timeline entry, so the
// activity feed matches what the customer actually received (no double-contact
// surprises). Callers pass whatever they have in hand — a clientId/leadId, or
// just the address the mail went to (resolved to the most recent live lead by
// normalized email, same matching stance as onQuoteEvent). Skips silently when
// nothing resolves. Deferred + try/catch: mail flows never fail over CRM.
export function logEmailActivity(info: {
  clientId?: number | null;
  leadId?: number | null;
  email?: string | null;
  subject: string;
}): void {
  setImmediate(() => {
    try {
      let leadId = info.leadId ?? null;
      const clientId = info.clientId ?? null;
      if (leadId == null && clientId == null) {
        const emailNorm = (info.email ?? "").trim().toLowerCase();
        if (!emailNorm) return;
        // ponytail: JS scan over live leads, newest first — fine at shop scale.
        leadId = db.select({ id: leads.id, email: leads.email }).from(leads)
          .where(isNull(leads.deletedAt))
          .orderBy(desc(leads.createdAt), desc(leads.id))
          .all()
          .find((l) => (l.email ?? "").trim().toLowerCase() === emailNorm)?.id ?? null;
        if (leadId == null) return;
      }
      const values = { kind: "email" as const, notes: `Emailed: ${info.subject}` };
      if (leadId != null) {
        db.insert(crmActivities).values({
          ...values, entityType: "lead", entityId: leadId,
        }).run();
      }
      if (clientId != null) {
        db.insert(crmActivities).values({
          ...values, entityType: "client", entityId: clientId,
        }).run();
      }
    } catch (e) {
      console.error("[crm] email activity log failed", e);
    }
  });
}

export function onQuoteEvent(
  evt: "sent" | "accepted",
  info: QuoteContactInfo & {
    quoteNumber: string;
    totalCents?: number;
  },
): void {
  setImmediate(() => {
    try {
      const { emailNorm, phoneDigits } = resolveQuoteContact(info);
      if (!emailNorm && !phoneDigits) return;

      // ponytail: JS scan over live leads, newest first — fine at shop scale.
      const lead = db.select().from(leads)
        .where(isNull(leads.deletedAt))
        .orderBy(desc(leads.createdAt), desc(leads.id))
        .all()
        .find((l) => {
          const lEmail = (l.email ?? "").trim().toLowerCase();
          const lPhone = contactDigits(l.phone);
          return (!!emailNorm && !!lEmail && lEmail === emailNorm)
            || (!!phoneDigits && !!lPhone && lPhone === phoneDigits);
        });

      const now = Date.now();

      // Fix 3: unknown contact — CREATE the CRM records instead of dropping
      // the event. Before this, a stranger accepting a quote left no client,
      // no lead, nothing.
      if (!lead) {
        const clientId = evt === "accepted" ? findOrCreateClientByContact(info) : null;
        const created = db.insert(leads).values({
          name: (info.name ?? "").trim() || emailNorm || `Customer …${phoneDigits}`,
          email: (info.email ?? "").trim() || (emailNorm || null),
          phone: (info.phone ?? "").trim() || null,
          source: info.designRef ? "website" : "other",
          stage: evt === "accepted" ? "won" : "quote_sent",
          clientId,
          lastContactAt: now,
          estimatedValueCents: info.totalCents || 0,
          ...(evt === "accepted"
            ? { winLossReason: "good_fit" as const, revenueClosedCents: info.totalCents || 0 }
            : {}),
          notes: `Created from quote ${info.quoteNumber}`,
        }).returning().get();
        db.insert(crmActivities).values({
          entityType: "lead",
          entityId: created.id,
          kind: "note",
          notes: evt === "accepted"
            ? `Accepted quote ${info.quoteNumber} on cjmmetals.com`
              + (info.totalCents ? ` — $${(info.totalCents / 100).toFixed(2)}` : "")
            : `Quote ${info.quoteNumber} shared with this contact`,
        }).run();
        if (evt === "sent") ensureQuoteReminder(created, now);
        else {
          maybeCreateReviewTask(created, now);
          stampInvoiceLead(info.quoteNumber, created.id);
        }
        return;
      }

      if (evt === "sent") {
        bumpLeadForQuote(lead.id, now);
        return;
      }

      // Fix 3: a winning lead should be tied to a real client record.
      if (lead.clientId == null) {
        const cid = findOrCreateClientByContact(info);
        if (cid != null) {
          db.update(leads).set({ clientId: cid }).where(eq(leads.id, lead.id)).run();
        }
      }
      // Accepted → win the lead (a lost lead flips too — the customer just
      // came back and said yes; any stale loss reason is overwritten).
      // Idempotent per quote (fix 2): a double accept of the same quote can't
      // double-count revenue or duplicate the acceptance activity.
      winLeadForAcceptedQuote(lead, info.quoteNumber, info.totalCents || 0, now);
      stampInvoiceLead(info.quoteNumber, lead.id);
    } catch (e) {
      console.error("[crm] quote lifecycle hook failed", e);
    }
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerCrmRoutes(app: Express): void {
  // `pid`/`qstr` (req.params/req.query narrowing) live in ./http-util.

  // ─── Stats (literal path — registered before any /:id routes) ────────────

  app.get("/api/crm/stats", requireAuth, (_req, res) => {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY_MS);
    const monthAgoMs = now - 30 * DAY_MS;
    const monthAgo = new Date(monthAgoMs);

    const openLeads = db.select({ n: sql<number>`count(*)` }).from(leads)
      .where(and(isNull(leads.deletedAt), notInArray(leads.stage, ["won", "lost"])))
      .get()?.n ?? 0;

    const leadsThisWeek = db.select({ n: sql<number>`count(*)` }).from(leads)
      .where(and(isNull(leads.deletedAt), gte(leads.createdAt, weekAgo)))
      .get()?.n ?? 0;

    // Pipeline = everything still in play: open leads' estimated value.
    const leadPipeline = db.select({ v: sql<number>`coalesce(sum(${leads.estimatedValueCents}), 0)` })
      .from(leads)
      .where(and(isNull(leads.deletedAt), notInArray(leads.stage, ["won", "lost"])))
      .get()?.v ?? 0;

    // Builder quotes are THE quoting system. Raw sqlite for the quotes table
    // (quote module owns it), try/catch'd in case that module isn't loaded.
    let quotesSentLast30 = 0;
    try {
      quotesSentLast30 = (sqlite.prepare(
        "SELECT count(*) AS n FROM quotes WHERE deleted_at IS NULL AND sent_at >= ?",
      ).get(monthAgoMs) as { n: number }).n;
    } catch {
      /* quotes table not created */
    }

    const closed = db.select({
      won: sql<number>`coalesce(sum(case when ${leads.stage} = 'won' then 1 else 0 end), 0)`,
      lost: sql<number>`coalesce(sum(case when ${leads.stage} = 'lost' then 1 else 0 end), 0)`,
    }).from(leads).where(isNull(leads.deletedAt)).get() ?? { won: 0, lost: 0 };
    const closeRate = closed.won + closed.lost > 0
      ? closed.won / (closed.won + closed.lost)
      : null;

    // "Revenue closed in the last 30 days" = accepted builder quotes bucketed
    // by accepted_at — the one money-date the schema actually records (leads
    // have no close timestamp). Same honest-date rule as the monthly report.
    let revenueClosed30dCents = 0;
    try {
      revenueClosed30dCents = (sqlite.prepare(
        "SELECT coalesce(sum(total_cents), 0) AS v FROM quotes WHERE deleted_at IS NULL AND status = 'accepted' AND accepted_at >= ?",
      ).get(monthAgoMs) as { v: number }).v;
    } catch {
      /* quotes table not created */
    }

    const topSourceRow = db.select({
      source: leads.source,
      count: sql<number>`count(*)`,
    }).from(leads)
      .where(and(isNull(leads.deletedAt), gte(leads.createdAt, monthAgo)))
      .groupBy(leads.source)
      .orderBy(desc(sql`count(*)`))
      .limit(1)
      .get();

    res.json({
      openLeads,
      leadsThisWeek,
      pipelineValueCents: leadPipeline,
      quotesSentLast30,
      closeRate,
      revenueClosed30dCents,
      topSource: topSourceRow
        ? { source: topSourceRow.source, count: topSourceRow.count }
        : null,
    });
  });

  // ─── Reports ─────────────────────────────────────────────────────────────

  app.get("/api/crm/reports", requireAuth, (_req, res) => {
    const nowDate = new Date();
    // First day of the month 11 months back → 12 buckets incl. the current one.
    const cutoffMs = new Date(nowDate.getFullYear(), nowDate.getMonth() - 11, 1).getTime();
    const cutoffDate = new Date(cutoffMs);

    // Monthly revenue = ACCEPTED builder quotes bucketed by the month they
    // were accepted (accepted_at is when the money became real). The quote
    // module owns the table → raw sqlite + try/catch, like the stats endpoint.
    let monthlyRevenue: { month: string; revenueCents: number }[] = [];
    try {
      monthlyRevenue = (sqlite.prepare(`
        SELECT strftime('%Y-%m', accepted_at / 1000, 'unixepoch') AS month,
               coalesce(sum(total_cents), 0) AS revenueCents
        FROM quotes
        WHERE deleted_at IS NULL AND status = 'accepted' AND accepted_at >= ?
        GROUP BY month
        ORDER BY month
      `).all(cutoffMs) as { month: string; revenueCents: number }[]);
    } catch {
      /* quotes table not created */
    }

    const leadMonth = sql<string>`strftime('%Y-%m', ${leads.createdAt} / 1000, 'unixepoch')`;
    const monthlyLeads = db.select({
      month: leadMonth,
      count: sql<number>`count(*)`,
    }).from(leads)
      .where(and(isNull(leads.deletedAt), gte(leads.createdAt, cutoffDate)))
      .groupBy(leadMonth)
      .orderBy(leadMonth)
      .all();

    const bySource = db.select({
      source: leads.source,
      leads: sql<number>`count(*)`,
      won: sql<number>`coalesce(sum(case when ${leads.stage} = 'won' then 1 else 0 end), 0)`,
      revenueCents: sql<number>`coalesce(sum(case when ${leads.stage} = 'won' then ${leads.revenueClosedCents} else 0 end), 0)`,
    }).from(leads)
      .where(isNull(leads.deletedAt))
      .groupBy(leads.source)
      .orderBy(desc(sql`count(*)`))
      .all();

    const byStage = db.select({
      stage: leads.stage,
      count: sql<number>`count(*)`,
      valueCents: sql<number>`coalesce(sum(${leads.estimatedValueCents}), 0)`,
    }).from(leads)
      .where(isNull(leads.deletedAt))
      .groupBy(leads.stage)
      .all();

    const winLoss = db.select({
      reason: leads.winLossReason,
      count: sql<number>`count(*)`,
    }).from(leads)
      .where(and(
        isNull(leads.deletedAt),
        eq(leads.stage, "lost"),
        sql`${leads.winLossReason} IS NOT NULL`,
      ))
      .groupBy(leads.winLossReason)
      .orderBy(desc(sql`count(*)`))
      .all();

    res.json({ monthlyRevenue, monthlyLeads, bySource, byStage, winLoss });
  });

  // ─── Leads ───────────────────────────────────────────────────────────────

  app.get("/api/crm/leads", requireAuth, (req, res) => {
    const conds: (SQL | undefined)[] = [isNull(leads.deletedAt)];

    const q = qstr(req.query.q);
    if (q) {
      const p = `%${q}%`;
      conds.push(or(
        like(leads.name, p),
        like(leads.email, p),
        like(leads.phone, p),
        like(leads.serviceRequested, p),
      ));
    }
    const source = qstr(req.query.source);
    if (source && (LEAD_SOURCES as readonly string[]).includes(source)) {
      conds.push(eq(leads.source, source as LeadSource));
    }
    const stage = qstr(req.query.stage);
    if (stage && (LEAD_STAGES as readonly string[]).includes(stage)) {
      conds.push(eq(leads.stage, stage as LeadStage));
    }
    const assignedTo = qstr(req.query.assignedTo);
    if (assignedTo) conds.push(eq(leads.assignedTo, parseInt(assignedTo, 10)));
    const serviceArea = qstr(req.query.serviceArea);
    if (serviceArea) conds.push(like(leads.serviceArea, `%${serviceArea}%`));
    // Calendar-date range on created_at, interpreted in server-local time
    // (same convention the rest of the app uses for "YYYY-MM-DD" fields).
    const from = qstr(req.query.from);
    if (from) conds.push(gte(leads.createdAt, new Date(`${from}T00:00:00`)));
    const to = qstr(req.query.to);
    if (to) conds.push(lte(leads.createdAt, new Date(`${to}T23:59:59.999`)));
    if (req.query.stale === "1") conds.push(eq(leads.stale, true));

    res.json(
      db.select().from(leads)
        .where(and(...conds))
        .orderBy(desc(leads.createdAt), desc(leads.id))
        .all(),
    );
  });

  registerCreate(app, "/api/crm/leads", requireAuth, {
    table: leads, schema: insertLeadSchema,
    action: "crm.lead_create", targetType: "lead",
    name: (r) => r.name, details: (r) => ({ source: r.source }), audit,
  });

  // Convert a lead into a client record. Idempotent: if the lead was already
  // converted (clientId set and the client still exists), return that client
  // instead of minting a duplicate.
  app.post("/api/crm/leads/:id/convert", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const lead = db.select().from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .get();
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (lead.clientId != null) {
      const existing = db.select().from(clients)
        .where(and(eq(clients.id, lead.clientId), isNull(clients.deletedAt)))
        .get();
      if (existing) return res.json(existing);
    }

    // serviceArea is "ZIP or city" on the lead — closest thing to a city.
    // Phase B #8: the pre-sale history rides along — lead notes land on the
    // client card, and the lead's activity feed is copied to the client's
    // (client feeds query entityType='client' only, so without the copy the
    // new card opens blank).
    const client = db.insert(clients).values({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      city: lead.serviceArea,
      notes: lead.notes ? `From lead: ${lead.notes}` : null,
    }).returning().get();
    db.update(leads).set({ clientId: client.id }).where(eq(leads.id, id)).run();
    for (const a of db.select().from(crmActivities)
      .where(and(eq(crmActivities.entityType, "lead"), eq(crmActivities.entityId, lead.id)))
      .all()) {
      db.insert(crmActivities).values({
        entityType: "client",
        entityId: client.id,
        userId: a.userId,
        kind: a.kind,
        notes: a.notes,
        createdAt: a.createdAt,
      }).run();
    }

    audit(req, "crm.lead_convert", {
      targetType: "lead", targetId: lead.id, targetName: lead.name,
      details: { clientId: client.id },
    });
    res.status(201).json(client);
  });

  // Extras for the lead detail modal beyond the list row it already has:
  // the website design the lead configured (Phase B #13 — web_designs.lead_id
  // is written on intake but was never read back). web_designs belongs to the
  // website module → raw SQL + try/catch; the design PNG is already in the
  // lead's photo strip.
  app.get("/api/crm/leads/:id/detail", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const lead = db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .get();
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    let design: unknown = null;
    try {
      design = sqlite.prepare(`
        SELECT ref, source_tool AS sourceTool, best_time AS bestTime,
               contact, service, location, design_spec AS designSpec,
               created_at AS createdAt
        FROM web_designs WHERE lead_id = ?
        ORDER BY created_at DESC, id DESC LIMIT 1
      `).get(id) ?? null;
    } catch { /* website module absent */ }
    res.json({ design });
  });

  app.patch("/api/crm/leads/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Lead not found" });

    let parsed;
    try {
      parsed = insertLeadSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    const now = Date.now();
    const update: Partial<typeof leads.$inferInsert> = { ...parsed };
    const stageChanged = parsed.stage !== undefined && parsed.stage !== existing.stage;

    if (stageChanged) {
      const to = parsed.stage as LeadStage;
      // (a) A stage change is contact by definition: clear the stale flag the
      // marketing sweep may have set, and stamp lastContactAt.
      update.stale = false;
      update.lastContactAt = now;

      if (to === "won" || to === "lost") {
        // (d) Closing a lead requires a reason — either in this PATCH or
        // already recorded on the row.
        const reason = parsed.winLossReason ?? existing.winLossReason;
        if (!reason) {
          return res.status(400).json({
            message: "winLossReason is required when marking a lead won or lost",
          });
        }
        update.winLossReason = reason;
        // Won leads carry the closed revenue. Accept it in the same PATCH;
        // fall back to any previously recorded value, then the original
        // estimate — better an estimate than a $0 win in the reports.
        if (to === "won" && parsed.revenueClosedCents === undefined) {
          update.revenueClosedCents =
            existing.revenueClosedCents || existing.estimatedValueCents;
        }
      }
    }

    const row = db.update(leads).set(update).where(eq(leads.id, id)).returning().get();
    if (!row) return res.status(404).json({ message: "Lead not found" });

    if (stageChanged) {
      // (b) / (c) marketing-side automation hooks — best-effort.
      if (row.stage === "won") maybeCreateReviewTask(row, now);
      if (row.stage === "quote_sent") ensureQuoteReminder(row, now);
      audit(req, "crm.lead_stage", {
        targetType: "lead", targetId: row.id, targetName: row.name,
        details: { from: existing.stage, to: row.stage },
      });
    }
    res.json(row);
  });

  registerSoftDelete(app, "/api/crm/leads/:id", requireElevated, {
    table: leads, notFound: "Lead not found",
    action: "crm.lead_delete", targetType: "lead", name: (r) => r.name, audit,
  });

  // ─── Clients ─────────────────────────────────────────────────────────────

  app.get("/api/crm/clients", requireAuth, (req, res) => {
    const conds: (SQL | undefined)[] = [isNull(clients.deletedAt)];
    const q = qstr(req.query.q);
    if (q) {
      const p = `%${q}%`;
      conds.push(or(
        like(clients.name, p),
        like(clients.company, p),
        like(clients.email, p),
        like(clients.phone, p),
      ));
    }
    const status = qstr(req.query.status);
    if (status && (CLIENT_STATUSES as readonly string[]).includes(status)) {
      conds.push(eq(clients.status, status as ClientStatus));
    }
    res.json(
      db.select().from(clients)
        .where(and(...conds))
        .orderBy(desc(clients.createdAt), desc(clients.id))
        .all(),
    );
  });

  // Combined detail payload (client + their leads/activity feed) in
  // one round-trip. Registered ABOVE /clients/:id so "detail" isn't eaten as
  // a second path segment... it's a sub-path of :id, but keep the literal-
  // before-param convention for anything that could collide.
  app.get("/api/crm/clients/:id/detail", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const client = db.select().from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .get();
    if (!client) return res.status(404).json({ message: "Client not found" });

    // Phase B #7: the client's invoices + balance owed. Money data — only for
    // roles that can open Finance (same rule as global search). fin_invoices
    // belongs to the finance module → raw SQL + try/catch. "overdue" derived
    // exactly like finance's presentInvoice; voided rows excluded from balance
    // by carrying balanceCents only on receivable statuses' math (UI sums
    // non-void, non-paid balances).
    const isElev = isElevated(req);
    let invoiceRows: {
      id: number; number: string; status: string;
      totalCents: number; balanceCents: number; dueDate: string | null;
    }[] = [];
    if (isElev) {
      try {
        const today = todayLocal();
        invoiceRows = (sqlite.prepare(`
          SELECT id, number, status, due_date AS dueDate,
                 total_cents AS totalCents,
                 -- Phase G #3: held retainage isn't due yet (finance's
                 -- presentInvoice does the same subtraction).
                 total_cents - COALESCE(retainage_cents, 0) - paid_cents AS balanceCents
          FROM fin_invoices
          WHERE deleted_at IS NULL AND client_id = ?
          ORDER BY created_at DESC, id DESC
        `).all(id) as any[]).map((r) => ({
          ...r,
          status: (r.status === "sent" || r.status === "partial")
            && r.dueDate && r.dueDate < today ? "overdue" : r.status,
        }));
      } catch { /* finance module absent */ }
    }

    // Phase B #12: has this customer reviewed us? mk_reviews belongs to
    // marketing → raw SQL + try/catch.
    let reviewCount = 0;
    try {
      reviewCount = (sqlite.prepare(
        "SELECT COUNT(*) AS n FROM mk_reviews WHERE client_id = ?",
      ).get(id) as { n: number }).n;
    } catch { /* marketing module absent / column not migrated */ }

    res.json({
      client,
      invoices: invoiceRows,
      reviewCount,
      leads: db.select().from(leads)
        .where(and(eq(leads.clientId, id), isNull(leads.deletedAt)))
        .orderBy(desc(leads.createdAt))
        .all(),
      activities: db.select().from(crmActivities)
        .where(and(eq(crmActivities.entityType, "client"), eq(crmActivities.entityId, id)))
        .orderBy(desc(crmActivities.createdAt))
        .all(),
      // Fix 2: the client's jobs — projects.clientId is a soft ref set by the
      // project form, the accept-quote hook, or the backfill script.
      projects: db.select().from(projects)
        .where(and(eq(projects.clientId, id), isNull(projects.deletedAt)))
        .orderBy(desc(projects.createdAt))
        .all(),
    });
  });

  registerGetById(app, "/api/crm/clients/:id", requireAuth, clients, "Client not found");

  registerCreate(app, "/api/crm/clients", requireAuth, {
    table: clients, schema: insertClientSchema,
    action: "crm.client_create", targetType: "client",
    name: (r) => r.name, audit,
  });

  app.patch("/api/crm/clients/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Client not found" });
    try {
      const parsed = insertClientSchema.partial().parse(req.body);
      const row = db.update(clients).set(parsed).where(eq(clients.id, id)).returning().get();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  registerSoftDelete(app, "/api/crm/clients/:id", requireElevated, {
    table: clients, notFound: "Client not found",
    action: "crm.client_delete", targetType: "client", name: (r) => r.name, audit,
  });

  // ─── Activities (touch log) ──────────────────────────────────────────────

  app.get("/api/crm/activities", requireAuth, (req, res) => {
    const entityType = qstr(req.query.entityType);
    const entityId = req.query.entityId ? parseInt(req.query.entityId as string, 10) : NaN;
    if (
      !entityType ||
      !["lead", "client"].includes(entityType) ||
      Number.isNaN(entityId)
    ) {
      return res.status(400).json({ message: "entityType and entityId are required" });
    }
    res.json(
      db.select().from(crmActivities)
        .where(and(
          eq(crmActivities.entityType, entityType as "lead" | "client"),
          eq(crmActivities.entityId, entityId),
        ))
        .orderBy(desc(crmActivities.createdAt), desc(crmActivities.id))
        .all(),
    );
  });

  app.post("/api/crm/activities", requireAuth, (req, res) => {
    try {
      const data = insertCrmActivitySchema.parse(req.body);
      const row = db.insert(crmActivities).values({
        ...data,
        userId: req.user?.userId ?? null,
      }).returning().get();
      // Logging contact against a lead is contact: refresh lastContactAt and
      // clear the stale flag the marketing sweep may have set.
      if (data.entityType === "lead") {
        db.update(leads)
          .set({ lastContactAt: Date.now(), stale: false })
          .where(and(eq(leads.id, data.entityId), isNull(leads.deletedAt)))
          .run();
      }
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
}
