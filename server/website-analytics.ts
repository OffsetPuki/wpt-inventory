import { googleReport } from './google-reporting';
import { reportNames, type AnalyticsPeriod, type ReportName, type SavedReport, type Website } from '../shared/website-analytics';

export function analyticsPeriod(site:Website, cohort:any):AnalyticsPeriod {
  const {start,end}=cohort;
  const get=(name:string)=>googleReport(site,start,end,name);
  const reports=Object.fromEntries(reportNames.map(name=>[name,get('analytics:'+name)])) as Record<ReportName,SavedReport|null>;
  // Existing snapshots remain useful while newly added reports load. Label their limits.
  if(cohort.traffic) {
    const traffic=cohort.traffic;
    const fallback=(rows:any[])=>({rows,fetchedAt:traffic.fetchedAt,partial:traffic.partial,legacy:true});
    if(!reports.summary)reports.summary=fallback([{sessions:traffic.rows.reduce((sum:number,r:any)=>sum+r.sessions,0)}]);
    const group=(keys:string[],rename:Record<string,string>={})=>{
      const grouped=new Map<string,any>();
      for(const row of traffic.rows){const key=JSON.stringify(keys.map(k=>row[k]));const found=grouped.get(key);if(found)found.sessions+=row.sessions;else grouped.set(key,{...Object.fromEntries(keys.map(k=>[rename[k]||k,row[k]||'(not set)'])),sessions:row.sessions});}
      return [...grouped.values()];
    };
    if(!reports.daily)reports.daily=fallback(group(['date']));
    if(!reports.channels)reports.channels=fallback(group(['source','medium','campaign'],{source:'sessionSource',medium:'sessionMedium',campaign:'sessionCampaignName'}));
    if(!reports.landing)reports.landing=fallback(group(['page'],{page:'landingPagePlusQueryString'}));
  }
  const searchTotals=get('searchTotals');
  return {start,end,reports,search:cohort.search,queries:cohort.queries,
    searchTotals:searchTotals?.totals?{...searchTotals.totals,fetchedAt:searchTotals.fetchedAt}:null,
    bing:cohort.bing,totals:cohort.totals,bySource:cohort.bySource,
    spendCents:cohort.spendCents,spendPartial:cohort.spendPartial,missingSpendChannels:cohort.missingSpendChannels};
}
