import type {BingReport, SearchConnections as Connections} from '@shared/search-reporting';

const updated=(time:number|null|undefined)=>time?new Date(time).toLocaleString():'Not refreshed yet';
const number=(value:number|null|undefined)=>value==null?'Unavailable':value.toLocaleString();
function ToolLink({href,children}:{href:string;children:React.ReactNode}) {
  return <a className="underline underline-offset-4" href={href} target="_blank" rel="noopener noreferrer">{children} ↗</a>;
}
export default function SearchConnections({connection:c,bing,previousBing}:{connection:Connections;bing:BingReport;previousBing:BingReport}) {
  const googleErrors=c.googleStatus.filter(s=>s.error);
  const googleSuccess=Math.max(0,...c.googleStatus.map(s=>s.succeededAt||0));
  return <section aria-label="Search connections and visibility" className="border rounded-xl p-4 space-y-5 min-w-0">
    <h3 className="font-semibold">Search connections and visibility</h3>
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-lg border p-3 space-y-2"><h4 className="font-medium">Google Analytics</h4><p className="text-sm">{!c.googleConfigured?'Not connected':c.googleStatus.some(s=>s.kind==='traffic'&&s.error)?'Needs attention':c.googleStatus.some(s=>s.kind==='traffic'&&s.succeededAt)?'Connected':'Configured · awaiting refresh'}</p><p className="text-xs text-muted-foreground">Visits, sources and landing pages</p><ToolLink href={c.links.analytics}>Open Analytics</ToolLink></div>
      <div className="rounded-lg border p-3 space-y-2"><h4 className="font-medium">Google Search Console</h4><p className="text-sm">{!c.googleConfigured?'Not connected':googleErrors.some(s=>s.kind!=='traffic'&&s.kind!=='spend')?'Needs attention':c.googleStatus.some(s=>s.kind==='searchTotals'&&s.succeededAt)?'Connected':'Configured · awaiting refresh'}</p><p className="text-xs text-muted-foreground">Search clicks, appearances and indexing</p><ToolLink href={c.links.googleSearch}>Open Search Console</ToolLink></div>
      <div className="rounded-lg border p-3 space-y-2"><h4 className="font-medium">Bing Webmaster Tools</h4><p className="text-sm">{!bing.configured?'Not connected':bing.errors.length?'Needs attention':bing.fetchedAt?'Connected':'Configured · awaiting refresh'}</p><p className="text-xs text-muted-foreground">Search activity, indexed pages and sitemaps</p><ToolLink href={c.links.bingSearch}>Open Bing</ToolLink></div>
    </div>
    <p className="text-xs text-muted-foreground">Google refreshed: {updated(googleSuccess)} · Bing refreshed: {updated(bing.fetchedAt)}. Connected reports refresh automatically every six hours while the Suite is running.</p>
    {(googleErrors.length>0||bing.errors.length>0)&&<div role="status" className="rounded-lg border p-3 text-sm"><p className="font-medium">Some reports could not refresh. Previously saved data remains visible.</p><ul className="list-disc pl-5">{googleErrors.map(e=><li key={'g'+e.kind}>Google {e.kind}: {e.error} · attempted {updated(e.attemptedAt)} · last success {updated(e.succeededAt)}</li>)}{bing.errors.map(e=><li key={'b'+e.kind}>Bing {e.kind}: {e.message}</li>)}</ul></div>}
    <section aria-label="Bing search results" className="space-y-3">
      <h4 className="font-medium">Bing search results</h4>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-sm">Bing appearances</p><p className="text-2xl font-semibold">{number(bing.totals?.impressions)}</p><p className="text-xs">Previous period: {number(previousBing.totals?.impressions)}</p></div>
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-sm">Bing clicks</p><p className="text-2xl font-semibold">{number(bing.totals?.clicks)}</p><p className="text-xs">Previous period: {number(previousBing.totals?.clicks)}</p></div>
      </div>
      <p className="text-sm text-muted-foreground">{bing.totals?`Available dates: ${bing.totals.firstDate} to ${bing.totals.lastDate} (${bing.totals.reportedDays} reported days).`:bing.configured?'Waiting for Bing activity data for this period. Missing reports do not mean zero traffic.':'Bing reports will appear after the server connection is configured.'} Bing includes its search surfaces, such as web, images, news and chat. These are search clicks and appearances, not Analytics visits or AI citation counts.</p>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Top Bing pages and searches</summary><p className="text-sm text-muted-foreground mt-2">Bing supplies these as weekly snapshots, separate from the period totals above.</p><div className="grid gap-4 lg:grid-cols-2 mt-3">{([{label:'Pages',date:bing.pagesDate,rows:bing.topPages},{label:'Searches',date:bing.weeklyDate,rows:bing.topQueries}]).map(group=><div key={group.label}><h5 className="font-medium">{group.label} · {group.date||'Waiting for data'}</h5>{group.rows.length?<ul className="space-y-2 mt-2 text-sm">{group.rows.map((row,index)=><li key={index} className="break-words">{row.label}<span className="block text-xs text-muted-foreground">{number(row.clicks)} clicks · {number(row.impressions)} appearances</span></li>)}</ul>:<p className="text-sm text-muted-foreground">No snapshot available yet.</p>}</div>)}</div></details>
    </section>
    <details className="rounded-lg border p-3 space-y-3"><summary className="cursor-pointer font-medium">Indexing, sitemaps and search tools</summary>
      <div className="grid gap-4 lg:grid-cols-2 text-sm">
        <div className="space-y-2"><h4 className="font-medium">Google indexing</h4><p>{c.googleIndexing?`${c.googleIndexing.coverage} · checked ${updated(c.googleIndexing.fetchedAt)}`:'Homepage inspection not available yet.'}</p><p className="text-muted-foreground">This checks the homepage only. Open the indexing report for other pages.</p><ToolLink href={c.links.googleIndexing}>Page indexing</ToolLink>
          <h5 className="font-medium pt-2">Google sitemaps</h5>{c.googleSitemaps?.rows.length?<ul className="space-y-2">{c.googleSitemaps.rows.map((s,i)=><li key={i} className="break-words">{s.path}<span className="block text-muted-foreground">{s.pending?'Processing':s.errors?'Needs attention':'Processed'} · {s.submitted} submitted URLs · {s.errors} errors · {s.warnings} warnings</span></li>)}</ul>:<p className="text-muted-foreground">No sitemap report available.</p>}<ToolLink href={c.links.googleSitemaps}>Manage Google sitemaps</ToolLink>
        </div>
        <div className="space-y-2"><h4 className="font-medium">Bing indexing</h4><p>{bing.crawl?`${number(bing.crawl.indexed)} indexed pages · ${bing.crawl.date}`:'Indexed page count not available yet.'}</p>{bing.crawl&&<p className="text-muted-foreground">{number(bing.crawl.crawlErrors)} crawl errors · {number(bing.crawl.blocked)} blocked URLs</p>}<ToolLink href={c.links.bingIndexing}>Explore indexed pages</ToolLink>
          <h5 className="font-medium pt-2">Bing sitemaps</h5>{bing.sitemaps?.length?<ul className="space-y-2">{bing.sitemaps.map((s,i)=><li key={i} className="break-words">{s.url}<span className="block text-muted-foreground">{s.status} · last crawled {s.lastCrawled||'not reported'}</span></li>)}</ul>:<p className="text-muted-foreground">No sitemap report available.</p>}<ToolLink href={c.links.bingSitemaps}>Manage Bing sitemaps</ToolLink>
        </div>
      </div>
      <div className="border-t pt-3 flex flex-wrap gap-4 text-sm"><ToolLink href={c.links.bingAi}>Bing AI Performance</ToolLink><ToolLink href={c.links.indexNow}>IndexNow activity</ToolLink><ToolLink href={c.links.businessProfiles}>Google Business Profiles</ToolLink></div><p className="text-xs text-muted-foreground">These tools open their provider dashboards. AI citation and Business Profile statistics are not imported here. IndexNow sends updates only after the website integration is published.</p>
    </details>
  </section>;
}
