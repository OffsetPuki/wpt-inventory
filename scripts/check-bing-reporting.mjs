import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
delete process.env.BING_REPORTING_API_KEY;
delete process.env.GOOGLE_REPORTING_OAUTH_JSON;
delete process.env.GOOGLE_REPORTING_SERVICE_ACCOUNT_JSON;
const app=await testApp();
try{
  const {bingDate,bingGet,normalizeBing,refreshBingReports,bingReport}=await import('../server/bing-reporting.ts');
  const {searchConnections}=await import('../server/search-connections.ts');
  assert.equal(bingDate('/Date(1788220800000-0700)/'),'2026-09-01');
  assert.equal(bingDate('2026-09-03T00:00:00Z'),'2026-09-03');
  for(const invalid of [null,42,'not a date','/Date(-62135596800000)/'])assert.equal(bingDate(invalid),null);
  assert.equal(bingReport('metals','2026-08-15','2026-09-11').totals,null);
  process.env.BING_REPORTING_API_KEY='SYNTHETIC_BING_SECRET_NOT_REAL';
  const rows={
    GetRankAndTrafficStats:[{Date:'2026-09-02',Clicks:3,Impressions:30},{Date:'2026-09-03',Clicks:0,Impressions:0},{Date:'2026-08-14',Clicks:9,Impressions:90},{Date:'2099-01-01',Clicks:99,Impressions:999}],
    GetPageStats:[{Date:'2026-09-04',Query:'https://www.cjmmetals.com/services/carports?email=private@example.test',Clicks:2,Impressions:10},{Date:'2026-09-04',Query:'/concepts/secret-token',Clicks:0,Impressions:1}],
    GetQueryStats:[{Date:'2026-08-28',Query:'old weekly row',Clicks:50,Impressions:500},{Date:'2026-09-04',Query:'steel gates',Clicks:1,Impressions:8}],
    GetCrawlStats:[{Date:'2026-09-05',InIndex:72,InLinks:12,CrawlErrors:0,BlockedByRobotsTxt:2}],
    GetFeeds:[{Url:'https://www.cjmmetals.com/sitemap-index.xml',Status:'Success',LastCrawled:'2026-09-06'},{Url:'https://unrelated.example/sitemap.xml',Status:'Success'}],
  };
  const calls=[];
  const transport=async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://ssl.bing.com');
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(parsed.searchParams.get('apikey'),process.env.BING_REPORTING_API_KEY);
    assert.equal(parsed.searchParams.get('siteUrl'),'https://www.cjmmetals.com/');
    const method=parsed.pathname.split('/').at(-1);calls.push(method);
    assert.ok(Object.hasOwn(rows,method));return new Response(JSON.stringify({d:rows[method]}));
  };
  const result=await refreshBingReports('metals',transport);
  assert.equal(calls.length,5);assert.ok(Object.values(result).every(r=>r==='updated'));
  let report=bingReport('metals','2026-08-15','2026-09-11');
  assert.deepEqual(report.totals,{clicks:3,impressions:30,firstDate:'2026-09-02',lastDate:'2026-09-03',reportedDays:2});
  assert.equal(report.topQueries.length,1);assert.equal(report.topQueries[0].clicks,1,'Do not sum multiple weekly snapshots');
  assert.deepEqual(report.topPages.map(r=>r.label),['/services/carports','/private']);
  assert.equal(report.crawl.indexed,72);assert.equal(report.crawl.crawlErrors,0);
  assert.equal(report.sitemaps.length,1);assert.equal(report.errors.length,0);
  assert.equal(bingReport('metals','2026-09-03','2026-09-03').totals.clicks,0,'Real zero differs from missing');
  assert.equal(bingReport('metals','2026-09-08','2026-09-11').totals,null);
  assert.equal(normalizeBing('GetRankAndTrafficStats',[{Date:'2026-09-03',Clicks:null,Impressions:0}]).rows.length,0);
  await assert.rejects(()=>bingGet('DeleteSite','metals',transport),/Unsupported/);
  for(const status of [401,403,429,500]){
    await assert.rejects(()=>bingGet('GetFeeds','metals',async()=>new Response('apikey='+process.env.BING_REPORTING_API_KEY,{status})),error=>!error.message.includes(process.env.BING_REPORTING_API_KEY));
  }
  await refreshBingReports('metals',async()=>{throw new Error('secret-bearing URL apikey='+process.env.BING_REPORTING_API_KEY);});
  report=bingReport('metals','2026-08-15','2026-09-11');
  assert.equal(report.totals.clicks,3,'Keep successful cache on failure');assert.equal(report.errors.length,5);
  assert.ok(!JSON.stringify(report).includes(process.env.BING_REPORTING_API_KEY));
  const links=searchConnections('trades','2026-08-15','2026-09-11').links;
  for(const key of ['googleSearch','googleSitemaps','bingSearch','bingSitemaps','bingIndexing','bingAi','indexNow'])assert.match(links[key],/www.cjmtrades.com/);
  assert.equal((await app.api('/api/marketing/growth?site=metals')).status,401);
  assert.equal((await app.api('/api/marketing/growth/refresh','POST',{site:'metals'})).status,401);
  assert.equal((await app.api('/api/users','POST',{name:'Bing Worker',pin:'1234',role:'worker'},app.owner)).status,201);
  const worker=await app.api('/api/auth/login','POST',{name:'Bing Worker',pin:'1234'});
  assert.equal(worker.status,200);
  assert.equal((await app.api('/api/marketing/growth?site=metals','GET',undefined,worker.data.token)).status,403);
  assert.equal((await app.api('/api/marketing/growth/refresh','POST',{site:'metals'},worker.data.token)).status,403);
  const original=globalThis.fetch;
  globalThis.fetch=(url,options)=>String(url).startsWith('https://ssl.bing.com/')?transport(url,options):original(url,options);
  try{
    const refreshed=await app.api('/api/marketing/growth/refresh','POST',{site:'metals'},app.owner);
    assert.equal(refreshed.status,200);assert.equal(refreshed.data.current['Bing GetFeeds'],'updated','Bing refresh works without Google credentials');
  }finally{globalThis.fetch=original;}
  const api=await app.api('/api/marketing/growth?site=metals','GET',undefined,app.owner);
  assert.equal(api.status,200);assert.equal(api.data.connection.bingConfigured,true);assert.ok(!JSON.stringify(api).includes(process.env.BING_REPORTING_API_KEY));
  console.log('Bing reporting checks passed: periods, weekly snapshots, privacy, cache recovery, site links and authenticated refresh.');
}finally{delete process.env.BING_REPORTING_API_KEY;await app.close();}
