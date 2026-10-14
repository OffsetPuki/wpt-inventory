import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
import {seedWebsiteAnalytics} from '../scripts/fixtures/website-analytics.mjs';
let app,job;
// Cold loads: 4× CPU slowdown, 1.6 Mbps download, 750 Kbps upload, 150 ms RTT.
// These are CI budgets, not a claim of physical-device certification.
const budgets=[
 {name:'Today',path:'/today',ready:p=>p.getByRole('region',{name:'Your next five actions'}),ms:6000,mb:96},
 {name:'Jobs',path:'/projects',ready:p=>p.getByText('Performance fixture job',{exact:true}),ms:6000,mb:96},
 {name:'Customer search',path:'/crm/clients',ready:p=>p.getByText('Performance fixture customer',{exact:true}).first(),ms:6000,mb:96},
 {name:'Job files',path:()=>`/project/${job.id}?tab=files`,ready:p=>p.getByLabel('Choose job files',{exact:true}),ms:8000,mb:96},
 {name:'Marketing graphs',path:'/marketing?tab=analytics&analysis=pages&analyticsSite=all',ready:p=>p.getByRole('region',{name:'Selected page analysis'}),ms:10000,mb:160},
 {name:'Film 2D fallback',path:'/design-studio/film-table',ready:p=>p.getByRole('button',{name:'Use 2D drawing',exact:true}),ms:10000,mb:160},
];
test.beforeAll(async()=>{
 app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='SYNTHETIC-ONLY' WHERE role='owner'").run();
 const customer=await app.api('/api/crm/clients','POST',{name:'Performance fixture customer'},app.owner);
 job=(await app.api('/api/projects','POST',{name:'Performance fixture job',jobNumber:'PERF-01',clientId:customer.data.id},app.owner)).data;
 const range=(await app.api('/api/marketing/growth/analytics','GET',undefined,app.owner)).data;
 seedWebsiteAnalytics(app.sqlite,range.current,range.previous);
});
test.afterAll(async()=>app.close());
for(const b of budgets)test(`Phone budget: ${b.name}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1.6e6/8,uploadThroughput:750e3/8});
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 let bytes=0;cdp.on('Network.loadingFinished',e=>bytes+=e.encodedDataLength);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const started=Date.now();await page.goto(app.base+'/#'+(typeof b.path==='function'?b.path():b.path));
 await expect(b.ready(page)).toBeVisible();
 if(b.name==='Film 2D fallback'){
  await b.ready(page).click();await expect(page.getByRole('region',{name:'Plant layout drawing',exact:true})).toBeVisible();
 }
 const usefulMs=Date.now()-started;
 const heapMb=(await cdp.send('Runtime.getHeapUsage')).usedSize/1048576;
 let inputP95Ms=null;
 if(b.name==='Job files'){
  let finishUpload;const responseGate=new Promise(resolve=>finishUpload=resolve);
  await page.route('**/api/suite/jobs/*/attachments',async route=>{await responseGate;await route.continue();});
  await page.getByLabel('Choose job files',{exact:true}).setInputFiles({name:'Performance drawing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n'+'.'.repeat(256000))});
  await page.getByRole('button',{name:'Upload / retry remaining files'}).click();
  await expect(page.getByRole('button',{name:'Uploading…',exact:true})).toBeVisible();
  const help=page.getByRole('button',{name:'Help / Ayuda'});await help.scrollIntoViewIfNeeded();
  const t=Date.now();await help.click();await expect(page.getByRole('dialog',{name:'Help with this page'})).toBeVisible();inputP95Ms=Date.now()-t;
  finishUpload();await page.keyboard.press('Escape');
  await expect(page.getByText('Saved to job',{exact:true})).toBeVisible();
  expect(inputP95Ms,'Help remains responsive during an outstanding upload').toBeLessThanOrEqual(250);
 }
 const input=b.name==='Customer search'?page.getByPlaceholder('Search customers…'):b.name==='Marketing graphs'?page.getByLabel('Find a page to compare'):null;
 if(input){const samples=[];for(const value of ['g','ga','gat','gate','gates']){const t=Date.now();await input.fill(value);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));samples.push(Date.now()-t);}inputP95Ms=samples.sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1];expect(inputP95Ms,'Input response with slowed CPU').toBeLessThanOrEqual(250);}
 const report={page:b.name,conditions:'4x CPU / 1.6 Mbps / 150 ms RTT / cold cache / 390x844',usefulMs,heapMb,transferredBytes:bytes,inputP95Ms,budget:{usefulMs:b.ms,heapMb:b.mb,inputP95Ms:250,transferredBytes:1500000}};
 await info.attach('phone-performance.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 console.log('PHONE_PERFORMANCE '+JSON.stringify(report));
 expect(errors).toEqual([]);expect(usefulMs,'Time until real content is usable').toBeLessThanOrEqual(b.ms);
 expect(heapMb,'Used JavaScript heap').toBeLessThanOrEqual(b.mb);expect(bytes,'Cold transfer budget').toBeLessThanOrEqual(1500000);
});
