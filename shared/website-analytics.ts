import type { BingReport, SearchConnections } from './search-reporting';

export const websiteNames = { metals: 'CJM Metals', concrete: 'CJM Concrete', insulation: 'CJM Insulation', trades: 'CJM Trades' };
export type Website = keyof typeof websiteNames;
export type AnalyticsRow = Record<string, string | number | null>;
export type SavedReport = {
  rows: AnalyticsRow[];
  fetchedAt: number;
  partial?: boolean;
  thresholded?: boolean;
  sampled?: boolean;
  timeZone?: string;
  legacy?: boolean;
};
export const reportNames = ['summary', 'daily', 'channels', 'landing', 'pages', 'devices', 'locations', 'events', 'siteSearch', 'searchDaily', 'searchDevices', 'searchCountries', 'queryPages'] as const;
export type ReportName = typeof reportNames[number];
export type BusinessTotals = { leads:number; qualified:number; quoted:number; won:number; bookedCents:number; collectedCents:number; awaitingContact:number };
export type OutcomeRow = BusinessTotals & { source:string; medium:string; campaign:string; page:string };
export type AnalyticsPeriod = {
  start:string; end:string;
  reports:Record<ReportName, SavedReport|null>;
  search:SavedReport|null; queries:SavedReport|null;
  searchTotals:{clicks:number; impressions:number; position?:number; fetchedAt:number}|null;
  bing:BingReport;
  totals:BusinessTotals;
  bySource:OutcomeRow[];
  spendCents:number|null; spendPartial:boolean; missingSpendChannels:string[];
};
export type WebsiteResult = { site:Website; domain:string; current:AnalyticsPeriod; previous:AnalyticsPeriod; connections:SearchConnections };
export type WebsiteAnalytics = {
  current:{start:string; end:string}; previous:{start:string; end:string};
  sites:WebsiteResult[]; generatedAt:number;
};
export const metric = (row:AnalyticsRow|undefined, key:string):number|null => typeof row?.[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : null;
export const ratio = (numerator:number|null, denominator:number|null) => numerator == null || denominator == null || denominator === 0 ? null : numerator / denominator;
// Missing sources never become zero. Coverage accompanies every combined metric.
export function coveredSum(values:(number|null|undefined)[]) {
  const known = values.filter((value):value is number => typeof value === 'number' && Number.isFinite(value));
  return { value:known.length ? known.reduce((a,b)=>a+b,0) : null, covered:known.length, total:values.length };
}
export function searchSummary(periods:AnalyticsPeriod[]) {
  const clicks = coveredSum(periods.map(p=>p.searchTotals?.clicks));
  const impressions = coveredSum(periods.map(p=>p.searchTotals?.impressions));
  const positioned = periods.filter(p=>typeof p.searchTotals?.position==='number');
  const positionWeight = positioned.reduce((sum,p)=>sum+p.searchTotals!.impressions,0);
  return { clicks, impressions, ctr:ratio(clicks.value,impressions.value), position:positionWeight && positioned.length===periods.filter(p=>p.searchTotals).length ? positioned.reduce((sum,p)=>sum+p.searchTotals!.position!*p.searchTotals!.impressions,0)/positionWeight : null };
}
export function reportRows(sites:WebsiteResult[], name:ReportName|'search'|'queries', period:'current'|'previous'='current'):Array<AnalyticsRow & {website:string;site:Website}> {
  return sites.flatMap(site=>(name==='search'||name==='queries'?site[period][name]:site[period].reports[name])?.rows.map(row=>({...row,website:websiteNames[site.site],site:site.site})) || []);
}
export function searchComparisonRows(sites:WebsiteResult[],name:'queries'|'search') {
  const key=name==='queries'?'query':'page';
  const previous=new Map(reportRows(sites,name,'previous').map(row=>[JSON.stringify([row.site,row[key]]),row]));
  return reportRows(sites,name).map(row=>{
    const prior=previous.get(JSON.stringify([row.site,row[key]]));
    const old=metric(prior,'clicks'),current=metric(row,'clicks');
    return {...row,previousClicks:old,clickChange:old==null||current==null?null:current-old};
  });
}
export function dateList(start:string,end:string) {
  const days:string[]=[];
  for(let time=Date.parse(start);time<=Date.parse(end);time+=86400000)days.push(new Date(time).toISOString().slice(0,10));
  return days;
}
export function trendRows(sites:WebsiteResult[], name:'daily'|'searchDaily', key:string) {
  if(!sites.length)return [];
  const ranges={current:dateList(sites[0].current.start,sites[0].current.end),previous:dateList(sites[0].previous.start,sites[0].previous.end)};
  const series = (period:'current'|'previous') => ranges[period].map(date=>{
    const values=sites.map(site=>{
      const report=site[period].reports[name];
      if(!report)return null;
      const rows=report.rows.filter(row=>String(row.date).replace(/-/g,'')===date.replace(/-/g,''));
      // GSC omits unfinalized/no-data days. Never draw those as measured zeros.
      if(name==='searchDaily'&&!rows.length)return null;
      return rows.reduce((sum,row)=>sum+(metric(row,key)||0),0);
    });
    return coveredSum(values);
  });
  const current=series('current'),previous=series('previous');
  return ranges.current.map((date,index)=>({date,previousDate:ranges.previous[index],current:current[index].value,previous:previous[index]?.value??null,coverage:current[index].covered,previousCoverage:previous[index]?.covered??0}));
}
export function csvCell(value:unknown) {
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
