import {sqlite} from './storage';
import {GOOGLE_SITES,type Site} from './lead-measurement';
import {safeGooglePage} from './google-reporting';
import {recordReportingStatus,reportingStatus} from './reporting-status';
import type {BingDaily,BingTop,BingReport} from '../shared/search-reporting';

sqlite.exec(`CREATE TABLE IF NOT EXISTS mk_bing_reports(site TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(site,kind));`);
export const bingConfigured=()=>!!process.env.BING_REPORTING_API_KEY?.trim();
const methods=['GetRankAndTrafficStats','GetPageStats','GetQueryStats','GetCrawlStats','GetFeeds'] as const;
type Method=typeof methods[number];
export function bingDate(value:unknown):string|null {
  if (typeof value !== 'string') return null;
  const dotnet=/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  const time=dotnet?Number(dotnet[1]):Date.parse(value);
  if (!Number.isFinite(time) || time <= 0) return null;
  try {return new Date(time).toISOString().slice(0,10);} catch {return null;}
}
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export async function bingGet(method:Method,site:Site,transport:typeof fetch=fetch,key=process.env.BING_REPORTING_API_KEY?.trim()) {
  if (!key) throw new Error('Bing reporting is not connected.');
  if (!methods.includes(method)||!GOOGLE_SITES[site]) throw new Error('Unsupported Bing report.');
  const url=new URL('https://ssl.bing.com/webmaster/api.svc/json/'+method);
  url.searchParams.set('siteUrl','https://'+GOOGLE_SITES[site].domain+'/');
  url.searchParams.set('apikey',key);
  let res:Response;
  try {res=await transport(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}});}
  catch {throw new Error('Bing could not be reached. Saved data is retained.');}
  if (!res.ok) throw new Error([401,403].includes(res.status)?'Bing access needs reconnection or site permission.':`Bing reporting returned HTTP ${res.status}. Try again later.`);
  let data:any;try{data=await res.json();}catch{throw new Error('Bing returned an unreadable report.');}
  // Never return Bing's raw error text: some responses repeat credential-bearing URLs.
  if (!Array.isArray(data?.d)) throw new Error('Bing did not provide a valid report.');
  return data.d;
}
export function normalizeBing(method:Method,rows:any[]) {
  if(method==='GetFeeds') return {rows:rows.map(r=>({url:typeof r.Url==='string'?r.Url:'',status:typeof r.Status==='string'?r.Status.slice(0,100):'Unknown',lastCrawled:bingDate(r.LastCrawled)}))};
  if(method==='GetCrawlStats') return {rows:rows.flatMap(r=>{const date=bingDate(r.Date);return date?[{date,indexed:count(r.InIndex),crawlErrors:count(r.CrawlErrors),blocked:count(r.BlockedByRobotsTxt),links:count(r.InLinks)}]:[];})};
  return {rows:rows.flatMap(r=>{
    const date=bingDate(r.Date),clicks=count(r.Clicks),impressions=count(r.Impressions);
    if(!date||clicks===null||impressions===null)return [];
    if(method==='GetRankAndTrafficStats')return [{date,clicks,impressions}];
    if(typeof r.Query!=='string')return [];
    return [{date,clicks,impressions,label:method==='GetPageStats'?safeGooglePage(r.Query):r.Query.slice(0,180)}];
  })};
}
function cache(site:Site,kind:Method) {
  const r=sqlite.prepare('SELECT payload,fetched_at FROM mk_bing_reports WHERE site=? AND kind=?').get(site,kind) as any;
  if(!r)return null;const payload=JSON.parse(r.payload);if(kind==='GetPageStats')payload.rows=(payload.rows||[]).map((row:any)=>({...row,label:safeGooglePage(row.label)}));return {...payload,fetchedAt:r.fetched_at};
}
const jobs=new Map<Site,Promise<Record<string,string>>>();
export function refreshBingReports(site:Site,transport:typeof fetch=fetch) {
  if(jobs.has(site))return jobs.get(site)!;
  const work=(async()=>{
    const results:Record<string,string>={};
    for(const method of methods){
      try{
        const data=normalizeBing(method,await bingGet(method,site,transport));
        sqlite.prepare(`INSERT INTO mk_bing_reports(site,kind,payload,fetched_at) VALUES(?,?,?,?) ON CONFLICT(site,kind) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at`).run(site,method,JSON.stringify(data),Date.now());
        recordReportingStatus('bing',site,method,null);results[method]='updated';
      }catch(error){
        const message=error instanceof Error?error.message:'Bing report unavailable.';
        recordReportingStatus('bing',site,method,message);results[method]=message;
      }
    }
    return results;
  })().finally(()=>jobs.delete(site));
  jobs.set(site,work);return work;
}
export function bingReport(site:Site,start:string,end:string):BingReport {
  const daily=cache(site,'GetRankAndTrafficStats');
  const rows:BingDaily[]=(daily?.rows||[]).filter((r:BingDaily)=>r.date>=start&&r.date<=end);
  const dates=[...new Set(rows.map(r=>r.date))].sort();
  const snapshot=(kind:'GetPageStats'|'GetQueryStats')=>{
    const all:BingTop[]=cache(site,kind)?.rows||[];
    const date=all.filter(r=>r.date<=end).map(r=>r.date).sort().at(-1)||null;
    return {date,rows:all.filter(r=>r.date===date).sort((a,b)=>b.impressions-a.impressions).slice(0,10)};
  };
  const pages=snapshot('GetPageStats'),queries=snapshot('GetQueryStats');
  const crawls=cache(site,'GetCrawlStats'),feeds=cache(site,'GetFeeds');
  return {
    configured:bingConfigured(),
    totals:rows.length?{clicks:rows.reduce((n,r)=>n+r.clicks,0),impressions:rows.reduce((n,r)=>n+r.impressions,0),firstDate:dates[0],lastDate:dates.at(-1)!,reportedDays:dates.length}:null,
    topPages:pages.rows,topQueries:queries.rows,pagesDate:pages.date,weeklyDate:queries.date,
    crawl:crawls?.rows.filter((r:any)=>r.date<=new Date().toISOString().slice(0,10)).sort((a:any,b:any)=>b.date.localeCompare(a.date))[0]||null,
    sitemaps:feeds?feeds.rows.filter((r:any)=>{try{return new URL(r.url).origin==='https://'+GOOGLE_SITES[site].domain;}catch{return false;}}):null,
    fetchedAt:daily?.fetchedAt||null,
    errors:reportingStatus('bing',site).filter(r=>r.error).map(r=>({kind:r.kind,message:r.error!,attemptedAt:r.attemptedAt})),
  };
}
