import { z } from "zod";
import { sqlite } from "./storage";

export const GOOGLE_SITES = {
  metals: {
    name: "CJM Metals",
    domain: "www.cjmmetals.com",
    property: "543542920",
    measurement: "G-GQQJGFH304",
  },
  concrete: {
    name: "CJM Concrete",
    domain: "www.cjm-concrete.com",
    property: "552153527",
    measurement: "G-JW21V0EZ9S",
  },
  insulation: {
    name: "CJM Insulation",
    domain: "www.cjminsulation.com",
    property: "552155140",
    measurement: "G-78LHR7B0MJ",
  },
  trades: {
    name: "CJM Trades",
    domain: "www.cjmtrades.com",
    property: "552153288",
    measurement: "G-VJKTXNP21H",
  },
} as const;
export type Site = keyof typeof GOOGLE_SITES;
const sites = z.enum(["metals", "concrete", "insulation", "trades"]);
const label = z
  .string()
  .max(80)
  .regex(/^[\w .-]*$/)
  .refine((v) => !/[\d]{7,}/.test(v));
const publicPath = z
  .string()
  .max(180)
  .regex(
    /^\/(?:es\/?)?(?:(?:services|customize|faq|areas|service-area|concepts)\/[a-z0-9-]+\/?|services\/?|customize\/?|faq\/?|plan\/?|price\/?|calculator\/?|materials\/?|about\/?|service-area\/?)?$/,
  );
const host = z
  .string()
  .max(200)
  .regex(/^[a-z0-9.-]+$/);
const touch = z.object({
  site: host.refine((h) =>
    Object.values(GOOGLE_SITES).some(
      (s) => s.domain.replace(/^www\./, "") === h.replace(/^www\./, ""),
    ),
  ),
  page: publicPath,
  source: label,
  medium: label,
  campaign: label,
  referrer: host.or(z.literal("")),
  at: z.number().int().positive(),
});
const attributionSchema = z.object({
  first: touch,
  last: touch,
  entrySite: host,
  handoffs: z.number().int().min(0).max(10),
  mode: z.enum(["normal", "staff", "off"]),
  landingPage: publicPath,
  submittedPage: publicPath,
  analyticsConsent: z.boolean(),
  clientId: z
    .string()
    .regex(/^\d{1,20}\.\d{1,20}$/)
    .optional(),
});
sqlite.exec(`
 CREATE TABLE IF NOT EXISTS mk_lead_attribution (lead_id INTEGER PRIMARY KEY,site TEXT NOT NULL,first_touch TEXT NOT NULL,last_touch TEXT NOT NULL,entry_site TEXT NOT NULL,landing_page TEXT NOT NULL,submitted_page TEXT NOT NULL,handoffs INTEGER NOT NULL DEFAULT 0,mode TEXT NOT NULL DEFAULT 'normal',analytics_consent INTEGER NOT NULL DEFAULT 0,client_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_mk_lead_attribution_site_created ON mk_lead_attribution(site,created_at);
 CREATE TABLE IF NOT EXISTS mk_measurement_events (id INTEGER PRIMARY KEY,lead_id INTEGER NOT NULL,site TEXT NOT NULL,event_name TEXT NOT NULL,occurred_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at INTEGER NOT NULL,UNIQUE(lead_id,event_name));
 CREATE INDEX IF NOT EXISTS idx_mk_measurement_pending ON mk_measurement_events(state,occurred_at);
`);

