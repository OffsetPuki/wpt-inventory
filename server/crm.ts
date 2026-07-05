import type { Express } from "express";
import {
  eq, and, or, desc, isNull, sql, like, gte, lte, notInArray, type SQL,
} from "drizzle-orm";
import { sqlite, db } from "./storage";
import { audit } from "./audit";
import { requireAuth } from "./auth";
import {
  clients, leads, deals, products, estimates, crmActivities,
  insertClientSchema, insertLeadSchema, insertDealSchema,
  insertProductSchema, insertEstimateSchema, insertCrmActivitySchema,
  LEAD_SOURCES, LEAD_STAGES, DEAL_STAGES, ESTIMATE_STATUSES, CLIENT_STATUSES,
  type Lead, type LeadStage, type LeadSource, type DealStage,
  type EstimateStatus, type ClientStatus,
} from "../shared/crm-schema";
// Cross-module automation hooks. These TABLE OBJECTS are safe to import (pure
// schema definitions); the underlying mk_ tables are created by the marketing
// module's DDL, not ours — so every read/write against them below is wrapped
// in try/catch and degrades to a no-op / defaults if that module isn't loaded.
import { mkTasks, marketingSettings } from "../shared/marketing-schema";
import {
  parseLineItems, lineItemsSchema, lineItemsTotalCents,
} from "../shared/biz-common";

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

  CREATE TABLE IF NOT EXISTS crm_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    client_id INTEGER REFERENCES crm_clients(id) ON DELETE SET NULL,
    lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
    value_cents INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'qualified',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expected_close_date TEXT,
    win_loss_reason TEXT,
    closed_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage);
  CREATE INDEX IF NOT EXISTS idx_crm_deals_owner ON crm_deals(owner_id);
  CREATE INDEX IF NOT EXISTS idx_crm_deals_client ON crm_deals(client_id);
  CREATE INDEX IF NOT EXISTS idx_crm_deals_lead ON crm_deals(lead_id);
  CREATE INDEX IF NOT EXISTS idx_crm_deals_created ON crm_deals(created_at);

  CREATE TABLE IF NOT EXISTS crm_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    unit TEXT,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_crm_products_active ON crm_products(active);
  CREATE INDEX IF NOT EXISTS idx_crm_products_created ON crm_products(created_at);

  CREATE TABLE IF NOT EXISTS crm_estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    client_id INTEGER REFERENCES crm_clients(id) ON DELETE SET NULL,
    lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
    deal_id INTEGER REFERENCES crm_deals(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    items TEXT NOT NULL DEFAULT '[]',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_rate_bp INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    valid_until TEXT,
    sent_at INTEGER,
    decided_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_crm_estimates_status ON crm_estimates(status);
  CREATE INDEX IF NOT EXISTS idx_crm_estimates_client ON crm_estimates(client_id);
  CREATE INDEX IF NOT EXISTS idx_crm_estimates_lead ON crm_estimates(lead_id);
  CREATE INDEX IF NOT EXISTS idx_crm_estimates_deal ON crm_estimates(deal_id);
  CREATE INDEX IF NOT EXISTS idx_crm_estimates_sent ON crm_estimates(sent_at);
  CREATE INDEX IF NOT EXISTS idx_crm_estimates_created ON crm_estimates(created_at);

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

// Quote-sent side effect: schedule a follow-up task in the marketing task
// list unless the lead already has an open quote reminder (dedupe, so
// re-sending an estimate doesn't stack reminders).
function ensureQuoteReminder(lead: Lead, now: number): void {
  try {
    const open = db.select({ id: mkTasks.id }).from(mkTasks)
      .where(and(
        eq(mkTasks.leadId, lead.id),
        eq(mkTasks.kind, "quote_reminder"),
        eq(mkTasks.status, "open"),
      ))
      .get();
    if (open) return;
    db.insert(mkTasks).values({
      title: `Follow up on quote — ${lead.name}`,
      kind: "quote_reminder",
      leadId: lead.id,
      autoCreated: true,
      dueAt: now + getAutomationSettings().quoteFollowUpDays * DAY_MS,
      status: "open",
    }).run();
  } catch {
    // mk_tasks not created yet — automation is best-effort, never block CRM.
  }
}

// Won side effect: ask the customer for a review (if the automation knob is
// on). Due in 3 days — soon enough that the job is fresh in their mind.
function maybeCreateReviewTask(lead: Lead, now: number): void {
  try {
    if (!getAutomationSettings().autoReviewRequest) return;
    // Dedupe like ensureQuoteReminder: re-winning a corrected lead must not
    // stack a second "ask for a review" task on top of an open one.
    const open = db.select({ id: mkTasks.id }).from(mkTasks)
      .where(and(
        eq(mkTasks.leadId, lead.id),
        eq(mkTasks.kind, "review_request"),
        eq(mkTasks.status, "open"),
      ))
      .get();
    if (open) return;
    db.insert(mkTasks).values({
      title: `Ask ${lead.name} for a review`,
      kind: "review_request",
      leadId: lead.id,
      autoCreated: true,
      dueAt: now + 3 * DAY_MS,
      status: "open",
    }).run();
  } catch {
    // mk_tasks not created yet — see ensureQuoteReminder.
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

// Server-side totals — never trust client-supplied subtotal/tax/total. Throws
// (zod) on malformed line items so callers surface a 400.
function computeEstimateTotals(itemsJson: string, taxRateBp: number): {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
} {
  const items = lineItemsSchema.parse(parseLineItems(itemsJson));
  const subtotalCents = lineItemsTotalCents(items);
  const taxCents = Math.round((subtotalCents * taxRateBp) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

// "EST-<year>-<0000>" — seq seeded from max(id)+1 so numbers are roughly
// monotonic, with a bounded retry on UNIQUE collision (two concurrent posts,
// or ids that outran the numbers after a year rollover).
function insertEstimateWithNumber(
  values: Omit<typeof estimates.$inferInsert, "number">,
): typeof estimates.$inferSelect {
  const year = new Date().getFullYear();
  let seq = (db.select({ m: sql<number>`coalesce(max(${estimates.id}), 0)` })
    .from(estimates).get()?.m ?? 0) + 1;
  for (let attempt = 0; attempt < 50; attempt++, seq++) {
    const number = `EST-${year}-${String(seq).padStart(4, "0")}`;
    try {
      return db.insert(estimates).values({ ...values, number }).returning().get();
    } catch (e: any) {
      if (String(e?.message ?? e).includes("UNIQUE")) continue;
      throw e;
    }
  }
  throw new Error("Could not allocate an estimate number — too many collisions");
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerCrmRoutes(app: Express): void {
  // Express types req.params.* as string | string[]; narrow to number.
  const pid = (v: string | string[]): number => parseInt(v as string, 10);
  const qstr = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

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

    // Pipeline = everything still in play: open leads' estimated value plus
    // open deals' value.
    const leadPipeline = db.select({ v: sql<number>`coalesce(sum(${leads.estimatedValueCents}), 0)` })
      .from(leads)
      .where(and(isNull(leads.deletedAt), notInArray(leads.stage, ["won", "lost"])))
      .get()?.v ?? 0;
    const dealPipeline = db.select({ v: sql<number>`coalesce(sum(${deals.valueCents}), 0)` })
      .from(deals)
      .where(and(isNull(deals.deletedAt), notInArray(deals.stage, ["won", "lost"])))
      .get()?.v ?? 0;

    const quotesSentLast30 = db.select({ n: sql<number>`count(*)` }).from(estimates)
      .where(and(isNull(estimates.deletedAt), gte(estimates.sentAt, monthAgoMs)))
      .get()?.n ?? 0;

    const closed = db.select({
      won: sql<number>`coalesce(sum(case when ${leads.stage} = 'won' then 1 else 0 end), 0)`,
      lost: sql<number>`coalesce(sum(case when ${leads.stage} = 'lost' then 1 else 0 end), 0)`,
    }).from(leads).where(isNull(leads.deletedAt)).get() ?? { won: 0, lost: 0 };
    const closeRate = closed.won + closed.lost > 0
      ? closed.won / (closed.won + closed.lost)
      : null;

    // APPROXIMATION: the schema has no closedAt on leads, so "won in the last
    // 30 days" is proxied by lastContactAt — every stage change (including
    // → won) stamps lastContactAt, so this is right unless a lead is touched
    // again after winning. Good enough for a dashboard tile.
    const revenueClosed30dCents = db.select({ v: sql<number>`coalesce(sum(${leads.revenueClosedCents}), 0)` })
      .from(leads)
      .where(and(
        isNull(leads.deletedAt),
        eq(leads.stage, "won"),
        gte(leads.lastContactAt, monthAgoMs),
      ))
      .get()?.v ?? 0;

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
      pipelineValueCents: leadPipeline + dealPipeline,
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

    // REVENUE PROXY DECISION: monthly revenue comes from ACCEPTED estimates
    // bucketed by the month they were accepted (decidedAt). Lead
    // revenueClosedCents has no close timestamp in the schema, so estimates
    // are the one source with an honest date attached to the money.
    const revMonth = sql<string>`strftime('%Y-%m', ${estimates.decidedAt} / 1000, 'unixepoch')`;
    const monthlyRevenue = db.select({
      month: revMonth,
      revenueCents: sql<number>`coalesce(sum(${estimates.totalCents}), 0)`,
    }).from(estimates)
      .where(and(
        isNull(estimates.deletedAt),
        eq(estimates.status, "accepted"),
        gte(estimates.decidedAt, cutoffMs),
      ))
      .groupBy(revMonth)
      .orderBy(revMonth)
      .all();

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

  app.post("/api/crm/leads", requireAuth, (req, res) => {
    try {
      const data = insertLeadSchema.parse(req.body);
      const row = db.insert(leads).values(data).returning().get();
      audit(req, "crm.lead_create", {
        targetType: "lead", targetId: row.id, targetName: row.name,
        details: { source: row.source },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
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
    const client = db.insert(clients).values({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      city: lead.serviceArea,
    }).returning().get();
    db.update(leads).set({ clientId: client.id }).where(eq(leads.id, id)).run();

    audit(req, "crm.lead_convert", {
      targetType: "lead", targetId: lead.id, targetName: lead.name,
      details: { clientId: client.id },
    });
    res.status(201).json(client);
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

  app.delete("/api/crm/leads/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Lead not found" });
    db.update(leads).set({ deletedAt: Date.now() }).where(eq(leads.id, id)).run();
    audit(req, "crm.lead_delete", {
      targetType: "lead", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
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

  // Combined detail payload (client + their leads/estimates/activity feed) in
  // one round-trip. Registered ABOVE /clients/:id so "detail" isn't eaten as
  // a second path segment... it's a sub-path of :id, but keep the literal-
  // before-param convention for anything that could collide.
  app.get("/api/crm/clients/:id/detail", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const client = db.select().from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .get();
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json({
      client,
      leads: db.select().from(leads)
        .where(and(eq(leads.clientId, id), isNull(leads.deletedAt)))
        .orderBy(desc(leads.createdAt))
        .all(),
      estimates: db.select().from(estimates)
        .where(and(eq(estimates.clientId, id), isNull(estimates.deletedAt)))
        .orderBy(desc(estimates.createdAt))
        .all(),
      activities: db.select().from(crmActivities)
        .where(and(eq(crmActivities.entityType, "client"), eq(crmActivities.entityId, id)))
        .orderBy(desc(crmActivities.createdAt))
        .all(),
    });
  });

  app.get("/api/crm/clients/:id", requireAuth, (req, res) => {
    const client = db.select().from(clients)
      .where(and(eq(clients.id, pid(req.params.id)), isNull(clients.deletedAt)))
      .get();
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  });

  app.post("/api/crm/clients", requireAuth, (req, res) => {
    try {
      const data = insertClientSchema.parse(req.body);
      const row = db.insert(clients).values(data).returning().get();
      audit(req, "crm.client_create", {
        targetType: "client", targetId: row.id, targetName: row.name,
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
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

  app.delete("/api/crm/clients/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Client not found" });
    db.update(clients).set({ deletedAt: Date.now() }).where(eq(clients.id, id)).run();
    audit(req, "crm.client_delete", {
      targetType: "client", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
  });

  // ─── Deals ───────────────────────────────────────────────────────────────

  app.get("/api/crm/deals", requireAuth, (req, res) => {
    const conds: (SQL | undefined)[] = [isNull(deals.deletedAt)];
    const stage = qstr(req.query.stage);
    if (stage && (DEAL_STAGES as readonly string[]).includes(stage)) {
      conds.push(eq(deals.stage, stage as DealStage));
    }
    const ownerId = qstr(req.query.ownerId);
    if (ownerId) conds.push(eq(deals.ownerId, parseInt(ownerId, 10)));
    res.json(
      db.select().from(deals)
        .where(and(...conds))
        .orderBy(desc(deals.createdAt), desc(deals.id))
        .all(),
    );
  });

  app.get("/api/crm/deals/:id", requireAuth, (req, res) => {
    const deal = db.select().from(deals)
      .where(and(eq(deals.id, pid(req.params.id)), isNull(deals.deletedAt)))
      .get();
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });

  app.post("/api/crm/deals", requireAuth, (req, res) => {
    try {
      const data = insertDealSchema.parse(req.body);
      const row = db.insert(deals).values(data).returning().get();
      audit(req, "crm.deal_create", {
        targetType: "deal", targetId: row.id, targetName: row.title,
        details: { valueCents: row.valueCents },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/crm/deals/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(deals)
      .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Deal not found" });

    let parsed;
    try {
      parsed = insertDealSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    const update: Partial<typeof deals.$inferInsert> = { ...parsed };
    const stageChanged = parsed.stage !== undefined && parsed.stage !== existing.stage;
    if (stageChanged) {
      // closedAt tracks the win/lose moment; reopening a closed deal clears it.
      update.closedAt =
        parsed.stage === "won" || parsed.stage === "lost" ? Date.now() : null;
    }

    const row = db.update(deals).set(update).where(eq(deals.id, id)).returning().get();
    if (!row) return res.status(404).json({ message: "Deal not found" });

    if (stageChanged) {
      audit(req, "crm.deal_stage", {
        targetType: "deal", targetId: row.id, targetName: row.title,
        details: { from: existing.stage, to: row.stage, valueCents: row.valueCents },
      });
    }
    res.json(row);
  });

  app.delete("/api/crm/deals/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(deals)
      .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Deal not found" });
    db.update(deals).set({ deletedAt: Date.now() }).where(eq(deals.id, id)).run();
    audit(req, "crm.deal_delete", {
      targetType: "deal", targetId: id, targetName: target.title,
    });
    res.json({ ok: true });
  });

  // ─── Products / services catalog ─────────────────────────────────────────

  app.get("/api/crm/products", requireAuth, (req, res) => {
    const conds: (SQL | undefined)[] = [isNull(products.deletedAt)];
    const q = qstr(req.query.q);
    if (q) {
      const p = `%${q}%`;
      conds.push(or(
        like(products.name, p),
        like(products.sku, p),
        like(products.description, p),
      ));
    }
    // active=1 / active=0 — anything else means "no filter".
    if (req.query.active === "1") conds.push(eq(products.active, true));
    else if (req.query.active === "0") conds.push(eq(products.active, false));

    res.json(
      db.select().from(products)
        .where(and(...conds))
        .orderBy(desc(products.createdAt), desc(products.id))
        .all(),
    );
  });

  app.get("/api/crm/products/:id", requireAuth, (req, res) => {
    const product = db.select().from(products)
      .where(and(eq(products.id, pid(req.params.id)), isNull(products.deletedAt)))
      .get();
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  });

  app.post("/api/crm/products", requireAuth, (req, res) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const row = db.insert(products).values(data).returning().get();
      audit(req, "crm.product_create", {
        targetType: "product", targetId: row.id, targetName: row.name,
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/crm/products/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Product not found" });
    try {
      const parsed = insertProductSchema.partial().parse(req.body);
      const row = db.update(products).set(parsed).where(eq(products.id, id)).returning().get();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/crm/products/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Product not found" });
    db.update(products).set({ deletedAt: Date.now() }).where(eq(products.id, id)).run();
    audit(req, "crm.product_delete", {
      targetType: "product", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
  });

  // ─── Estimates ───────────────────────────────────────────────────────────

  app.get("/api/crm/estimates", requireAuth, (req, res) => {
    const conds: (SQL | undefined)[] = [isNull(estimates.deletedAt)];
    const status = qstr(req.query.status);
    if (status && (ESTIMATE_STATUSES as readonly string[]).includes(status)) {
      conds.push(eq(estimates.status, status as EstimateStatus));
    }
    const clientId = qstr(req.query.clientId);
    if (clientId) conds.push(eq(estimates.clientId, parseInt(clientId, 10)));
    const leadId = qstr(req.query.leadId);
    if (leadId) conds.push(eq(estimates.leadId, parseInt(leadId, 10)));
    const q = qstr(req.query.q);
    if (q) {
      const p = `%${q}%`;
      conds.push(or(like(estimates.number, p), like(estimates.title, p)));
    }
    res.json(
      db.select().from(estimates)
        .where(and(...conds))
        .orderBy(desc(estimates.createdAt), desc(estimates.id))
        .all(),
    );
  });

  app.get("/api/crm/estimates/:id", requireAuth, (req, res) => {
    const estimate = db.select().from(estimates)
      .where(and(eq(estimates.id, pid(req.params.id)), isNull(estimates.deletedAt)))
      .get();
    if (!estimate) return res.status(404).json({ message: "Estimate not found" });
    res.json(estimate);
  });

  app.post("/api/crm/estimates", requireAuth, (req, res) => {
    try {
      // Accept items as either a JSON string (the column shape) or a raw
      // array — clients usually build the line items as an array.
      const body = { ...req.body };
      if (Array.isArray(body.items)) body.items = JSON.stringify(body.items);
      const data = insertEstimateSchema.parse(body);

      // Totals are always recomputed server-side from the line items —
      // client-supplied subtotal/tax/total are ignored.
      const totals = computeEstimateTotals(data.items ?? "[]", data.taxRateBp ?? 0);

      const now = Date.now();
      const status = data.status ?? "draft";
      const row = insertEstimateWithNumber({
        ...data,
        ...totals,
        sentAt: status === "sent" ? now : null,
        // Recording an after-the-fact verbal accept/decline directly on create
        // still needs decidedAt — the monthly-revenue report groups by it.
        decidedAt: status === "accepted" || status === "declined" ? now : null,
      });
      // Creating an estimate directly in "sent" behaves like a draft→sent
      // transition: stamp the linked lead and schedule the follow-up.
      if (status === "sent" && row.leadId != null) bumpLeadForQuote(row.leadId, now);

      audit(req, "crm.estimate_create", {
        targetType: "estimate", targetId: row.id, targetName: row.number,
        details: { totalCents: row.totalCents, status: row.status },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/crm/estimates/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(estimates)
      .where(and(eq(estimates.id, id), isNull(estimates.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Estimate not found" });

    try {
      const body = { ...req.body };
      if (Array.isArray(body.items)) body.items = JSON.stringify(body.items);
      const parsed = insertEstimateSchema.partial().parse(body);

      const update: Partial<typeof estimates.$inferInsert> = { ...parsed };
      // Any change to line items or the tax rate invalidates the stored
      // totals — recompute from whichever side (new or existing) applies.
      if (parsed.items !== undefined || parsed.taxRateBp !== undefined) {
        Object.assign(update, computeEstimateTotals(
          parsed.items ?? existing.items,
          parsed.taxRateBp ?? existing.taxRateBp,
        ));
      }

      const now = Date.now();
      const statusChanged = parsed.status !== undefined && parsed.status !== existing.status;
      if (statusChanged) {
        if (parsed.status === "sent") update.sentAt = now;
        if (parsed.status === "accepted" || parsed.status === "declined") {
          update.decidedAt = now;
        }
      }

      // A patch whose keys were all schema-stripped (e.g. only server-derived
      // totals) is a no-op — drizzle's set({}) would throw.
      if (Object.keys(update).length === 0) return res.json(existing);

      const row = db.update(estimates).set(update).where(eq(estimates.id, id)).returning().get();
      if (!row) return res.status(404).json({ message: "Estimate not found" });

      if (statusChanged) {
        if (row.status === "sent" && row.leadId != null) bumpLeadForQuote(row.leadId, now);
        audit(req, "crm.estimate_status", {
          targetType: "estimate", targetId: row.id, targetName: row.number,
          details: { from: existing.status, to: row.status, totalCents: row.totalCents },
        });
      }
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/crm/estimates/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(estimates)
      .where(and(eq(estimates.id, id), isNull(estimates.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Estimate not found" });
    db.update(estimates).set({ deletedAt: Date.now() }).where(eq(estimates.id, id)).run();
    audit(req, "crm.estimate_delete", {
      targetType: "estimate", targetId: id, targetName: target.number,
    });
    res.json({ ok: true });
  });

  // ─── Activities (touch log) ──────────────────────────────────────────────

  app.get("/api/crm/activities", requireAuth, (req, res) => {
    const entityType = qstr(req.query.entityType);
    const entityId = req.query.entityId ? parseInt(req.query.entityId as string, 10) : NaN;
    if (
      !entityType ||
      !["lead", "client", "deal"].includes(entityType) ||
      Number.isNaN(entityId)
    ) {
      return res.status(400).json({ message: "entityType and entityId are required" });
    }
    res.json(
      db.select().from(crmActivities)
        .where(and(
          eq(crmActivities.entityType, entityType as "lead" | "client" | "deal"),
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
