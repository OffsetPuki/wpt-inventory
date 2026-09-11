import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { formatMoney, parseMoney } from "@/lib/format";

const brands = {
  metals: "CJM Metals",
  concrete: "CJM Concrete",
  insulation: "CJM Insulation",
  trades: "CJM Trades",
};
type Site = keyof typeof brands;
type Totals = {
  leads: number;
  qualified: number;
  visits: number;
  quoted: number;
  won: number;
  bookedCents: number;
  collectedCents: number;
  paidQualified: number;
  awaitingContact: number;
  averageResponseMinutes: number | null;
};
type Row = {
  source: string;
  medium: string;
  campaign: string;
  page: string;
  leads: number;
  qualified: number;
  quoted: number;
  won: number;
  bookedCents: number;
  collectedCents: number;
};
type Period = {
  start: string;
  end: string;
  totals: Totals;
  bySource: Row[];
  spendCents: number | null;
  spendSource: string | null;
  costPerQualifiedPaidLeadCents: number | null;
  traffic: {
    rows: { sessions: number; medium?: string }[];
    fetchedAt: number;
    partial: boolean;
  } | null;
  search: {
    rows: {
      page: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }[];
    fetchedAt: number;
  } | null;
  queries: {
    rows: { query: string; clicks: number; impressions: number }[];
  } | null;
};
type Report = {
  site: Site;
  brand: { domain: string };
  current: Period;
  previous: Period;
  connection: { reportingEmail: string | null; outcomesConfigured: boolean };
  queue: { site: Site; state: string; count: number }[];
};
const cell = "px-3 py-3 text-left whitespace-nowrap";
export default function GrowthReport() {
  const [site, setSite] = useState<Site>("metals"),
    [end, setEnd] = useState(""),
    [includeTests, setIncludeTests] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [spend, setSpend] = useState(""),
    [campaign, setCampaign] = useState("business_profile"),
    [channel, setChannel] = useState("google_business");
  const client = useQueryClient();
  const query = useQuery<Report>({
    queryKey: ["marketing-growth", site, end, includeTests],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/marketing/growth?site=${site}&end=${end}&includeTests=${includeTests ? "1" : "0"}`,
        )
      ).json(),
  });
  const overview = useQuery<{start:string;end:string;rows:{site:Site;name:string;sessions:number|null;clicks:number|null;impressions:number|null;leads:number;qualified:number;quoted:number;won:number;bookedCents:number}[]}>({
    queryKey: ["marketing-growth", "overview", end, includeTests],
    queryFn: async () => (await apiRequest("GET", `/api/marketing/growth/overview?end=${end}&includeTests=${includeTests ? "1" : "0"}`)).json(),
  });
  async function action(url: string, body: object) {
    setBusy(true);
    setMessage("");
    try {
      const r = await apiRequest("POST", url, body),
        data = await r.json();
      await client.invalidateQueries({ queryKey: ["marketing-growth"] });
      setMessage(
        data.current
          ? Object.entries(data.current)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")
          : "Saved.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (query.isError)
    return (
      <div role="alert" className="p-4 border rounded-xl">
        Could not load website results.{" "}
        <button className={secondaryBtn} onClick={() => query.refetch()}>
          Retry
        </button>
      </div>
    );
  const r = query.data,
    c = r?.current,
    p = r?.previous;
  const organicTotals = (period?: Period) => (period?.bySource || [])
    .filter(row => row.medium.toLowerCase() === 'organic')
    .reduce((total, row) => ({
      leads: total.leads + row.leads, qualified: total.qualified + row.qualified,
      quoted: total.quoted + row.quoted, won: total.won + row.won,
    }), {leads:0,qualified:0,quoted:0,won:0});
  const organic = organicTotals(c), previousOrganic = organicTotals(p);
  const channels: Record<string, [string, string]> = {
    google_business: ["google", "organic"],
    google_ads: ["google", "cpc"],
    facebook: ["facebook", "social"],
    instagram: ["instagram", "social"],
    qr: ["print", "qr"],
  };
  const link = r ? new URL("https://" + r.brand.domain + "/") : null;
  if (link) {
    link.searchParams.set("utm_source", channels[channel][0]);
    link.searchParams.set("utm_medium", channels[channel][1]);
    link.searchParams.set(
      "utm_campaign",
      campaign.replace(/[^\w.-]/g, "_").slice(0, 80) || "campaign",
    );
  }
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-sm">
          Website
          <select
            className={inputCls + " mt-1"}
            value={site}
            onChange={(e) => {
              setSite(e.target.value as Site);
              setMessage("");
            }}
          >
            {Object.entries(brands).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          28 days ending
          <input
            type="date"
            className={inputCls + " mt-1"}
            value={end || c?.end || ""}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button
          className={secondaryBtn}
          disabled={busy || !r?.connection.reportingEmail}
          onClick={() =>
            action("/api/marketing/growth/refresh", { site, end: c?.end })
          }
        >
          {busy ? "Updating…" : "Refresh Google data"}
        </button>
      </div>
      {!c || !p ? (
        <p role="status">Loading saved business results…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {c.start} to {c.end}, compared with {p.start} to {p.end}. Inquiries
            are grouped by when they arrived; their outcomes and linked payments
            are shown to date. Business dates use Central Time; Google uses each
            property's reporting timezone and may revise recent days.
          </p>
          <section aria-label="All websites organic comparison" className="border rounded-xl p-4 space-y-3 min-w-0">
            <h3 className="font-semibold">Organic results across your websites</h3>
            <p className="text-sm text-muted-foreground">Choose a business to see its details below. Google appearances and clicks come from Search Console; visits come from Analytics; inquiry outcomes come from saved business records. A dash means Google data is not available for this period.</p>
            {overview.isError ? <button className={secondaryBtn} onClick={()=>overview.refetch()}>Retry website comparison</button> : !overview.data ? <p role="status">Loading website comparison…</p> : <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr>{["Business","Google appearances","Google clicks","Organic visits","Inquiries","Qualified","Quoted","Won","Won value"].map(label=><th key={label} scope="col" className={cell}>{label}</th>)}</tr></thead>
                <tbody>{overview.data.rows.map(row=><tr key={row.site} className={row.site===site?"bg-muted/50":""}>
                  <th scope="row" className={cell}><button className="underline underline-offset-4" aria-pressed={row.site===site} onClick={()=>{setSite(row.site);setMessage("");}}>{row.name}</button></th>
                  {[row.impressions??"—",row.clicks??"—",row.sessions??"—",row.leads,row.qualified,row.quoted,row.won,formatMoney(row.bookedCents)].map((value,index)=><td key={index} className={cell}>{value}</td>)}
                </tr>)}</tbody></table>
            </div>}
            <p className="text-sm text-muted-foreground">Refresh Google data for each selected website to update its visits and search totals. These stages overlap: a won inquiry may also appear under Qualified and Quoted.</p>
          </section>
          <section aria-label="Organic search results" className="border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold">Jobs from organic search</h3>
            <p className="text-sm text-muted-foreground">Saved inquiries attributed to organic search, including tagged Google Business Profile links. Outcomes belong to the inquiry cohorts above. These are business records; Analytics sessions and confirmation-page visits are counted separately.</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(["leads", "qualified", "quoted", "won"] as const).map((key,i) => <Metric key={key}
                label={["Organic inquiries","Qualified","Quoted","Won jobs"][i]}
                value={String(organic[key])} detail={`Previous cohort: ${previousOrganic[key]}`} />)}
            </div>
          </section>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(["leads", "qualified", "quoted", "won"] as const).map(
              (key, i) => (
                <div className="border rounded-xl bg-card p-4" key={key}>
                  <p className="text-sm text-muted-foreground">
                    {
                      [
                        "Saved inquiries",
                        "Qualified inquiries",
                        "Quoted inquiries",
                        "Won jobs",
                      ][i]
                    }
                  </p>
                  <p className="text-3xl font-semibold mt-2">{c.totals[key]}</p>
                  <p className="text-sm mt-1">
                    Previous cohort: {p.totals[key]}
                  </p>
                </div>
              ),
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Booked value"
              value={formatMoney(c.totals.bookedCents)}
              detail="Recorded value of won inquiries"
            />
            <Metric
              label="Collected payments"
              value={formatMoney(c.totals.collectedCents)}
              detail="Payments linked to these inquiries, to date"
            />
            <Metric
              label="Ad spend"
              value={
                c.spendCents === null
                  ? "Not connected"
                  : formatMoney(c.spendCents)
              }
              detail={
                c.spendSource || "Connect Google or enter a period total below"
              }
            />
            <Metric
              label="Cost per qualified paid lead"
              value={
                c.costPerQualifiedPaidLeadCents === null
                  ? "—"
                  : formatMoney(c.costPerQualifiedPaidLeadCents)
              }
              detail={`${c.totals.paidQualified} qualified inquiries from paid campaigns`}
            />
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <p>{c.totals.visits} confirmed site visits</p>
            <p>{c.totals.awaitingContact} inquiries awaiting contact</p>
            <p>
              Average first response:{" "}
              {c.totals.averageResponseMinutes === null
                ? "No logged contact"
                : `${c.totals.averageResponseMinutes} minutes`}
            </p>
          </div>
          <div className="border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold">Which visits become jobs?</h3>
            <p className="text-sm text-muted-foreground">
              Original source, campaign and landing page stay attached to the
              inquiry. Older inquiries may have no landing page recorded.
            </p>
            {c.bySource.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {[
                        "Source / campaign",
                        "Landing page",
                        "Inquiries",
                        "Qualified",
                        "Quoted",
                        "Won",
                        "Booked",
                        "Collected",
                      ].map((h) => (
                        <th key={h} className={cell}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.bySource.map((row, i) => (
                      <tr className="border-t" key={i}>
                        {[
                          [row.source, row.medium, row.campaign]
                            .filter(Boolean)
                            .join(" / "),
                          row.page,
                          row.leads,
                          row.qualified,
                          row.quoted,
                          row.won,
                          formatMoney(row.bookedCents),
                          formatMoney(row.collectedCents),
                        ].map((v, n) => (
                          <td key={n} className={cell}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm">No inquiries arrived in this period.</p>
            )}
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <h3 className="font-semibold">Website traffic (Analytics)</h3>
              {c.traffic ? (
                <>
                  <p className="text-3xl font-semibold my-2">
                    {c.traffic.rows.reduce((n, row) => n + row.sessions, 0)}{" "}
                    production website sessions
                  </p>
                  <p className="text-sm">
                    {c.traffic.rows.filter(row => row.medium === 'organic').reduce((n,row)=>n+row.sessions,0)} organic search sessions · all search engines
                  </p>
                  <p className="text-sm">
                    Updated {new Date(c.traffic.fetchedAt).toLocaleString()}
                    {c.traffic.partial ? " · Partial Google result" : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm mt-2">
                  Google traffic has not been imported for this period. Saved
                  inquiry totals above remain available.
                </p>
              )}
            </div>
            <div className="border rounded-xl p-4">
              <h3 className="font-semibold">Pages to improve next</h3>
              {c.search ? (
                <ul className="text-sm divide-y">
                  {[...c.search.rows]
                    .filter((row) => row.impressions >= 20)
                    .sort(
                      (a, b) =>
                        b.impressions - b.clicks - (a.impressions - a.clicks),
                    )
                    .slice(0, 5)
                    .map((row) => (
                      <li key={row.page} className="py-2 break-words">
                        {row.page} · {row.impressions} impressions ·{" "}
                        {row.clicks} clicks · {(row.ctr * 100).toFixed(1)}%
                        click rate · average position {row.position.toFixed(1)}
                        <span className="block text-muted-foreground">{row.position > 20 ? 'Improve service relevance, project evidence and links.' : row.position > 10 ? 'Strengthen useful details and links from related pages.' : 'Review search intent, title and description.'}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm mt-2">
                  Connect Search Console to see pages that appear in searches
                  but receive few clicks.
                </p>
              )}
            </div>
          </div>
          {!!c.queries?.rows.length && (
            <details className="border rounded-xl p-4">
              <summary className="cursor-pointer font-medium">
                Google search terms
              </summary>
              <p className="text-sm my-2">
                Aggregate search data; terms are not linked to individual
                customers. Google omits some queries.
              </p>
              <ul className="text-sm divide-y">
                {c.queries.rows.slice(0, 20).map((q, i) => (
                  <li className="py-2" key={i}>
                    {q.query} · {q.clicks} clicks · {q.impressions} impressions
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="border rounded-xl p-4">
            <summary className="cursor-pointer font-medium">
              Campaign links, staff mode and connections
            </summary>
            <div className="space-y-5 mt-4">
              <div className="flex flex-wrap gap-3 items-end">
                <label className="text-sm">
                  Link placement
                  <select
                    className={inputCls}
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  >
                    {[
                      ["google_business", "Google Business Profile"],
                      ["google_ads", "Google Ads"],
                      ["facebook", "Facebook"],
                      ["instagram", "Instagram"],
                      ["qr", "Printed QR code"],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Campaign name
                  <input
                    className={inputCls}
                    value={campaign}
                    maxLength={80}
                    onChange={(e) => setCampaign(e.target.value)}
                  />
                </label>
                <button
                  className={secondaryBtn}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link!.href);
                      setMessage("Campaign link copied.");
                    } catch {
                      setMessage("Select and copy the campaign link below.");
                    }
                  }}
                >
                  Copy campaign link
                </button>
              </div>
              <input
                aria-label="Campaign link"
                className={inputCls}
                readOnly
                value={link?.href || ""}
              />
              <p className="text-sm">
                Use this link in the selected marketing channel. Links between
                CJM websites preserve the original source automatically.
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <a
                  className="underline"
                  href={`https://${r.brand.domain}/?cjm_staff=1`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Enable staff mode on this device
                </a>
                <a
                  className="underline"
                  href={`https://${r.brand.domain}/?cjm_staff=0`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Return this device to customer mode
                </a>
              </div>
              <label className="flex gap-2 items-center text-sm">
                <input
                  type="checkbox"
                  checked={includeTests}
                  onChange={(e) => setIncludeTests(e.target.checked)}
                />{" "}
                Include staff and labeled release tests in the saved-inquiry
                report
              </label>
              <form
                className="flex gap-3 flex-wrap items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  const cents = parseMoney(spend);
                  if (
                    !/^\d+(?:\.\d{1,2})?$/.test(spend.trim()) ||
                    !Number.isFinite(cents) ||
                    cents < 0
                  ) {
                    setMessage("Enter a valid spend amount.");
                    return;
                  }
                  void action("/api/marketing/growth/spend", {
                    site,
                    end: c.end,
                    amountCents: cents,
                  });
                }}
              >
                <label className="text-sm">
                  Total ad spend for {c.start} to {c.end}
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    required
                    value={spend}
                    onChange={(e) => setSpend(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <button className={primaryBtn} disabled={busy}>
                  Save period spend
                </button>
              </form>
              <p className="text-sm">
                An entered period total replaces Google's spend total for this
                exact period. Include all paid campaigns being compared.
              </p>
              <p className="text-sm">
                Google reporting:{" "}
                {r.connection.reportingEmail
                  ? "Reporting credentials configured"
                  : "Not connected yet"}
                . Lead outcome delivery:{" "}
                {r.connection.outcomesConfigured
                  ? "Configured"
                  : "Not connected yet"}
                .
              </p>
              <ul className="text-sm">
                {r.queue
                  .filter((q) => q.site === site)
                  .map((q) => (
                    <li key={q.state}>
                      {q.count} outcome events:{" "}
                      {q.state === "accepted"
                        ? "accepted by Google transport"
                        : q.state}
                    </li>
                  ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                Outcome events require the visitor's optional measurement
                permission. Accepted delivery does not guarantee appearance in a
                Google report. Google Ads bidding goals are managed separately.
              </p>
            </div>
          </details>
        </>
      )}
      {message && (
        <p role="status" className="text-sm border rounded-lg p-3">
          {message}
        </p>
      )}
    </section>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border rounded-xl bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold my-2">{value}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
