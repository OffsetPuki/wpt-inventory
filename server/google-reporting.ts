import { reportingAccessToken } from "./google-auth";
export { reportingIdentity } from "./google-auth";
import { sqlite } from "./storage";
import { GOOGLE_SITES, type Site } from "./lead-measurement";

sqlite.exec(
  `CREATE TABLE IF NOT EXISTS mk_google_reports (site TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(site,start_date,end_date,kind));`,
);
export function safeGooglePage(value: string): string {
  let page: string;
  try {
    page = new URL(value, "https://report.invalid").pathname;
  } catch {
    return "/other";
  }
  if (
    /^\/(?:es\/)?(?:quote|quotes|review|invoice|invoices|api|admin|account|auth)(?:\/|$)/i.test(
      page,
    )
  )
    return "/private";
  return page.length <= 180 && !/[@%]|\d{20,}/.test(page) ? page : "/other";
}
async function googlePost(url: string, body: unknown) {
  const token = await reportingAccessToken();
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`Google report returned HTTP ${r.status}`);
  return r.json();
}
export function googleReport(
  site: Site,
  start: string,
  end: string,
  kind: string,
) {
  const row = sqlite
    .prepare(
      "SELECT payload,fetched_at FROM mk_google_reports WHERE site=? AND start_date=? AND end_date=? AND kind=?",
    )
    .get(site, start, end, kind) as any;
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  // Older cached traffic includes preview hosts. Refresh it before displaying totals.
  if (kind === "traffic" && payload.productionHost !== GOOGLE_SITES[site].domain)
    return null;
  return { ...payload, fetchedAt: row.fetched_at };
}
const jobs = new Set<string>();
export async function refreshGoogleReports(
  site: Site,
  start: string,
  end: string,
) {
  const key = [site, start, end].join(":");
  if (jobs.has(key)) return { busy: true };
  jobs.add(key);
  const config = GOOGLE_SITES[site],
    save = (kind: string, payload: unknown) =>
      sqlite
        .prepare(
          "INSERT INTO mk_google_reports(site,start_date,end_date,kind,payload,fetched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(site,start_date,end_date,kind) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at",
        )
        .run(site, start, end, kind, JSON.stringify(payload), Date.now());
  const results: Record<string, string> = {};
  try {
    const run = async (kind: string, fn: () => Promise<unknown>) => {
      try {
        save(kind, await fn());
        results[kind] = "updated";
      } catch (error) {
        results[kind] =
          error instanceof Error ? error.message : "Unable to refresh";
      }
    };
    await Promise.all([
      run("traffic", async () => {
        const r = await googlePost(
          `https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:runReport`,
          {
            dateRanges: [{ startDate: start, endDate: end }],
            dimensions: [
              { name: "date" },
              { name: "sessionSource" },
              { name: "sessionMedium" },
              { name: "sessionCampaignName" },
              { name: "landingPagePlusQueryString" },
            ],
            metrics: [{ name: "sessions" }],
            limit: 10000,
            dimensionFilter: {
              andGroup: {
                expressions: [
                  { filter: { fieldName: "hostName", stringFilter: {
                    matchType: "EXACT", value: config.domain, caseSensitive: false,
                  } } },
                  { notExpression: { filter: {
                    fieldName: "sessionSource",
                    inListFilter: { values: ["release_check", "qa"], caseSensitive: false },
                  } } },
                ],
              },
            },
          },
        );
        return {
          productionHost: config.domain,
          rows: (r.rows || []).map((row: any) => ({
            date: row.dimensionValues[0].value,
            source: row.dimensionValues[1].value,
            medium: row.dimensionValues[2].value,
            campaign: row.dimensionValues[3].value,
            page: safeGooglePage(row.dimensionValues[4].value),
            sessions: Number(row.metricValues[0].value),
          })),
          partial: Number(r.rowCount) > 10000,
        };
      }),
      run("spend", async () => {
        const r = await googlePost(
          `https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:runReport`,
          {
            dateRanges: [{ startDate: start, endDate: end }],
            dimensions: [{ name: "date" }, { name: "sessionCampaignName" }],
            metrics: [
              { name: "advertiserAdCost" },
              { name: "advertiserAdClicks" },
            ],
            currencyCode: "USD",
            limit: 10000,
          },
        );
        const rows = (r.rows || []).map((row: any) => ({
          date: row.dimensionValues[0].value,
          cents: Math.round(Number(row.metricValues[0].value) * 100),
          clicks: Number(row.metricValues[1].value),
        }));
        return {
          rows,
          partial: Number(r.rowCount) > 10000,
          hasData:
            Number(r.rowCount || 0) <= 10000 &&
            rows.some((r: any) => r.cents > 0 || r.clicks > 0),
        };
      }),
      run("search", async () => {
        const r = await googlePost(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("https://" + config.domain + "/")}/searchAnalytics/query`,
          {
            startDate: start,
            endDate: end,
            dimensions: ["page"],
            type: "web",
            rowLimit: 25000,
            dataState: "final",
          },
        );
        return {
          rows: (r.rows || []).map((r: any) => ({
            page: safeGooglePage(r.keys[0]),
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
          partial: (r.rows?.length || 0) >= 25000,
        };
      }),
      run("searchTotals", async () => {
        const r = await googlePost(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("https://" + config.domain + "/")}/searchAnalytics/query`,
          { startDate: start, endDate: end, dimensions: [], type: "web", dataState: "final" },
        );
        // Property totals must not be inferred by adding page or query rows.
        return { totals: r.rows?.[0] ? { clicks: r.rows[0].clicks, impressions: r.rows[0].impressions } : null };
      }),
      run("queries", async () => {
        const r = await googlePost(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("https://" + config.domain + "/")}/searchAnalytics/query`,
          {
            startDate: start,
            endDate: end,
            dimensions: ["query"],
            type: "web",
            rowLimit: 100,
            dataState: "final",
          },
        );
        return {
          rows: (r.rows || []).map((r: any) => ({
            query: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
          partial: true,
        };
      }),
    ]);
    return results;
  } finally {
    jobs.delete(key);
  }
}
