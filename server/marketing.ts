import type { Express } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { sqlite, db, storage } from "./storage";
import { requireElevated } from "./auth";
import { audit } from "./audit";
import { sendOwnerMail } from "./mailer";
import {
  campaigns, reviews, marketingSettings, portfolioItems,
  insertReviewSchema,
  insertPortfolioItemSchema, updateMarketingSettingsSchema,
  REVIEW_SOURCES,
  type MarketingSettings,
} from "../shared/marketing-schema";
// Package C: the follow-up list lives on the pm board now.
import { pmTasks, type TaskKind } from "../shared/pm-schema";
// Cross-module READ: the CRM module owns crm_leads (tables + endpoints).
// Marketing only reads them for source/attribution reporting.
import { leads, clients } from "../shared/crm-schema";
import { pid, qstr, todayLocal, registerCreate } from "./http-util";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Table creation (synchronous DDL) ────────────────────────────────────────
// mk_tasks.lead_id is a soft reference to crm_leads — deliberately NO
// REFERENCES clause, so this module's DDL doesn't depend on the CRM module's
// tables existing first (avoids boot-order coupling between module files).
//
// Package C notes:
//  - mk_campaigns is retained for the crm_leads.campaign_id FK only — the
//    campaigns CRUD endpoints are gone.
//  - mk_tasks is retained for migration source only (server/pm.ts copies it
//    into pm_tasks at boot); all writers moved to pm_tasks.

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

  -- "Recent work" gallery published to www.cjmmetals.com.
  CREATE TABLE IF NOT EXISTS mk_portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT,
    photo_url TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_mk_portfolio_pub ON mk_portfolio(published, order_index);

  -- One row per "how did we do?" invitation. Created by the finance module
  -- when an invoice is first paid (see queueReviewRequest in finance.ts);
  -- consumed by the website's /review/<token> page via the public portal.
  -- invoice_id / lead_id / review_id are soft refs (no FK: see note above).
  CREATE TABLE IF NOT EXISTS review_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    name TEXT,
    email TEXT,
    invoice_id INTEGER,
    lead_id INTEGER,
    sent_at INTEGER,
    submitted_at INTEGER,
    review_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_review_requests_invoice ON review_requests(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_review_requests_created ON review_requests(created_at);
`);

// Additive migration: mk_reviews.published arrived after installs existed.
// SQLite has no IF NOT EXISTS for columns — the throw on re-run is expected.
try {
  sqlite.exec("ALTER TABLE mk_reviews ADD COLUMN published INTEGER NOT NULL DEFAULT 0");
} catch {
  /* column already exists */
}

// Additive migration: mk_settings.lead_time_weeks (website banner) — same deal.
try {
  sqlite.exec("ALTER TABLE mk_settings ADD COLUMN lead_time_weeks INTEGER");
} catch {
  /* column already exists */
}

// Additive migration: mk_settings.lead_time_updated_at (unix ms) — stamped
// whenever lead_time_weeks changes, so the website can show how fresh the
// posted lead time is.
try {
  sqlite.exec("ALTER TABLE mk_settings ADD COLUMN lead_time_updated_at INTEGER");
} catch {
  /* column already exists */
}

// Phase B #12: reviews tied to the customer. Soft refs — review_requests
// gains client_id (stamped at creation by finance's queueReviewRequest);
// mk_reviews gains client_id + request_id (stamped by the public submit).
// Phase D #20: mk_tasks gains project_id (soft ref to projects) so chase
// tasks can surface on the job hub.
for (const ddl of [
  "ALTER TABLE review_requests ADD COLUMN client_id INTEGER",
  "ALTER TABLE mk_reviews ADD COLUMN client_id INTEGER",
  "ALTER TABLE mk_reviews ADD COLUMN request_id INTEGER",
  "ALTER TABLE mk_tasks ADD COLUMN project_id INTEGER",
]) {
  try {
    sqlite.exec(ddl);
  } catch {
    /* column already exists */
  }
}

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

// Fire-and-forget task creation for on-event hooks (used here and by
// routes.ts): defers the insert via setImmediate like audit(), and dedupes on
// an open task with the same title so repeated events don't pile up copies.
// Package C: writes the pm board (pm_tasks).
export function queueTaskOnce(
  title: string,
  kind: TaskKind = "other",
  projectId: number | null = null, // Phase D #20: surfaces the task on the job hub
): void {
  setImmediate(() => {
    try {
      const dupe = db.select({ id: pmTasks.id }).from(pmTasks)
        .where(and(
          eq(pmTasks.title, title),
          sql`${pmTasks.status} != 'done'`,
          isNull(pmTasks.deletedAt),
        ))
        .get();
      if (!dupe) {
        db.insert(pmTasks).values({ title, kind, projectId, autoCreated: true }).run();
      }
    } catch (e) {
      console.error("[marketing] queueTaskOnce failed", e);
    }
  });
}

// ─── Alerts (computed on demand, never stored) ───────────────────────────────
// Overdue open follow-ups on the board (Package C: the campaign-based alerts
// — CPL threshold, zero-lead campaign — went with the campaigns UI).

function computeAlerts(): string[] {
  const alerts: string[] = [];
  const overdue = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
    .where(and(
      isNull(pmTasks.deletedAt),
      sql`${pmTasks.status} != 'done'`,
      sql`${pmTasks.kind} != 'task'`,
      isNotNull(pmTasks.dueDate),
      sql`${pmTasks.dueDate} < ${todayLocal()}`,
    )).get()?.n ?? 0;
  if (overdue > 0) {
    alerts.push(overdue === 1
      ? "1 follow-up task is overdue."
      : `${overdue} follow-up tasks are overdue.`);
  }
  return alerts;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerMarketingRoutes(app: Express): void {
  // `pid`/`qstr` (req.params/req.query narrowing) live in ./http-util.

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

    // (Cost per lead removed along with its dashboard tile. It divided lifetime
    // campaign spend by attributed leads, and mk_campaigns has had no writer
    // since the campaigns CRUD was cut — so spend was always 0 and the tile
    // always rendered "—". The table is retained for the historical
    // crm_leads.campaign_id references.)

    // Package C: task counts mean follow-ups (board rows with kind != 'task');
    // the board's own stats cover everything.
    const followUpConds = and(
      isNull(pmTasks.deletedAt),
      sql`${pmTasks.status} != 'done'`,
      sql`${pmTasks.kind} != 'task'`,
    );
    const openTasks = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
      .where(followUpConds).get()?.n ?? 0;
    const overdueTasks = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
      .where(and(
        followUpConds,
        isNotNull(pmTasks.dueDate),
        sql`${pmTasks.dueDate} < ${todayLocal()}`,
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
      openTasks,
      overdueTasks,
      avgRating30d,
      unrespondedReviews,
      alerts: computeAlerts(),
    });
  });

  // ─── Overview (control-center payload) ────────────────────────────────────
  // Package C: slimmed to the this-week cards. Funnel / by-source / campaign
  // performance went with the campaigns UI; attribution has its own endpoint.

  app.get("/api/marketing/overview", requireElevated, (_req, res) => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const d = new Date(now);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

    const allLeads = db.select({
      source: leads.source,
      stage: leads.stage,
      createdAt: leads.createdAt,
      lastContactAt: leads.lastContactAt,
    }).from(leads).where(isNull(leads.deletedAt)).all();

    // Builder quotes are the quoting system — the quote module owns the
    // table, so raw sqlite + try/catch.
    let quotesSent = 0;
    let revenueCents = 0;
    try {
      quotesSent = (sqlite.prepare(
        "SELECT count(*) AS n FROM quotes WHERE deleted_at IS NULL AND sent_at >= ?",
      ).get(weekAgo) as { n: number }).n;
      revenueCents = (sqlite.prepare(
        "SELECT coalesce(sum(total_cents), 0) AS v FROM quotes WHERE deleted_at IS NULL AND status = 'accepted' AND accepted_at >= ?",
      ).get(monthStart) as { v: number }).v;
    } catch {
      /* quotes table not created */
    }

    const leadsWk = allLeads.filter((l) => l.createdAt.getTime() >= weekAgo);

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

    let bestSource: { source: string; leads: number } | null = null;
    {
      const bySrc = new Map<string, number>();
      for (const l of leadsWk) bySrc.set(l.source, (bySrc.get(l.source) ?? 0) + 1);
      for (const [source, n] of bySrc) {
        if (!bestSource || n > bestSource.leads) bestSource = { source, leads: n };
      }
    }

    res.json({
      thisWeek: {
        leads: leadsWk.length,
        quotesSent,
        closeRate,
        revenueCents,
        bestSource,
      },
      // Kept for the Overview tab's warning banner.
      alerts: computeAlerts(),
    });
  });

  // ─── Attribution (where the leads — and the money — actually come from) ───
  // All-time rollups over non-deleted leads: by CRM source enum, by linked
  // campaign, and by the raw utm_source string the website intake preserved.
  // "won" = stage won; revenue = the closed revenue recorded on those leads.

  app.get("/api/marketing/attribution", requireElevated, (_req, res) => {
    const allLeads = db.select({
      source: leads.source,
      stage: leads.stage,
      campaignId: leads.campaignId,
      utmSource: leads.utmSource,
      revenueClosedCents: leads.revenueClosedCents,
    }).from(leads).where(isNull(leads.deletedAt)).all();

    type Bucket = { leads: number; won: number; revenueCents: number };
    const tally = <K,>(map: Map<K, Bucket>, key: K, l: (typeof allLeads)[number]) => {
      let b = map.get(key);
      if (!b) {
        b = { leads: 0, won: 0, revenueCents: 0 };
        map.set(key, b);
      }
      b.leads++;
      if (l.stage === "won") {
        b.won++;
        b.revenueCents += l.revenueClosedCents;
      }
    };

    const srcMap = new Map<string, Bucket>();
    const utmMap = new Map<string, Bucket>();
    const byCampaignId = new Map<number, Bucket>();
    for (const l of allLeads) {
      tally(srcMap, l.source, l);
      // Raw UTM strings vary by case/whitespace ("Facebook" vs "facebook") —
      // normalize so the report doesn't split one channel into three rows.
      const utm = (l.utmSource ?? "").trim().toLowerCase();
      if (utm) tally(utmMap, utm, l);
      if (l.campaignId != null) tally(byCampaignId, l.campaignId, l);
    }

    const bySource = [...srcMap.entries()]
      .map(([source, b]) => ({ source, ...b }))
      .sort((a, b) => b.leads - a.leads);
    const byUtmSource = [...utmMap.entries()]
      .map(([utmSource, b]) => ({ utmSource, ...b }))
      .sort((a, b) => b.leads - a.leads);
    const byCampaign = db.select().from(campaigns)
      .where(isNull(campaigns.deletedAt))
      .orderBy(desc(campaigns.createdAt))
      .all()
      .map((c) => {
        const b = byCampaignId.get(c.id) ?? { leads: 0, won: 0, revenueCents: 0 };
        return {
          id: c.id,
          name: c.name,
          channel: c.channel,
          ...b,
          spendCents: c.spendCents,
          cplCents: b.leads > 0 ? Math.round(c.spendCents / b.leads) : null,
        };
      });

    res.json({ bySource, byCampaign, byUtmSource });
  });

  // ─── Settings (singleton) ─────────────────────────────────────────────────

  app.get("/api/marketing/settings", requireElevated, (_req, res) => {
    res.json(getSettingsRow());
  });

  app.put("/api/marketing/settings", requireElevated, (req, res) => {
    // JSON bodies can't contain undefined, so zod-parsed output binds as-is.
    let updates;
    try {
      updates = updateMarketingSettingsSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const before = getSettingsRow(); // guarantees the row exists before UPDATE
    db.update(marketingSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(marketingSettings.id, 1))
      .run();
    // Freshness stamp for the website's lead-time banner (null counts as a
    // change — clearing the banner is also news).
    // ponytail: raw SQL — the column isn't in the drizzle table (shared/ is
    // out of scope here); move it into marketing-schema.ts if the client ever
    // needs to read it.
    if (updates.leadTimeWeeks !== undefined && updates.leadTimeWeeks !== before.leadTimeWeeks) {
      setImmediate(() => {
        try {
          sqlite.prepare("UPDATE mk_settings SET lead_time_updated_at = ? WHERE id = 1").run(Date.now());
        } catch (e) {
          console.error("[marketing] lead_time_updated_at stamp failed", e);
        }
      });
    }
    const row = getSettingsRow();
    audit(req, "marketing.settings_update", {
      targetType: "marketing_settings", targetId: 1,
      details: updates as Record<string, unknown>,
    });
    res.json(row);
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
    // Phase B #12: resolve the customer's name when the review is linked to a
    // CRM client. crm_clients belongs to the CRM module → try/catch.
    let names = new Map<number, string>();
    try {
      const ids = [...new Set(rows.map((r) => r.clientId).filter((v): v is number => v != null))];
      if (ids.length > 0) {
        names = new Map(db.select({ id: clients.id, name: clients.name }).from(clients)
          .where(inArray(clients.id, ids)).all().map((r) => [r.id, r.name]));
      }
    } catch { /* crm module absent */ }
    res.json(rows.map((r) => ({
      ...r,
      clientName: r.clientId != null ? names.get(r.clientId) ?? null : null,
    })));
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
    // Negative-review alarm (admin entry path; the public submit path lives in
    // public-portal.ts): alert the owner and queue a response task.
    if (row.rating <= 3) {
      const name = row.author || "Anonymous";
      const { rating, source, text } = row;
      setImmediate(() => {
        void sendOwnerMail({
          subject: `[CJM Suite] ${rating}-star review from ${name}`,
          text: `${name} left a ${rating}-star review on ${source}:\n\n${text || "(no text)"}`,
        });
      });
      queueTaskOnce(`Respond to ${name}'s ${rating}-star review`);
    }
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
    const updates: Record<string, unknown> = { ...body };
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

  // ─── Portfolio ("recent work" gallery published to the website) ───────────

  app.get("/api/marketing/portfolio", requireElevated, (_req, res) => {
    res.json(
      db.select().from(portfolioItems)
        .orderBy(asc(portfolioItems.orderIndex), desc(portfolioItems.createdAt))
        .all(),
    );
  });

  registerCreate(app, "/api/marketing/portfolio", requireElevated, {
    table: portfolioItems, schema: insertPortfolioItemSchema,
    action: "marketing.portfolio_create", targetType: "portfolio",
    name: (r) => r.title, audit,
  });

  app.patch("/api/marketing/portfolio/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const before = db.select().from(portfolioItems).where(eq(portfolioItems.id, id)).get();
    if (!before) return res.status(404).json({ message: "Portfolio item not found" });
    let body;
    try {
      body = insertPortfolioItemSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    if (Object.keys(body).length === 0) return res.json(before);
    const row = db.update(portfolioItems).set(body).where(eq(portfolioItems.id, id)).returning().get();
    if (body.published !== undefined && body.published !== before.published) {
      audit(req, "marketing.portfolio_publish", {
        targetType: "portfolio", targetId: id, targetName: before.title,
        details: { published: body.published },
      });
    }
    res.json(row);
  });

  app.delete("/api/marketing/portfolio/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(portfolioItems).where(eq(portfolioItems.id, id)).get();
    if (!target) return res.status(404).json({ message: "Portfolio item not found" });
    db.delete(portfolioItems).where(eq(portfolioItems.id, id)).run();
    audit(req, "marketing.portfolio_delete", {
      targetType: "portfolio", targetId: id, targetName: target.title,
    });
    res.json({ ok: true });
  });

  // Publish a finished shop project straight to the website gallery. Projects
  // carry no photos of their own, so photoUrl must come in the body (an
  // /uploads path from the normal photo-upload flow); title falls back to the
  // project's name so one click is usually enough.
  app.post("/api/projects/:id/publish-portfolio", requireElevated, (req, res) => {
    const project = storage.getProjectById(pid(req.params.id));
    if (!project) return res.status(404).json({ message: "Project not found" });
    let body;
    try {
      body = insertPortfolioItemSchema.parse({
        title: req.body?.title || project.name,
        category: req.body?.category ?? null,
        photoUrl: req.body?.photoUrl,
        published: true,
      });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const row = db.insert(portfolioItems).values(body).returning().get();
    audit(req, "marketing.portfolio_create", {
      targetType: "portfolio", targetId: row.id, targetName: row.title,
      details: { fromProject: project.jobNumber },
    });
    res.status(201).json(row);
  });
}

// Package C: the marketing sweep (stale-lead flagging + quote chase) moved
// into the ONE hourly business sweep — see server/automations.ts steps 8b/8c.
