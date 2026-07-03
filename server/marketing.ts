import type { Express, Request } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { sqlite, db, storage } from "./storage";
import { requireAuth, requireElevated } from "./auth";
import {
  campaigns, reviews, mkTasks, marketingSettings,
  insertCampaignSchema, insertReviewSchema, insertMkTaskSchema,
  updateMarketingSettingsSchema,
  CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, REVIEW_SOURCES,
  MK_TASK_KINDS, MK_TASK_STATUSES,
  type MarketingSettings,
} from "../shared/marketing-schema";
// Cross-module READ: the CRM module owns crm_leads / crm_estimates (tables +
// endpoints). Marketing only reads them for funnel/source/campaign reporting,
// plus one narrow write: the automation sweep flips crm_leads.stale.
import { leads, estimates, LEAD_STAGES } from "../shared/crm-schema";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Table creation (synchronous DDL) ────────────────────────────────────────
// mk_tasks.lead_id is a soft reference to crm_leads — deliberately NO
// REFERENCES clause, so this module's DDL doesn't depend on the CRM module's
// tables existing first (avoids boot-order coupling between module files).

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS mk_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'active',
    start_date TEXT,
    end_date TEXT,
    budget_cents INTEGER NOT NULL DEFAULT 0,
    spend_cents INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    -- Soft delete: NULL = active.
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_mk_campaigns_status ON mk_campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_mk_campaigns_channel ON mk_campaigns(channel);
  CREATE INDEX IF NOT EXISTS idx_mk_campaigns_created ON mk_campaigns(created_at);

  CREATE TABLE IF NOT EXISTS mk_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'google',
    author TEXT,
    rating INTEGER NOT NULL DEFAULT 5,
    text TEXT,
    review_date TEXT,
    responded INTEGER NOT NULL DEFAULT 0,
    responded_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_mk_reviews_source ON mk_reviews(source);
  CREATE INDEX IF NOT EXISTS idx_mk_reviews_responded ON mk_reviews(responded);
  CREATE INDEX IF NOT EXISTS idx_mk_reviews_created ON mk_reviews(created_at);

  CREATE TABLE IF NOT EXISTS mk_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    lead_id INTEGER, -- soft ref to crm_leads (no FK: see note above)
    campaign_id INTEGER REFERENCES mk_campaigns(id) ON DELETE SET NULL,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_at INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    auto_created INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_status ON mk_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_kind ON mk_tasks(kind);
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_lead ON mk_tasks(lead_id);
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_campaign ON mk_tasks(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_assigned ON mk_tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_due ON mk_tasks(due_at);
  CREATE INDEX IF NOT EXISTS idx_mk_tasks_created ON mk_tasks(created_at);

  CREATE TABLE IF NOT EXISTS mk_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stale_lead_days INTEGER NOT NULL DEFAULT 7,
    quote_follow_up_days INTEGER NOT NULL DEFAULT 3,
    cpl_alert_cents INTEGER NOT NULL DEFAULT 15000,
    auto_review_request INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
`);

// Singleton settings row — the automation sweep and the alert thresholds read
// it unconditionally, so guarantee it exists at boot rather than lazily.
sqlite.prepare("INSERT OR IGNORE INTO mk_settings (id) VALUES (1)").run();

// ─── Small helpers ───────────────────────────────────────────────────────────

function getSettingsRow(): MarketingSettings {
  const row = db.select().from(marketingSettings).where(eq(marketingSettings.id, 1)).get();
  if (row) return row;
  // Extremely defensive — the boot insert above makes this unreachable in
  // practice, but a truncated table shouldn't take the module down.
  sqlite.prepare("INSERT OR IGNORE INTO mk_settings (id) VALUES (1)").run();
  return db.select().from(marketingSettings).where(eq(marketingSettings.id, 1)).get()!;
}

// Whole dollars when clean, cents otherwise — alert sentences read better as
// "$150" than "$150.00".
function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

// Drop keys a partial zod parse left undefined — better-sqlite3 can't bind
// undefined, and we don't want "field absent" to null anything out.
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// Same fire-and-forget audit pattern as routes.ts: snapshot request fields
// synchronously (req may be recycled by the time setImmediate fires), then
// defer the insert off the response path.
function audit(req: Request, action: string, extras: {
  targetType?: string | null;
  targetId?: number | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
} = {}): void {
  const entry = {
    userId: req.user?.userId ?? null,
    userName: req.user?.name ?? null,
    role: req.user?.role ?? null,
    action,
    targetType: extras.targetType ?? null,
    targetId: extras.targetId ?? null,
    targetName: extras.targetName ?? null,
    ip: req.ip ?? null,
    details: extras.details ?? null,
  };
  setImmediate(() => {
    try {
      storage.appendAudit(entry);
    } catch (e) {
      console.error("[audit] failed to write entry", e);
    }
  });
}

// ─── Alerts (computed on demand, never stored) ───────────────────────────────
// (a) active campaign with ≥1 lead whose all-time cost-per-lead exceeds the
//     configured threshold; (b) active campaign burning spend with zero leads
//     in the last 14 days; (c) overdue open tasks.

function computeAlerts(now: number): string[] {
  const alerts: string[] = [];
  const cfg = getSettingsRow();

  const active = db.select().from(campaigns)
    .where(and(eq(campaigns.status, "active"), isNull(campaigns.deletedAt)))
    .all();

  if (active.length > 0) {
    // One grouped pass over leads: all-time count + last-14d count per campaign.
    // leads.createdAt is stored as unix ms, so a plain numeric bind compares fine.
    const rows = db.select({
      campaignId: leads.campaignId,
      total: sql<number>`count(*)`,
      recent: sql<number>`sum(case when ${leads.createdAt} >= ${now - 14 * DAY_MS} then 1 else 0 end)`,
    })
      .from(leads)
      .where(and(isNull(leads.deletedAt), isNotNull(leads.campaignId)))
      .groupBy(leads.campaignId)
      .all();
    const byCampaign = new Map(rows.map((r) => [r.campaignId, r]));

    for (const c of active) {
      const counts = byCampaign.get(c.id);
      const total = counts?.total ?? 0;
      if (total > 0) {
        const cpl = Math.round(c.spendCents / total);
        if (cpl > cfg.cplAlertCents) {
          alerts.push(
            `Cost per lead on ${c.name} is ${fmtUsd(cpl)} — above your ${fmtUsd(cfg.cplAlertCents)} alert threshold.`
          );
        }
      }
      if (c.spendCents > 0 && (counts?.recent ?? 0) === 0) {
        alerts.push(`${c.name} has spend but produced no leads in 14 days.`);
      }
    }
  }

  const overdue = db.select({ n: sql<number>`count(*)` }).from(mkTasks)
    .where(and(
      eq(mkTasks.status, "open"),
      isNotNull(mkTasks.dueAt),
      sql`${mkTasks.dueAt} < ${now}`,
    )).get()?.n ?? 0;
  if (overdue > 0) {
    alerts.push(overdue === 1
      ? "1 marketing task is overdue."
      : `${overdue} marketing tasks are overdue.`);
  }

  return alerts;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerMarketingRoutes(app: Express): void {
  // Express types `req.params.*` as `string | string[]`; narrow to string.
  const pid = (v: string | string[]): number => parseInt(v as string, 10);
  const qstr = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  // ─── Stats (dashboard tile) ───────────────────────────────────────────────
  // Literal paths (/stats, /overview, /settings) are registered before any
  // parameterized siblings so they aren't captured as :id.

  app.get("/api/marketing/stats", requireElevated, (_req, res) => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const thirtyAgo = now - 30 * DAY_MS;

    const leadsThisWeek = db.select({ n: sql<number>`count(*)` }).from(leads)
      .where(and(isNull(leads.deletedAt), sql`${leads.createdAt} >= ${weekAgo}`))
      .get()?.n ?? 0;

    // "Active in the last 30 days" ≈ still active now, or has an end date
    // inside the window. start/end dates are optional free text on campaigns,
    // so this is the closest cheap approximation.
    const isoCut = new Date(thirtyAgo).toISOString().slice(0, 10);
    const spend30 = db.select({ total: sql<number>`coalesce(sum(${campaigns.spendCents}), 0)` })
      .from(campaigns)
      .where(and(
        isNull(campaigns.deletedAt),
        or(
          eq(campaigns.status, "active"),
          sql`${campaigns.endDate} IS NOT NULL AND ${campaigns.endDate} >= ${isoCut}`,
        ),
      )).get()?.total ?? 0;
    const attributedLeads30 = db.select({ n: sql<number>`count(*)` }).from(leads)
      .where(and(
        isNull(leads.deletedAt),
        isNotNull(leads.campaignId),
        sql`${leads.createdAt} >= ${thirtyAgo}`,
      )).get()?.n ?? 0;
    const cplCents30d = spend30 > 0 && attributedLeads30 > 0
      ? Math.round(spend30 / attributedLeads30)
      : null;

    const activeCampaigns = db.select({ n: sql<number>`count(*)` }).from(campaigns)
      .where(and(eq(campaigns.status, "active"), isNull(campaigns.deletedAt)))
      .get()?.n ?? 0;

    const openTasks = db.select({ n: sql<number>`count(*)` }).from(mkTasks)
      .where(eq(mkTasks.status, "open")).get()?.n ?? 0;
    const overdueTasks = db.select({ n: sql<number>`count(*)` }).from(mkTasks)
      .where(and(
        eq(mkTasks.status, "open"),
        isNotNull(mkTasks.dueAt),
        sql`${mkTasks.dueAt} < ${now}`,
      )).get()?.n ?? 0;

    // Reviews are often logged after the fact, so prefer the review's own
    // date (text "YYYY-MM-DD" → ms via unixepoch) over when it was entered.
    const avgRow = db.select({ avg: sql<number | null>`avg(${reviews.rating})` }).from(reviews)
      .where(sql`COALESCE(
        CASE WHEN ${reviews.reviewDate} IS NOT NULL THEN unixepoch(${reviews.reviewDate}) * 1000 END,
        ${reviews.createdAt}
      ) >= ${thirtyAgo}`)
      .get();
    const avgRating30d = avgRow?.avg != null ? Math.round(avgRow.avg * 100) / 100 : null;

    const unrespondedReviews = db.select({ n: sql<number>`count(*)` }).from(reviews)
      .where(eq(reviews.responded, false)).get()?.n ?? 0;

    res.json({
      leadsThisWeek,
      cplCents30d,
      activeCampaigns,
      openTasks,
      overdueTasks,
      avgRating30d,
      unrespondedReviews,
      alerts: computeAlerts(now),
    });
  });

  // ─── Overview (control-center payload) ────────────────────────────────────
  // Small-business data volumes: pull the lead/estimate/campaign working sets
  // once and aggregate in JS rather than issuing a dozen GROUP BY queries.

  app.get("/api/marketing/overview", requireElevated, (_req, res) => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const d = new Date(now);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

    const allLeads = db.select({
      id: leads.id,
      source: leads.source,
      stage: leads.stage,
      campaignId: leads.campaignId,
      revenueClosedCents: leads.revenueClosedCents,
      createdAt: leads.createdAt,
      lastContactAt: leads.lastContactAt,
    }).from(leads).where(isNull(leads.deletedAt)).all();

    const allEstimates = db.select({
      leadId: estimates.leadId,
      status: estimates.status,
      sentAt: estimates.sentAt,
      decidedAt: estimates.decidedAt,
      totalCents: estimates.totalCents,
    }).from(estimates).where(isNull(estimates.deletedAt)).all();

    const allCampaigns = db.select().from(campaigns)
      .where(isNull(campaigns.deletedAt))
      .orderBy(desc(campaigns.createdAt))
      .all();

    // ── This week ──
    const leadsWk = allLeads.filter((l) => l.createdAt.getTime() >= weekAgo);
    const quotesSent = allEstimates.filter((e) => e.sentAt != null && e.sentAt >= weekAgo).length;

    // Close rate among leads decided this month. Leads don't carry a
    // decided_at, so approximate "decided this month" with the last contact
    // (falling back to creation) landing in the current calendar month —
    // stage flips to won/lost as part of that final touch in practice.
    const decided = allLeads.filter((l) =>
      (l.stage === "won" || l.stage === "lost") &&
      (l.lastContactAt ?? l.createdAt.getTime()) >= monthStart
    );
    const wonThisMonth = decided.filter((l) => l.stage === "won").length;
    const closeRate = decided.length > 0 ? wonThisMonth / decided.length : null;

    const spendCents = allCampaigns
      .filter((c) => c.status === "active")
      .reduce((sum, c) => sum + c.spendCents, 0);

    const revenueCents = allEstimates
      .filter((e) => e.status === "accepted" && e.decidedAt != null && e.decidedAt >= monthStart)
      .reduce((sum, e) => sum + e.totalCents, 0);

    let bestSource: { source: string; leads: number } | null = null;
    {
      const bySrc = new Map<string, number>();
      for (const l of leadsWk) bySrc.set(l.source, (bySrc.get(l.source) ?? 0) + 1);
      for (const [source, n] of bySrc) {
        if (!bestSource || n > bestSource.leads) bestSource = { source, leads: n };
      }
    }

    // ── Funnel ── every stage, zero-filled, in pipeline order.
    const funnel = LEAD_STAGES.map((stage) => ({
      stage,
      count: allLeads.filter((l) => l.stage === stage).length,
    }));

    // ── By source ── "quoteSent" = leads with at least one sent estimate
    // (estimate linkage, not current stage — a won lead still had a quote).
    const leadsWithSentQuote = new Set<number>();
    for (const e of allEstimates) {
      if (e.leadId != null && e.sentAt != null) leadsWithSentQuote.add(e.leadId);
    }
    const srcMap = new Map<string, { source: string; leads: number; quoteSent: number; won: number; revenueCents: number }>();
    for (const l of allLeads) {
      let row = srcMap.get(l.source);
      if (!row) {
        row = { source: l.source, leads: 0, quoteSent: 0, won: 0, revenueCents: 0 };
        srcMap.set(l.source, row);
      }
      row.leads++;
      if (leadsWithSentQuote.has(l.id)) row.quoteSent++;
      if (l.stage === "won") {
        row.won++;
        row.revenueCents += l.revenueClosedCents;
      }
    }
    const bySource = [...srcMap.values()].sort((a, b) => b.leads - a.leads);

    // ── Campaign performance ──
    const estimateCountByLead = new Map<number, number>();
    for (const e of allEstimates) {
      if (e.leadId != null) {
        estimateCountByLead.set(e.leadId, (estimateCountByLead.get(e.leadId) ?? 0) + 1);
      }
    }
    const campaignPerf = allCampaigns.map((c) => {
      const campLeads = allLeads.filter((l) => l.campaignId === c.id);
      const estimateCount = campLeads.reduce(
        (sum, l) => sum + (estimateCountByLead.get(l.id) ?? 0), 0
      );
      return {
        id: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        spendCents: c.spendCents,
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: c.impressions > 0 ? c.clicks / c.impressions : null,
        leads: campLeads.length,
        cplCents: campLeads.length > 0 ? Math.round(c.spendCents / campLeads.length) : null,
        estimates: estimateCount,
        won: campLeads.filter((l) => l.stage === "won").length,
      };
    });

    res.json({
      thisWeek: {
        leads: leadsWk.length,
        quotesSent,
        closeRate,
        spendCents,
        revenueCents,
        bestSource,
      },
      funnel,
      bySource,
      campaignPerf,
      alerts: computeAlerts(now),
    });
  });

  // ─── Settings (singleton) ─────────────────────────────────────────────────

  app.get("/api/marketing/settings", requireElevated, (_req, res) => {
    res.json(getSettingsRow());
  });

  app.put("/api/marketing/settings", requireElevated, (req, res) => {
    let body;
    try {
      body = updateMarketingSettingsSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const updates = stripUndefined(body);
    getSettingsRow(); // guarantees the row exists before UPDATE
    db.update(marketingSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(marketingSettings.id, 1))
      .run();
    const row = getSettingsRow();
    audit(req, "marketing.settings_update", {
      targetType: "marketing_settings", targetId: 1,
      details: updates as Record<string, unknown>,
    });
    res.json(row);
  });

  // ─── Campaigns ────────────────────────────────────────────────────────────

  app.get("/api/marketing/campaigns", requireElevated, (req, res) => {
    const status = qstr(req.query.status);
    const channel = qstr(req.query.channel);
    if (status && !(CAMPAIGN_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${CAMPAIGN_STATUSES.join(", ")}` });
    }
    if (channel && !(CAMPAIGN_CHANNELS as readonly string[]).includes(channel)) {
      return res.status(400).json({ message: `channel must be one of: ${CAMPAIGN_CHANNELS.join(", ")}` });
    }
    const conds = [isNull(campaigns.deletedAt)];
    if (status) conds.push(eq(campaigns.status, status as (typeof CAMPAIGN_STATUSES)[number]));
    if (channel) conds.push(eq(campaigns.channel, channel as (typeof CAMPAIGN_CHANNELS)[number]));
    const rows = db.select().from(campaigns)
      .where(and(...conds))
      .orderBy(desc(campaigns.createdAt))
      .all();
    res.json(rows);
  });

  app.post("/api/marketing/campaigns", requireElevated, (req, res) => {
    let body;
    try {
      body = insertCampaignSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const row = db.insert(campaigns).values(body).returning().get();
    audit(req, "marketing.campaign_create", {
      targetType: "campaign", targetId: row.id, targetName: row.name,
      details: { channel: row.channel, budgetCents: row.budgetCents },
    });
    res.status(201).json(row);
  });

  app.patch("/api/marketing/campaigns/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const before = db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), isNull(campaigns.deletedAt)))
      .get();
    if (!before) return res.status(404).json({ message: "Campaign not found" });
    let body;
    try {
      body = insertCampaignSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const updates = stripUndefined(body);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    const row = db.update(campaigns).set(updates)
      .where(eq(campaigns.id, id))
      .returning().get();
    // Status flips (pause/resume/end) are the interesting transitions.
    if (updates.status && updates.status !== before.status) {
      audit(req, "marketing.campaign_status", {
        targetType: "campaign", targetId: id, targetName: before.name,
        details: { from: before.status, to: updates.status },
      });
    }
    res.json(row);
  });

  app.delete("/api/marketing/campaigns/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), isNull(campaigns.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Campaign not found" });
    db.update(campaigns).set({ deletedAt: Date.now() })
      .where(eq(campaigns.id, id))
      .run();
    audit(req, "marketing.campaign_delete", {
      targetType: "campaign", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
  });

  // ─── Reviews ──────────────────────────────────────────────────────────────
  // No deleted_at column → hard delete is fine (a review is an external fact,
  // deleting the local copy loses nothing irreplaceable).

  app.get("/api/marketing/reviews", requireElevated, (req, res) => {
    const source = qstr(req.query.source);
    if (source && !(REVIEW_SOURCES as readonly string[]).includes(source)) {
      return res.status(400).json({ message: `source must be one of: ${REVIEW_SOURCES.join(", ")}` });
    }
    const conds = [];
    if (source) conds.push(eq(reviews.source, source as (typeof REVIEW_SOURCES)[number]));
    const responded = qstr(req.query.responded);
    if (responded !== undefined) {
      conds.push(eq(reviews.responded, responded === "1" || responded === "true"));
    }
    const minRating = qstr(req.query.minRating);
    if (minRating !== undefined) conds.push(sql`${reviews.rating} >= ${parseInt(minRating, 10)}`);
    const maxRating = qstr(req.query.maxRating);
    if (maxRating !== undefined) conds.push(sql`${reviews.rating} <= ${parseInt(maxRating, 10)}`);

    const rows = db.select().from(reviews)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(reviews.createdAt))
      .all();
    res.json(rows);
  });

  app.post("/api/marketing/reviews", requireElevated, (req, res) => {
    let body;
    try {
      body = insertReviewSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    // A review logged as already-responded gets its responded timestamp now.
    const row = db.insert(reviews)
      .values({ ...body, respondedAt: body.responded ? Date.now() : null })
      .returning().get();
    res.status(201).json(row);
  });

  app.patch("/api/marketing/reviews/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const before = db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!before) return res.status(404).json({ message: "Review not found" });
    let body;
    try {
      body = insertReviewSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const updates: Record<string, unknown> = stripUndefined(body);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    // responded=true stamps the response time; flipping it back clears it.
    if (body.responded === true && !before.responded) updates.respondedAt = Date.now();
    if (body.responded === false) updates.respondedAt = null;
    const row = db.update(reviews).set(updates)
      .where(eq(reviews.id, id))
      .returning().get();
    res.json(row);
  });

  app.delete("/api/marketing/reviews/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!target) return res.status(404).json({ message: "Review not found" });
    db.delete(reviews).where(eq(reviews.id, id)).run();
    res.json({ ok: true });
  });

  // ─── Tasks ────────────────────────────────────────────────────────────────
  // requireAuth (not elevated): the whole crew works the follow-up list.

  app.get("/api/marketing/tasks", requireAuth, (req, res) => {
    const conds = [];
    const status = qstr(req.query.status);
    if (status) {
      if (!(MK_TASK_STATUSES as readonly string[]).includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${MK_TASK_STATUSES.join(", ")}` });
      }
      conds.push(eq(mkTasks.status, status as (typeof MK_TASK_STATUSES)[number]));
    }
    const kind = qstr(req.query.kind);
    if (kind) {
      if (!(MK_TASK_KINDS as readonly string[]).includes(kind)) {
        return res.status(400).json({ message: `kind must be one of: ${MK_TASK_KINDS.join(", ")}` });
      }
      conds.push(eq(mkTasks.kind, kind as (typeof MK_TASK_KINDS)[number]));
    }
    const assignedTo = qstr(req.query.assignedTo);
    if (assignedTo !== undefined) conds.push(eq(mkTasks.assignedTo, parseInt(assignedTo, 10)));

    const due = qstr(req.query.due);
    if (due) {
      const now = Date.now();
      const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
      if (due === "today") {
        conds.push(isNotNull(mkTasks.dueAt));
        conds.push(sql`${mkTasks.dueAt} >= ${startOfToday} AND ${mkTasks.dueAt} < ${startOfToday + DAY_MS}`);
      } else if (due === "overdue") {
        // Overdue only makes sense for tasks that can still be done.
        conds.push(eq(mkTasks.status, "open"));
        conds.push(isNotNull(mkTasks.dueAt));
        conds.push(sql`${mkTasks.dueAt} < ${now}`);
      } else if (due === "week") {
        conds.push(isNotNull(mkTasks.dueAt));
        conds.push(sql`${mkTasks.dueAt} >= ${startOfToday} AND ${mkTasks.dueAt} < ${startOfToday + 7 * DAY_MS}`);
      } else {
        return res.status(400).json({ message: "due must be one of: today, overdue, week" });
      }
    }

    // Dated tasks first (soonest due), undated ones after, newest last.
    const rows = db.select().from(mkTasks)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(sql`${mkTasks.dueAt} IS NULL`, asc(mkTasks.dueAt), desc(mkTasks.createdAt))
      .all();
    res.json(rows);
  });

  app.post("/api/marketing/tasks", requireAuth, (req, res) => {
    let body;
    try {
      body = insertMkTaskSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const row = db.insert(mkTasks)
      .values({ ...body, completedAt: body.status === "done" ? Date.now() : null })
      .returning().get();
    res.status(201).json(row);
  });

  app.patch("/api/marketing/tasks/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const before = db.select().from(mkTasks).where(eq(mkTasks.id, id)).get();
    if (!before) return res.status(404).json({ message: "Task not found" });
    let body;
    try {
      body = insertMkTaskSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const updates: Record<string, unknown> = stripUndefined(body);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    // Completing stamps completed_at; reopening (or dismissing) clears it.
    if (body.status === "done" && before.status !== "done") updates.completedAt = Date.now();
    if (body.status && body.status !== "done") updates.completedAt = null;
    const row = db.update(mkTasks).set(updates)
      .where(eq(mkTasks.id, id))
      .returning().get();
    res.json(row);
  });

  app.delete("/api/marketing/tasks/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(mkTasks).where(eq(mkTasks.id, id)).get();
    if (!target) return res.status(404).json({ message: "Task not found" });
    db.delete(mkTasks).where(eq(mkTasks.id, id)).run();
    res.json({ ok: true });
  });
}

// ─── Automations ─────────────────────────────────────────────────────────────
// Hourly sweep (plus one on boot) that (1) flags stale leads and queues
// re-engagement tasks, (2) queues quote-follow-up reminders. Alerts are
// intentionally NOT produced here — they're computed on demand in /stats and
// /overview so they always reflect the current thresholds.

function hasOpenTask(leadId: number, kinds: ("follow_up" | "quote_reminder")[]): boolean {
  const row = db.select({ id: mkTasks.id }).from(mkTasks)
    .where(and(
      eq(mkTasks.leadId, leadId),
      eq(mkTasks.status, "open"),
      inArray(mkTasks.kind, kinds),
    ))
    .get();
  return !!row;
}

function runMarketingSweep(): void {
  const now = Date.now();
  const cfg = getSettingsRow();
  let staleMarked = 0;
  let tasksCreated = 0;

  // 1. Stale leads: no touch (last contact, else creation) in staleLeadDays.
  // Won/lost leads are settled — nothing to re-engage.
  const staleCutoff = now - cfg.staleLeadDays * DAY_MS;
  const candidates = db.select({ id: leads.id, name: leads.name, stale: leads.stale })
    .from(leads)
    .where(and(
      isNull(leads.deletedAt),
      sql`${leads.stage} NOT IN ('won', 'lost')`,
      sql`COALESCE(${leads.lastContactAt}, ${leads.createdAt}) < ${staleCutoff}`,
    ))
    .all();

  const newlyStale = candidates.filter((l) => !l.stale);
  if (newlyStale.length > 0) {
    db.update(leads).set({ stale: true })
      .where(inArray(leads.id, newlyStale.map((l) => l.id)))
      .run();
    staleMarked = newlyStale.length;
  }
  // Only queue a re-engagement task the moment a lead turns stale, and only
  // if no open follow-up/quote-reminder already points at it — otherwise the
  // hourly sweep would pile up duplicates.
  for (const l of newlyStale) {
    if (hasOpenTask(l.id, ["follow_up", "quote_reminder"])) continue;
    db.insert(mkTasks).values({
      title: `Re-engage ${l.name} — no contact in ${cfg.staleLeadDays} days`,
      kind: "follow_up",
      leadId: l.id,
      status: "open",
      autoCreated: true,
      dueAt: now,
    }).run();
    tasksCreated++;
  }

  // 2. Quote reminders: quote sent, then silence for quoteFollowUpDays.
  const quoteCutoff = now - cfg.quoteFollowUpDays * DAY_MS;
  const quoteLeads = db.select({ id: leads.id, name: leads.name })
    .from(leads)
    .where(and(
      isNull(leads.deletedAt),
      eq(leads.stage, "quote_sent"),
      sql`COALESCE(${leads.lastContactAt}, ${leads.createdAt}) < ${quoteCutoff}`,
    ))
    .all();
  for (const l of quoteLeads) {
    if (hasOpenTask(l.id, ["quote_reminder"])) continue;
    db.insert(mkTasks).values({
      title: `Follow up on quote for ${l.name} — no response in ${cfg.quoteFollowUpDays} days`,
      kind: "quote_reminder",
      leadId: l.id,
      status: "open",
      autoCreated: true,
      dueAt: now,
    }).run();
    tasksCreated++;
  }

  if (staleMarked > 0 || tasksCreated > 0) {
    console.log(`[marketing] Sweep: marked ${staleMarked} lead(s) stale, created ${tasksCreated} task(s)`);
  }
}

// Same shape as startSessionReaper in auth.ts: run once on boot, then hourly;
// unref() so the timer never keeps a shutting-down process alive.
export function startMarketingAutomations(): void {
  const tick = () => {
    try {
      runMarketingSweep();
    } catch (e) {
      // The sweep reads crm_leads (owned by the CRM module) — never let a
      // cross-module hiccup crash the app from a timer callback.
      console.error("[marketing] sweep failed", e);
    }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}
