import {publicPage,type PagePerformance} from './page-performance';
import type {AnalyticsPeriod} from './website-analytics';
export function improvementEvidence(page:PagePerformance,period:AnalyticsPeriod,campaign=''){
 const domain=new URL(page.url).hostname;
 const rows=period.bySource.filter(r=>publicPage(r.page,domain)===page.path&&(!campaign||r.campaign===campaign));
 return {sessions:page.sessions,clicks:page.clicks,impressions:page.impressions,engagement:page.engagement,
  leads:rows.reduce((n,r)=>n+r.leads,0),qualified:rows.reduce((n,r)=>n+r.qualified,0),won:rows.reduce((n,r)=>n+r.won,0)};
}
export function comparisonWindow(baseline:{start:string;end:string}|null,current:{start:string;end:string},changed:string|null){
 const days=(p:{start:string;end:string})=>(Date.parse(p.end)-Date.parse(p.start))/86400000+1;
 if(!baseline)return {ready:false,reason:'No saved baseline period. Save a baseline before the next change.'};
 const n=days(baseline);
 if(!Number.isInteger(n)||n<=0||!Number.isInteger(days(current))||days(current)<=0)return {ready:false,reason:'Choose valid reporting dates.'};
 if(!changed)return {ready:false,reason:'Record when the website change actually went live.'};
 if(baseline.end>=changed)return {ready:false,reason:'The baseline overlaps the change. Save a baseline from before the change before comparing.'};
 if(current.start<=changed)return {ready:false,reason:`Choose ${n} days starting after ${changed} to compare results.`};
 if(days(current)!==n)return {ready:false,reason:`Choose ${n} days after the change so both periods have the same length.`};
 return {ready:true,reason:'Equal periods before and after the recorded change. Results show association, not proof that the change caused the difference.'};
}
