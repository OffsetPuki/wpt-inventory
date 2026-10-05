import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>app.close());

async function openDraft(page,label){
 const response=await app.api('/api/finance/invoices','POST',{
  clientName:label,items:[{description:'Sample fabrication',qty:1,unitPriceCents:113248}],depositCents:56624,
 },app.owner);
 expect(response.status).toBe(201);
 const invoice=response.data,url=`/api/finance/invoices/${invoice.id}`;
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 // Isolate the recovery button from background live refreshes. Live refresh
 // has separate multi-session coverage in the suite workflow browser tests.
 await page.route('**/api/suite/events',route=>route.abort());
 await page.route(`**${url}`,async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch(),headers=response.headers();
  // Hosting may rewrite the cache validator; the record version is unchanged.
  headers.etag='W/'+headers.etag;
  await route.fulfill({response,headers});
 });
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.goto(app.base+'/#/finance/invoices');
 await page.getByRole('row').filter({hasText:invoice.number}).click();
 await expect(page.getByRole('button',{name:'Mark sent',exact:true})).toBeEnabled();
 return {invoice,url};
}

test('Mark sent works after preview with a rewritten cache tag',async({page,context})=>{
 const {url}=await openDraft(page,'Synthetic send customer');
 // Suppress only navigation to the public site; the preview API is real.
 context.on('page',popup=>popup.close());
 await page.getByRole('button',{name:'Preview',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('Preview link',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Mark sent',exact:true})).toBeEnabled();
 const sent=page.waitForResponse(r=>r.url().endsWith(url)&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'Mark sent',exact:true}).click();
 expect((await sent).status()).toBe(200);
 await expect(page.getByRole('button',{name:'Record payment',exact:true})).toBeVisible();
 expect((await app.api(url,'GET',undefined,app.owner)).data.invoice.status).toBe('sent');
 await page.screenshot({path:'test-results/invoice-sent-mobile.png'});
});

test('A genuine invoice conflict can be reloaded and reviewed before sending',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const {url}=await openDraft(page,'Synthetic conflict customer');
 expect((await app.api(url,'PATCH',{customerNote:'Updated by the other session'},app.owner)).status).toBe(200);
 await page.getByRole('button',{name:'Mark sent',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reload invoice',exact:true})).toBeVisible();
 expect((await app.api(url,'GET',undefined,app.owner)).data.invoice.status).toBe('draft');
 await page.screenshot({path:'test-results/invoice-conflict-desktop.png'});
 await page.getByRole('button',{name:'Reload invoice',exact:true}).click();
 await expect(page.getByRole('dialog').getByText(/Updated by the other session/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Mark sent',exact:true})).toBeEnabled();
 // Reload is read-only: sending still requires the owner's separate click.
 expect((await app.api(url,'GET',undefined,app.owner)).data.invoice.status).toBe('draft');
 await page.getByRole('button',{name:'Mark sent',exact:true}).click();
 await expect(page.getByRole('button',{name:'Record payment',exact:true})).toBeVisible();
 expect((await app.api(url,'GET',undefined,app.owner)).data.invoice.customerNote).toBe('Updated by the other session');
});
