import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app,metal,concrete,unpaid;
test.beforeAll(async()=>{
 app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
 const call=async(url,body)=>{const r=await app.api(url,'POST',body,app.owner);expect(r.status).toBeLessThan(300);return r.data;};
 metal=await call('/api/projects',{jobNumber:'BROWSER-M',name:'Metals workflow'});
 concrete=await call('/api/projects',{jobNumber:'BROWSER-C',name:'Concrete workflow'});
 app.sqlite.prepare("UPDATE projects SET site='concrete' WHERE id=?").run(concrete.id);
 unpaid=await call('/api/finance/invoices',{projectId:metal.id,items:'[{"description":"Work","qty":1,"unitPriceCents":50000}]',dueDate:'2026-01-01'});
 app.sqlite.prepare("UPDATE fin_invoices SET status='sent' WHERE id=?").run(unpaid.id);
});
test.afterAll(async()=>app.close());
async function signIn(page){await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);}
test('Temporary authentication outage preserves session and offers retry',async({page})=>{
 await signIn(page);await page.route('**/api/auth/me',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Temporary outage"}'}));
 await page.goto(app.base+'/#/today');await expect(page.getByRole('heading',{name:'Let’s reconnect'})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('wpt-auth-token'))).toBe(app.owner);
 await page.unroute('**/api/auth/me');await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
});
test('Explicit overdue link wins over remembered status, search and page',async({page})=>{
 await signIn(page);await page.addInitScript(()=>{sessionStorage.setItem('suite-view:1:client/src/pages/finance/invoices.tsx:tab','"paid"');sessionStorage.setItem('suite-view:1:client/src/pages/finance/invoices.tsx:q','"absent customer"');});
 await page.goto(app.base+'/#/today');await page.getByRole('link',{name:'Money to collect',exact:true}).filter({visible:true}).click();
 await expect(page.getByText(unpaid.number,{exact:true}).first()).toBeVisible();
 await expect(page.getByPlaceholder(/Search/).filter({visible:true}).last()).toHaveValue('');
});
test('Business filter, live changes across two sessions and mobile workspace',async({page,browser})=>{
 await signIn(page);await page.goto(app.base+'/#/today');
 await page.getByRole('combobox',{name:'Business',exact:true}).selectOption('concrete');
 await expect(page.getByText('Concrete workflow',{exact:true})).toBeVisible();await expect(page.getByText('Metals workflow',{exact:true})).toHaveCount(0);
 const peer=await browser.newPage();try { await signIn(peer);await peer.goto(app.base+'/#/today');await expect(peer.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await peer.evaluate(async token=>{const r=await fetch('/api/pm/tasks',{method:'POST',headers:{'Content-Type':'application/json','X-Auth':token},body:JSON.stringify({title:'New task from another session'})});if(!r.ok)throw Error('Create failed');},app.owner);
 // Unassigned tasks belong to All businesses, so they must not leak into Concrete.
 await expect(page.getByText('New task from another session',{exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Business',exact:true}).selectOption('all');await expect(page.getByText('New task from another session',{exact:true})).toBeVisible({timeout:12000});
 await peer.evaluate(async({token,projectId})=>{const r=await fetch('/api/pm/tasks',{method:'POST',headers:{'Content-Type':'application/json','X-Auth':token},body:JSON.stringify({title:'Live linked job task',projectId})});if(!r.ok)throw Error('Create failed');},{token:app.owner,projectId:concrete.id});
 await expect(page.getByRole('link',{name:'Live linked job task Concrete workflow',exact:true})).toBeVisible({timeout:12000});
 await page.goto(app.base+'/#/project/'+concrete.id+'?tab=files');await expect(page.getByRole('heading',{name:'Photos, drawings & measurements'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:'test-results/suite-audit-job-files-mobile.png',fullPage:true});
 } finally { await peer.close(); }
});
