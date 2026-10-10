import assert from 'node:assert/strict';
import './check-page-performance.mjs';
import {testApp} from './test-app.mjs';
import {seedWebsiteAnalytics} from './fixtures/website-analytics.mjs';
import {coveredSum,searchSummary,trendRows,csvCell,ratio} from '../shared/website-analytics.ts';
import {collectWebsiteReport,withReportingSlot} from '../server/website-reporting.ts';

const app=await testApp();
try {
  const path='/api/marketing/growth/analytics?site=all';
  assert.equal((await app.api(path)).status,401);
  for(const query of ['site=invalid','start=2026-02-30','start=2025-01-01&end=2026-10-01','start=2099-01-01','start=2026-08-28&end=2026-08-01'])assert.equal((await app.api('/api/marketing/growth/analytics?'+query,'GET',undefined,app.owner)).status,400,query);
  const empty=await app.api(path,'GET',undefined,app.owner);
  assert.equal(empty.status,200);assert.equal(empty.data.sites.length,4);
  assert.equal(empty.data.sites[0].current.reports.summary,null,'Missing reports are not zero');
  seedWebsiteAnalytics(app.sqlite,empty.data.current,empty.data.previous);
  const all=(await app.api(path,'GET',undefined,app.owner)).data;
  assert.equal(all.sites.length,4);
  assert.equal(coveredSum(all.sites.map(s=>s.current.reports.summary.rows[0].sessions)).value,800);
  assert.equal((await app.api('/api/marketing/growth/analytics?site=concrete','GET',undefined,app.owner)).data.sites[0].site,'concrete');
  assert.equal(searchSummary([{searchTotals:{clicks:1,impressions:10,position:2}},{searchTotals:{clicks:9,impressions:90,position:12}}]).position,11,'Weight search position by impressions');
  assert.equal(searchSummary([{searchTotals:{clicks:1,impressions:10}},{searchTotals:{clicks:9,impressions:90}}]).ctr,.1);
  assert.deepEqual(coveredSum([10,null,0]),{value:10,covered:2,total:3});
  assert.equal(coveredSum([null]).value,null);assert.equal(ratio(0,0),null);
  const trend=trendRows(all.sites,'searchDaily','clicks');
  assert.equal(trend.at(-1).current,null,'Unfinalized search days are gaps');
  assert.equal(trend[0].coverage,4);
  assert.equal(csvCell(' =HYPERLINK("bad")'),'"\' =HYPERLINK(""bad"")"');

  const config={domain:'www.cjmmetals.com',property:'123'};
  let body;
  const fixture=async(_url,request)=>{body=request;return {rowCount:6000,metadata:{subjectToThresholding:true,dataLossFromOtherRow:true,timeZone:'America/Chicago',samplingMetadatas:[{}]},rows:[{dimensionValues:[{value:'/services/gates?email=private@example.test'}],metricValues:[{value:'10'},{value:'5'},{value:'2'}]},{dimensionValues:[{value:'/services/gates?utm_source=google'}],metricValues:[{value:'4'},{value:'3'},{value:'1'}]}]};};
  const {safeGooglePage,googleReport,refreshGoogleReports}=await import('../server/google-reporting.ts');
  const landing=await collectWebsiteReport('landing',config,'2026-08-01','2026-08-28',fixture,safeGooglePage);
  assert.equal(body.dimensionFilter.andGroup.expressions[0].filter.stringFilter.value,config.domain);
  assert.deepEqual(body.dimensionFilter.andGroup.expressions[1].notExpression.filter.inListFilter.values,['release_check','qa']);
  assert.equal(landing.rows[0].sessions,14);assert.equal(landing.rows.length,1);
  assert.equal(landing.rows[0].landingPagePlusQueryString,'/services/gates');
  assert.equal(landing.partial,true);assert.equal(landing.thresholded,true);assert.equal(landing.sampled,true);
  const noTraffic=await collectWebsiteReport('summary',config,'2026-08-01','2026-08-28',async()=>({rows:[]}),safeGooglePage);
  assert.equal(noTraffic.rows[0].sessions,0,'Successful empty response is measured zero');
  const siteSearch=await collectWebsiteReport('siteSearch',config,'2026-08-01','2026-08-28',async(_url,b)=>{assert.equal(b.dimensionFilter.andGroup.expressions.at(-1).filter.stringFilter.value,'view_search_results');return{rows:[{dimensionValues:[{value:'someone@example.test'}],metricValues:[{value:'2'}]}]};},safeGooglePage);
  assert.equal(siteSearch.rows[0].searchTerm,'[redacted]');
  await collectWebsiteReport('queryPages',config,'2026-08-01','2026-08-28',async(_url,b)=>{assert.equal(b.aggregationType,'byPage');assert.equal(b.dataState,'final');return {rows:[]};},safeGooglePage);
  let active=0,maximum=0;
  await Promise.all(Array.from({length:12},()=>withReportingSlot(async()=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;})));
  assert.equal(maximum,3,'Provider concurrency bounded across refresh jobs');
  const start=all.current.start,end=all.current.end,before=googleReport('metals',start,end,'analytics:summary');
  const fetch=globalThis.fetch;
  process.env.GOOGLE_REPORTING_OAUTH_JSON=JSON.stringify({type:'authorized_user',client_id:'fixture',client_secret:'fixture',refresh_token:'fixture'});
  globalThis.fetch=async(url)=>url==='https://oauth2.googleapis.com/token'?new Response(JSON.stringify({access_token:'fixture',expires_in:3600})):new Response('{}',{status:503});
  try{const result=await refreshGoogleReports('metals',start,end);assert.match(result['analytics:summary'],/503/);}finally{globalThis.fetch=fetch;delete process.env.GOOGLE_REPORTING_OAUTH_JSON;}
  assert.deepEqual(googleReport('metals',start,end,'analytics:summary'),before,'A failed refresh preserves the saved report');
  const failed=(await app.api(path,'GET',undefined,app.owner)).data.sites[0];
  assert.match(failed.connections.googleStatus.find(s=>s.kind==='analytics:summary').error,/503/);
  app.sqlite.prepare("UPDATE users SET role='staff' WHERE role='owner'").run();
  assert.equal((await app.api(path,'GET',undefined,app.owner)).status,403);
  console.log('Website analytics: authorization, range validation, all-site totals, privacy, weighted metrics, coverage, provider limits, stale-data retention and CSV safety passed.');
}finally{await app.close();}
