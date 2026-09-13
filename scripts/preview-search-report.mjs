// Local-only preview: temporary Suite database, no mail/payments, real read-only Bing reports.
import {config} from 'dotenv';
import http from 'node:http';
import {Readable} from 'node:stream';
import {readFileSync,writeFileSync} from 'node:fs';
import {testApp} from './test-app.mjs';
config({path:new URL('../.env.bing.local',import.meta.url),quiet:true});
delete process.env.GOOGLE_REPORTING_OAUTH_JSON;
delete process.env.GOOGLE_REPORTING_SERVICE_ACCOUNT_JSON;
const realFetch=globalThis.fetch;
const app=await testApp({serve:true});
const fixtureFetch=globalThis.fetch;
globalThis.fetch=(url,options={})=>{
  const parsed=new URL(String(url));
  if(parsed.origin==='https://ssl.bing.com'&&/^\/webmaster\/api.svc\/json\/Get(?:RankAndTrafficStats|PageStats|QueryStats|CrawlStats|Feeds)$/.test(parsed.pathname)&&(options.method||'GET')==='GET')return realFetch(url,options);
  return fixtureFetch(url,options);
};
app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='SYNTHETIC-ONLY' WHERE role='owner'").run();
const {refreshBingReports,bingReport}=await import('../server/bing-reporting.ts');
const {startGrowthReporting}=await import('../server/growth.ts');
const end=new Date(Date.now()-86400000).toISOString().slice(0,10),start=new Date(Date.now()-28*86400000).toISOString().slice(0,10);
const checks=[];
if(process.env.BING_REPORTING_API_KEY){
  for(const site of ['metals','concrete','insulation','trades']){
    const result=await refreshBingReports(site);
    const report=bingReport(site,start,end);
    checks.push({site,checkedAt:new Date().toISOString(),results:result,totals:report.totals,crawl:report.crawl,sitemaps:report.sitemaps,weeklyDate:report.weeklyDate,pagesDate:report.pagesDate});
    console.log(site+': '+Object.entries(result).map(([kind,status])=>kind+' '+status).join('; '));
  }
  writeFileSync(new URL('../../_audit/2026-09-12-search-ai/suite-connections-check.json',import.meta.url),JSON.stringify(checks,null,2));
}
const port=4451;
const server=http.createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/'&&req.method==='GET'){
    let html=readFileSync(new URL('../dist/public/index.html',import.meta.url),'utf8');
    html=html.replace('<head>',`<head><script>localStorage.setItem('wpt-auth-token',${JSON.stringify(app.owner)});</script>`).replace(/<body[^>]*>/,match=>match+`<div style="padding:12px 20px;background:#e9efdb;color:#263526;font:14px system-ui;position:relative;z-index:100">Local preview — real Bing reports; isolated example business records. Google remains connected in the live Suite; its private credentials have not been copied here. Nothing has been published.</div>`);
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;
  }
  try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const headers={...req.headers};delete headers.host;delete headers.connection;
    const response=await realFetch(app.base+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    res.statusCode=response.status;
    for(const [key,value] of response.headers)if(!['content-encoding','content-length','transfer-encoding','connection'].includes(key))res.setHeader(key,value);
    if(response.body){const stream=Readable.fromWeb(response.body);stream.on('error',()=>res.destroy());stream.pipe(res);res.on('close',()=>stream.destroy());}else res.end();
  }catch{res.writeHead(502).end('Local preview unavailable.');}
});
server.listen(port,'127.0.0.1',()=>{console.log(`Local Marketing preview: http://127.0.0.1:${port}/#/marketing`);startGrowthReporting();});
process.on('SIGINT',()=>server.close(async()=>{await app.close();process.exit(0);}));