export function saveLeadAttribution(
  leadId: number,
  site: string,
  input: unknown,
) {
  const parsed = attributionSchema.safeParse(input);
  if (!parsed.success || !sites.safeParse(site).success) return;
  const a = parsed.data,
    now = Date.now();
  if (
    a.first.at > now + 60_000 ||
    a.last.at > now + 60_000 ||
    a.first.at < now - 90 * 86400000 ||
    a.last.at < now - 90 * 86400000
  )
    return;
  const allowed = a.analyticsConsent && a.mode === "normal";
  sqlite
    .prepare(
      `INSERT INTO mk_lead_attribution(lead_id,site,first_touch,last_touch,entry_site,landing_page,submitted_page,handoffs,mode,analytics_consent,client_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(lead_id) DO UPDATE SET last_touch=excluded.last_touch,submitted_page=excluded.submitted_page,handoffs=MAX(mk_lead_attribution.handoffs,excluded.handoffs),mode=excluded.mode,analytics_consent=excluded.analytics_consent,client_id=excluded.client_id,updated_at=excluded.updated_at`,
    )
    .run(
      leadId,
      site,
      JSON.stringify(a.first),
      JSON.stringify(a.last),
      a.entrySite,
      a.landingPage,
      a.submittedPage,
      a.handoffs,
      a.mode,
      allowed ? 1 : 0,
      allowed ? a.clientId || null : null,
      now,
      now,
    );
}
export function queueLeadOutcome(
  leadId: number,
  name:
    | "qualify_lead"
    | "working_lead"
    | "close_convert_lead"
    | "site_visit_scheduled"
    | "quote_sent",
  occurredAt = Date.now(),
) {
  const a = sqlite
    .prepare(
      "SELECT site,analytics_consent,mode,client_id FROM mk_lead_attribution WHERE lead_id=?",
    )
    .get(leadId) as any;
  if (!a?.analytics_consent || a.mode !== "normal" || !a.client_id) return;
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO mk_measurement_events(lead_id,site,event_name,occurred_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .run(leadId, a.site, name, occurredAt, Date.now());
}
// Match new tracked leads to real business changes. Historical untracked leads
// are never backfilled. Individual milestones are enqueued once per lead.
export function discoverLeadOutcomes() {
  const rows = sqlite
    .prepare(
      `SELECT l.id,l.site,l.stage,i.qualified_at,i.survey_at,i.first_contact_at,
 (SELECT MIN(created_at) FROM crm_activities WHERE entity_type='lead' AND entity_id=l.id AND user_id IS NOT NULL AND kind IN ('call','email','meeting')) human_contact,
 (SELECT MIN(sent_at) FROM quotes WHERE lead_id=l.id AND deleted_at IS NULL AND status IN ('sent','accepted','declined')) quoted_at
 FROM mk_lead_attribution a JOIN crm_leads l ON l.id=a.lead_id LEFT JOIN crm_lead_intake i ON i.lead_id=l.id WHERE l.deleted_at IS NULL AND a.analytics_consent=1 AND a.mode='normal' AND a.client_id IS NOT NULL`,
    )
    .all() as any[];
  for (const r of rows) {
    if (r.qualified_at) queueLeadOutcome(r.id, "qualify_lead", r.qualified_at);
    if (r.human_contact || r.first_contact_at)
      queueLeadOutcome(
        r.id,
        "working_lead",
        r.human_contact || r.first_contact_at,
      );
    // A booking is measured when observed, not at its future appointment time.
    if (r.survey_at) queueLeadOutcome(r.id, "site_visit_scheduled");
    if (r.quoted_at) queueLeadOutcome(r.id, "quote_sent", r.quoted_at);
    if (r.stage === "won") queueLeadOutcome(r.id, "close_convert_lead");
  }
}
let working = false;
export async function deliverLeadOutcomes(fetcher: typeof fetch = fetch) {
  if (working) return;
  working = true;
  try {
    discoverLeadOutcomes();
    const now = Date.now();
    // Replaying an old or ambiguous event would misstate the current period.
    sqlite
      .prepare(
        "UPDATE mk_measurement_events SET state='expired',last_error='Event is older than 72 hours',updated_at=? WHERE state='pending' AND occurred_at<?",
      )
      .run(now, now - 72 * 3600000);
    const enabledSites=Object.keys(GOOGLE_SITES).filter(site=>!!process.env[`GA4_${site.toUpperCase()}_API_SECRET`]);
    if(!enabledSites.length)return;
    const rows = sqlite
      .prepare(
        `SELECT e.*,a.client_id,a.analytics_consent,a.mode,l.deleted_at FROM mk_measurement_events e JOIN mk_lead_attribution a ON a.lead_id=e.lead_id JOIN crm_leads l ON l.id=e.lead_id WHERE e.state='pending' AND e.site IN (${enabledSites.map(()=>'?').join(',')}) ORDER BY e.id LIMIT 30`,
      )
      .all(...enabledSites) as any[];
    for (const row of rows) {
      if (
        row.deleted_at ||
        !row.analytics_consent ||
        row.mode !== "normal" ||
        !row.client_id
      ) {
        sqlite
          .prepare(
            "UPDATE mk_measurement_events SET state='skipped',updated_at=? WHERE id=?",
          )
          .run(now, row.id);
        continue;
      }
      const site = GOOGLE_SITES[row.site as Site],
        secret = process.env[`GA4_${row.site.toUpperCase()}_API_SECRET`];
      if (!site || !secret) continue;
      const claimed = sqlite
        .prepare(
          "UPDATE mk_measurement_events SET state='sending',attempts=attempts+1,updated_at=? WHERE id=? AND state='pending'",
        )
        .run(now, row.id);
      if (!claimed.changes) continue;
      const payload = {
        client_id: row.client_id,
        timestamp_micros: row.occurred_at * 1000,
        consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
        events: [
          {
            name: row.event_name,
            params: { trade: row.site, engagement_time_msec: 1 },
          },
        ],
      };
      try {
        const response = await fetcher(
          `https://www.google-analytics.com/mp/collect?measurement_id=${site.measurement}&api_secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          },
        );
        // GA's 2xx confirms transport only. Validate with Google's debug endpoint
        // during setup and independently inspect reception in the Google reports.
        sqlite
          .prepare(
            "UPDATE mk_measurement_events SET state=?,last_error=?,updated_at=? WHERE id=?",
          )
          .run(
            response.ok ? "accepted" : "failed",
            response.ok ? null : `Google HTTP ${response.status}`,
            Date.now(),
            row.id,
          );
      } catch {
        sqlite
          .prepare(
            "UPDATE mk_measurement_events SET state='uncertain',last_error='Delivery could not be confirmed; not automatically replayed',updated_at=? WHERE id=?",
          )
          .run(Date.now(), row.id);
      }
    }
  } finally {
    working = false;
  }
}
export function startLeadMeasurement() {
  sqlite
    .prepare(
      "UPDATE mk_measurement_events SET state='uncertain',last_error='Worker restarted during delivery' WHERE state='sending'",
    )
    .run();
  const tick = () =>
    void deliverLeadOutcomes().catch(() =>
      console.error("[measurement] Unable to process outcome queue"),
    );
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
}
