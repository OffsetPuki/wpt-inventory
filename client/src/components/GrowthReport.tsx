import {useApiMutation} from '@/hooks/useApiMutation';
import {MarketingCampaigns,MarketingOutcomes,exportMarketingReport} from './MarketingTools';
import MarketingSpending from './MarketingSpending';
import {useMarketingPlace} from '@/hooks/useMarketingPlace';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { formatMoney } from "@/lib/format";
import { aiReferralProvider } from "@shared/ai-referrals";
import SearchConnections from './SearchConnections';
import type {BingReport, SearchConnections as ConnectionReport} from '@shared/search-reporting';

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
  bing: BingReport;
  start: string;
  end: string;
  totals: Totals;
  bySource: Row[];
  spendCents: number | null;
  spendSource: string | null;
  matchedQualified:number;missingSpendChannels:string[];spendPartial:boolean;
  costPerQualifiedPaidLeadCents: number | null;
  traffic: {
    rows: { sessions: number; source?: string; medium?: string }[];
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
  connection: { reportingEmail: string | null; outcomesConfigured: boolean; bingConfigured:boolean };
  searchConnections: ConnectionReport;
  queue: { site: Site; state: string; count: number }[];
};
const cell = "px-3 py-3 text-left whitespace-nowrap";
export default function GrowthReport({view="overview"}:{view?:string}) {
  const [site, setSite] = useMarketingPlace<Site>("site","metals"),
    [end, setEnd] = useMarketingPlace<string>("end",""),
    [start,setStart]=useMarketingPlace<string>("start",""),
    [includeTests, setIncludeTests] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const client = useQueryClient();
  const opportunity=useApiMutation<unknown,string>({request:path=>({method:'POST',url:'/api/marketing/opportunities',body:{site,path}}),invalidate:[['pm']],successTitle:'Search improvement added to Tasks',errorTitle:'Could not add task'});
  const query = useQuery<Report>({
    queryKey: ["marketing-growth", site, start, end, includeTests],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/marketing/growth?site=${site}&start=${start}&end=${end}&includeTests=${includeTests ? "1" : "0"}`,
        )
      ).json(),
  });
  const overview = useQuery<{start:string;end:string;rows:{site:Site;name:string;trafficPartial:boolean;sessions:number|null;clicks:number|null;impressions:number|null;bingClicks:number|null;bingImpressions:number|null;leads:number;qualified:number;quoted:number;won:number;bookedCents:number}[]}>({
    queryKey: ["marketing-growth", "overview", start, end, includeTests],
    queryFn: async () => (await apiRequest("GET", `/api/marketing/growth/overview?start=${start}&end=${end}&includeTests=${includeTests ? "1" : "0"}`)).json(),
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
          ? [data.current,data.previous].some(period=>Object.values(period||{}).some(value=>value!=='updated'))
            ? ['current','previous'].flatMap(period=>Object.entries(data[period]||{}).filter(([,value])=>value!=='updated').map(([provider,value])=>`${period}: ${provider} — ${value}`)).join('; ')
            : 'Search reports updated.'
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
        </button><button className={secondaryBtn} onClick={()=>{setStart("");setEnd("");}}>Reset dates</button>
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
  const aiTotals = (period?: Period) => (period?.bySource || [])
    .filter(row => aiReferralProvider(row.source, row.medium))
    .reduce((total, row) => ({leads:total.leads+row.leads,qualified:total.qualified+row.qualified,
      quoted:total.quoted+row.quoted,won:total.won+row.won}), {leads:0,qualified:0,quoted:0,won:0});
  const ai = aiTotals(c), previousAi = aiTotals(p);
  const aiSessions = c?.traffic ? c.traffic.rows
    .filter(row => aiReferralProvider(row.source, row.medium)).reduce((n,row)=>n+row.sessions,0) : null;
  if(view!=='overview')return <section className="space-y-4"><label>Business<select className={inputCls} value={site} onChange={e=>setSite(e.target.value as Site)}>{Object.entries(brands).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{view==='campaigns'?<MarketingCampaigns key={site} site={site}/>:r&&c&&p?<><SearchConnections connection={r.searchConnections} bing={c.bing} previousBing={p.bing}/><p className="text-sm">Grant the reporting account access in each provider, then refresh this business. Contact your administrator if credentials need updating.</p><button className={secondaryBtn} disabled={busy} onClick={()=>action('/api/marketing/growth/refresh',{site,start:c.start,end:c.end})}>Refresh connection checks</button><MarketingOutcomes site={site}/><a className="underline" href={`https://${r.brand.domain}/?cjm_staff=1`} target="_blank" rel="noreferrer">Enable staff mode on this device</a></>:<p>Loading connection details…</p>}{message&&<p role="status">{message}</p>}</section>;
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-sm">Quick ranges<select aria-label="Quick ranges" className={inputCls} value="" onChange={e=>{const chosen=e.target.value;if(chosen==='month'||chosen==='lastMonth'){const now=new Date();const month=chosen==='month'?now.getUTCMonth():now.getUTCMonth()-1;setStart(new Date(Date.UTC(now.getUTCFullYear(),month,1)).toISOString().slice(0,10));setEnd(chosen==='month'?new Date(Date.now()-86400000).toISOString().slice(0,10):new Date(Date.UTC(now.getUTCFullYear(),month+1,0)).toISOString().slice(0,10));return;}const days=Number(chosen);if(days){const finish=end||new Date(Date.now()-86400000).toISOString().slice(0,10);setEnd(finish);setStart(new Date(Date.parse(finish)-(days-1)*86400000).toISOString().slice(0,10));}}}><option value="">Choose range</option><option value="month" disabled={new Date().getUTCDate()===1}>This month</option><option value="lastMonth">Last month</option><option value="7">7 days</option><option value="28">28 days</option><option value="90">90 days</option><option value="0">Custom</option></select></label>
        <label className="text-sm">Period starting<input type="date" className={inputCls} max={end||new Date(Date.now()-86400000).toISOString().slice(0,10)} value={start||c?.start||''} onChange={e=>setStart(e.target.value)}/></label>
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
          Period ending
          <input
            type="date"
            max={new Date(Date.now()-86400000).toISOString().slice(0,10)}
            className={inputCls + " mt-1"}
            value={end || c?.end || ""}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button
          className={secondaryBtn}
          disabled={busy || (!r?.connection.reportingEmail && !r?.connection.bingConfigured)}
          onClick={() =>
            action("/api/marketing/growth/refresh", { site, start:c?.start, end: c?.end })
          }
        >
          {busy ? "Updating…" : "Refresh search data"}
        </button>
      </div>
      {!c || !p ? (
        <p role="status">Loading saved business results…</p>
      ) : (
        <>
          {(c.spendPartial||c.traffic?.partial||c.missingSpendChannels?.length>0)&&<p role="status" className="rounded-lg border p-3 text-sm">{c.spendPartial||c.traffic?.partial?'Provider data is partial. Totals may be incomplete. ':''}{c.missingSpendChannels?.length>0?`Missing spend for: ${c.missingSpendChannels.join(', ')}. These channels are excluded from cost per lead.`:''}</p>}
          <p className="text-sm text-muted-foreground">
            {c.start} to {c.end}, compared with {p.start} to {p.end}. Inquiries
            are grouped by when they arrived; their outcomes and linked payments
            are shown to date. Business dates use Central Time; Google uses each
            property's reporting timezone and may revise recent days.
          </p>
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
                c.spendSource || "Connect Google or add dated spending below"
              }
            />
            <Metric
              label="Cost per qualified paid lead"
              value={
                c.costPerQualifiedPaidLeadCents === null
                  ? "—"
                  : formatMoney(c.costPerQualifiedPaidLeadCents)
              }
              detail={`${c.matchedQualified} qualified inquiries from channels with known spend`}
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
          <nav aria-label="Marketing actions" className="flex flex-wrap gap-3 text-sm"><a className={secondaryBtn} href="#/crm/leads">Contact inquiries</a><a className={secondaryBtn} href="#/marketing?tab=reviews&reviewFilter=unresponded">Respond to reviews</a><a className={secondaryBtn} href="#/marketing?tab=portfolio&portfolioFilter=drafts">Review work drafts</a><a className={secondaryBtn} href="#/pm/board">Open follow-up tasks</a></nav>
          <section aria-label="All websites organic comparison" className="border rounded-xl p-4 space-y-3 min-w-0">
            <h3 className="font-semibold">Organic results across your websites</h3>
            <p className="text-sm text-muted-foreground">Choose a business to see its details below. Google and Bing provide their own search appearances and clicks; visits come from Analytics; inquiry outcomes come from saved business records. A dash means the provider has no report for this period.</p>
            {overview.isError ? <button className={secondaryBtn} onClick={()=>overview.refetch()}>Retry website comparison</button> : !overview.data ? <p role="status">Loading website comparison…</p> : <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr>{["Business","Google appearances","Google clicks","Bing appearances","Bing clicks","Organic visits","Inquiries","Qualified","Quoted","Won","Won value"].map(label=><th key={label} scope="col" className={cell}>{label}</th>)}</tr></thead>
                <tbody>{overview.data.rows.map(row=><tr key={row.site} className={row.site===site?"bg-muted/50":""}>
                  <th scope="row" className={cell}><button className="underline underline-offset-4" aria-pressed={row.site===site} onClick={()=>{setSite(row.site);setMessage("");}}>{row.name}</button></th>
                  {[row.impressions??"—",row.clicks??"—",row.bingImpressions??"—",row.bingClicks??"—",row.trafficPartial?`${row.sessions??"—"} (partial)`:row.sessions??"—",row.leads,row.qualified,row.quoted,row.won,formatMoney(row.bookedCents)].map((value,index)=><td key={index} className={cell}>{value}</td>)}
                </tr>)}</tbody></table>
            </div>}
            <p className="text-sm text-muted-foreground">Refresh search data for each selected website to update its visits and search totals. These stages overlap: a won inquiry may also appear under Qualified and Quoted.</p>
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

          <section aria-label="AI referral results" className="border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold">Visits and jobs from AI assistants</h3>
            <p className="text-sm text-muted-foreground">{aiSessions === null ? 'Analytics visits unavailable' : `${aiSessions} Analytics visits from recognized AI sources`}{c.traffic?.partial ? ' (partial report)' : ''}. Includes recognized ChatGPT, Perplexity, Claude, Gemini and Copilot referral sources. Google AI answers remain part of Google search; visits without a referrer cannot be identified here.</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(["leads", "qualified", "quoted", "won"] as const).map((key,i) => <Metric key={key}
                label={["AI-referred inquiries","Qualified","Quoted","Won jobs"][i]}
                value={String(ai[key])} detail={`Previous cohort: ${previousAi[key]}`} />)}
            </div>
            <p className="text-sm text-muted-foreground">Inquiries and outcomes come from saved business records. These counts measure attributed visits and jobs, not how often an AI mentions or recommends CJM.</p>
          </section>
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
                        <button className={secondaryBtn} disabled={opportunity.isPending} onClick={()=>opportunity.mutate(row.page)}>Add improvement task</button>
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
          <MarketingSpending key={`${site}:${c.start}:${c.end}`} site={site} start={c.start} end={c.end}/>
          <div className="flex gap-3"><button className={secondaryBtn} onClick={()=>exportMarketingReport(r)}>Export CSV</button><button className={secondaryBtn} onClick={()=>window.print()}>Print / PDF</button></div>

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
