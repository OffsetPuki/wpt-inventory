import type { Express } from "express";
import { z } from "zod";
import { sqlite } from "./storage";
import { requireElevated } from "./auth";
import { audit } from "./audit";
import {
  GOOGLE_SITES,
  deliverLeadOutcomes,
  type Site,
} from "./lead-measurement";
import {
  googleReport,
  refreshGoogleReports,
  reportingIdentity,
} from "./google-reporting";

sqlite.exec(
  `CREATE TABLE IF NOT EXISTS mk_ad_spend (id INTEGER PRIMARY KEY,site TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),updated_at INTEGER NOT NULL,UNIQUE(site,start_date,end_date));`,
);
const siteSchema = z.enum(["metals", "concrete", "insulation", "trades"]);
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const DAY = 86400000;
export function businessMidnight(date: string) {
  const target = Date.parse(date + "T00:00:00Z");
  let guess = target;
  for (let n = 0; n < 3; n++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(guess))
        .map((p) => [p.type, p.value]),
    );
    guess +=
      target -
      Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return guess;
}
function periods(endInput: unknown) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const yesterday = new Date(Date.parse(today) - DAY)
    .toISOString()
    .slice(0, 10);
  const end =
    typeof endInput === "string" &&
    daySchema.safeParse(endInput).success &&
    endInput <= yesterday
      ? endInput
      : yesterday;
  const start = new Date(Date.parse(end) - 27 * DAY).toISOString().slice(0, 10),
    previousEnd = new Date(Date.parse(start) - DAY).toISOString().slice(0, 10),
    previousStart = new Date(Date.parse(start) - 28 * DAY)
      .toISOString()
      .slice(0, 10);
  return {
    current: { start, end },
    previous: { start: previousStart, end: previousEnd },
  };
}
function cohort(site: Site, start: string, end: string, includeTests: boolean) {
  const rows = sqlite
    .prepare(
      `SELECT l.*,a.first_touch,a.last_touch,a.landing_page,a.entry_site,a.handoffs,a.mode,i.qualified_at,i.survey_at,
 (SELECT MIN(created_at) FROM crm_activities WHERE entity_type='lead' AND entity_id=l.id AND user_id IS NOT NULL AND kind IN ('call','email','meeting')) first_response,
 (SELECT COUNT(*) FROM quotes q WHERE q.lead_id=l.id AND q.deleted_at IS NULL AND q.status IN ('sent','accepted','declined')) quote_count,
 (SELECT COALESCE(SUM(pay.amount_cents),0) FROM fin_invoice_payments pay JOIN fin_invoices inv ON inv.id=pay.invoice_id LEFT JOIN projects p ON p.id=inv.project_id WHERE COALESCE(inv.lead_id,p.lead_id)=l.id AND inv.deleted_at IS NULL AND inv.status!='void') collected_cents
 FROM crm_leads l LEFT JOIN mk_lead_attribution a ON a.lead_id=l.id LEFT JOIN crm_lead_intake i ON i.lead_id=l.id
 WHERE l.deleted_at IS NULL AND l.site=? AND l.created_at>=? AND l.created_at<?
 ${includeTests ? "" : "AND COALESCE(a.mode,'normal')!='staff' AND LOWER(COALESCE(json_extract(a.first_touch,'$.source'),'')) NOT IN ('release_check','qa') AND LOWER(COALESCE(l.utm_source,'')) NOT IN ('release_check','qa') AND l.name NOT LIKE '[CJM RELEASE TEST%'"}
 ORDER BY l.created_at DESC`,
    )
    .all(
      site,
      businessMidnight(start),
      businessMidnight(
        new Date(Date.parse(end) + DAY).toISOString().slice(0, 10),
      ),
    ) as any[];
  const groups = new Map<string, any>();
  let responseTotal = 0,
    responseCount = 0;
  const totals = {
    leads: rows.length,
    qualified: 0,
    visits: 0,
    quoted: 0,
    won: 0,
    bookedCents: 0,
    collectedCents: 0,
    paidQualified: 0,
    awaitingContact: 0,
    averageResponseMinutes: null as number | null,
  };
  for (const r of rows) {
    let first: any = {};
    try {
      first = JSON.parse(r.first_touch || "{}");
    } catch {}
    const source = first.source || r.utm_source || r.source || "unknown",
      medium = first.medium || r.utm_medium || "",
      campaign = first.campaign || r.utm_campaign || "",
      page = r.landing_page || "Not recorded";
    const key = JSON.stringify([source, medium, campaign, page]);
    const g = groups.get(key) || {
      source,
      medium,
      campaign,
      page,
      leads: 0,
      qualified: 0,
      quoted: 0,
      won: 0,
      bookedCents: 0,
      collectedCents: 0,
    };
    const qualified = !!r.qualified_at,
      quoted = r.quote_count > 0,
      won = r.stage === "won";
    g.leads++;
    g.qualified += +qualified;
    g.quoted += +quoted;
    g.won += +won;
    g.bookedCents += won ? r.revenue_closed_cents || 0 : 0;
    g.collectedCents += r.collected_cents || 0;
    groups.set(key, g);
    totals.qualified += +qualified;
    totals.visits += +!!r.survey_at;
    totals.quoted += +quoted;
    totals.won += +won;
    totals.bookedCents += won ? r.revenue_closed_cents || 0 : 0;
    totals.collectedCents += r.collected_cents || 0;
    if (
      qualified &&
      /^(cpc|ppc|paid|paid_search|paid_social|display)$/i.test(medium)
    )
      totals.paidQualified++;
    if (!r.first_response && r.stage === "new") totals.awaitingContact++;
    if (r.first_response) {
      responseTotal += Math.max(0, r.first_response - r.created_at) / 60000;
      responseCount++;
    }
  }
  totals.averageResponseMinutes = responseCount
    ? Math.round(responseTotal / responseCount)
    : null;
  const manual = sqlite
    .prepare(
      "SELECT COUNT(*) n,COALESCE(SUM(amount_cents),0) cents FROM mk_ad_spend WHERE site=? AND start_date=? AND end_date=?",
    )
    .get(site, start, end) as any;
  const google = googleReport(site, start, end, "spend");
  const spendCents = manual.n
    ? manual.cents
    : google?.hasData
      ? google.rows.reduce((n: number, r: any) => n + r.cents, 0)
      : null;
  return {
    start,
    end,
    totals,
    bySource: [...groups.values()].sort((a, b) => b.leads - a.leads),
    spendCents,
    spendSource: manual.n
      ? "Entered spend"
      : google?.hasData
        ? "Google-linked ad spend"
        : null,
    costPerQualifiedPaidLeadCents:
      spendCents !== null && totals.paidQualified
        ? Math.round(spendCents / totals.paidQualified)
        : null,
    traffic: googleReport(site, start, end, "traffic"),
    search: googleReport(site, start, end, "search"),
    queries: googleReport(site, start, end, "queries"),
  };
}
export function registerGrowthRoutes(app: Express) {
  app.get("/api/marketing/growth/overview", requireElevated, (req, res) => {
    const { current } = periods(req.query.end);
    const includeTests = req.query.includeTests === "1";
    const rows = (Object.keys(GOOGLE_SITES) as Site[]).map(site => {
      const report = cohort(site, current.start, current.end, includeTests);
      const organic = report.bySource.filter(row => row.medium.toLowerCase() === "organic")
        .reduce((total, row) => ({ leads: total.leads + row.leads, qualified: total.qualified + row.qualified,
          quoted: total.quoted + row.quoted, won: total.won + row.won, bookedCents: total.bookedCents + row.bookedCents }),
          {leads:0,qualified:0,quoted:0,won:0,bookedCents:0});
      const search = googleReport(site, current.start, current.end, "searchTotals");
      return { site, name: GOOGLE_SITES[site].name, ...organic,
        sessions: report.traffic ? report.traffic.rows.filter((row:any) => row.medium.toLowerCase() === "organic").reduce((n:number,row:any)=>n+row.sessions,0) : null,
        clicks: search?.totals?.clicks ?? null, impressions: search?.totals?.impressions ?? null,
        trafficUpdatedAt: report.traffic?.fetchedAt ?? null, searchUpdatedAt: search?.fetchedAt ?? null };
    });
    res.json({ ...current, rows });
  });
  app.get("/api/marketing/growth", requireElevated, (req, res) => {
    const site = siteSchema.safeParse(req.query.site);
    if (!site.success)
      return res.status(400).json({ message: "Choose a trade" });
    const range = periods(req.query.end),
      includeTests = req.query.includeTests === "1";
    const queue = sqlite
      .prepare(
        "SELECT site,state,COUNT(*) count FROM mk_measurement_events GROUP BY site,state",
      )
      .all();
    res.json({
      site: site.data,
      brand: GOOGLE_SITES[site.data],
      current: cohort(
        site.data,
        range.current.start,
        range.current.end,
        includeTests,
      ),
      previous: cohort(
        site.data,
        range.previous.start,
        range.previous.end,
        includeTests,
      ),
      connection: {
        reportingEmail: reportingIdentity(),
        outcomesConfigured:
          !!process.env[`GA4_${site.data.toUpperCase()}_API_SECRET`],
      },
      queue,
      includeTests,
    });
  });
  app.post(
    "/api/marketing/growth/refresh",
    requireElevated,
    async (req, res) => {
      const parsed = siteSchema.safeParse(req.body.site);
      if (!parsed.success)
        return res.status(400).json({ message: "Choose a trade" });
      if (!reportingIdentity())
        return res
          .status(409)
          .json({
            message: "Connect the read-only Google reporting account first.",
          });
      const range = periods(req.body.end);
      try {
        const result = await refreshGoogleReports(
          parsed.data,
          range.current.start,
          range.current.end,
        );
        const previous = await refreshGoogleReports(
          parsed.data,
          range.previous.start,
          range.previous.end,
        );
        audit(req, "marketing.google_refresh", {
          details: { site: parsed.data },
        });
        res.json({ current: result, previous });
      } catch {
        res
          .status(502)
          .json({
            message:
              "Google reports could not be refreshed. Saved business results are still available.",
          });
      }
    },
  );
  app.post("/api/marketing/growth/spend", requireElevated, (req, res) => {
    const p = z
      .object({
        site: siteSchema,
        end: daySchema,
        amountCents: z.number().int().min(0).max(100_000_000),
      })
      .safeParse(req.body);
    if (!p.success)
      return res
        .status(400)
        .json({ message: "Enter a valid trade, date and spend amount." });
    const v = p.data,
      range = periods(v.end).current;
    if (range.end !== v.end)
      return res
        .status(400)
        .json({ message: "Choose a completed reporting day." });
    sqlite
      .prepare(
        "INSERT INTO mk_ad_spend(site,start_date,end_date,amount_cents,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(site,start_date,end_date) DO UPDATE SET amount_cents=excluded.amount_cents,updated_at=excluded.updated_at",
      )
      .run(v.site, range.start, range.end, v.amountCents, Date.now());
    audit(req, "marketing.spend_save", { details: v });
    res.json({ ok: true });
  });
  app.post(
    "/api/marketing/growth/process-outcomes",
    requireElevated,
    async (_req, res) => {
      try {
        await deliverLeadOutcomes();
        res.json({ ok: true });
      } catch {
        res
          .status(500)
          .json({ message: "Outcome queue could not be processed." });
      }
    },
  );
}

let refreshing = false;
export function startGrowthReporting() {
  const tick = async () => {
    if (refreshing || !reportingIdentity()) return;
    refreshing = true;
    try {
      const range = periods(undefined);
      for (const site of Object.keys(GOOGLE_SITES) as Site[]) {
        for (const period of [range.current, range.previous]) {
          const cache = googleReport(site, period.start, period.end, "traffic");
          if (cache && Date.now() - cache.fetchedAt < 6 * 3600000) continue;
          await refreshGoogleReports(site, period.start, period.end);
        }
      }
    } catch {
      console.error(
        "[marketing] Google report refresh failed; previous cache retained",
      );
    } finally {
      refreshing = false;
    }
  };
  const timer = setInterval(() => void tick(), 6 * 3600000);
  timer.unref();
  void tick();
}
