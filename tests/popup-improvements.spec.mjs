import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{test.setTimeout(180000);app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>app?.close());
test.beforeEach(async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
});
const makeLead=async name=>(await app.api('/api/crm/leads','POST',{name,site:'metals',phone:'8175550100',email:'fixture@example.test',serviceRequested:'Carport',notes:'Cover the driveway.'},app.owner)).data;
const makeQuote=async lead=>{
 const r=await app.api('/api/quotes','POST',{type:'custom',customerName:lead.name,leadId:lead.id,totalCents:10000,payload:{type:'custom',customer:{name:lead.name,email:'fixture@example.test'},depositPct:50}},app.owner);
 expect(r.status).toBe(201);return r.data;
};

test('Lead overview, edits, discard choices and expired-quote close workflow',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{errors.push('Unexpected browser dialog: '+d.message());await d.dismiss();});
 const lead=await makeLead('Lead popup fixture'),quote=await makeQuote(lead);
 await app.api(`/api/quotes/${quote.id}/share`,'POST',{},app.owner);
 const row=app.sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(quote.id),payload=JSON.parse(row.payload);
 payload.quotePolicy.expiresAt=Date.now()-86400000;
 app.sqlite.prepare('UPDATE quotes SET payload=? WHERE id=?').run(JSON.stringify(payload),quote.id);
 await page.goto(app.base+`/#/crm/leads?lead=${lead.id}`);
 let dialog=page.getByRole('dialog',{name:lead.name,exact:true});
 await expect(dialog.getByRole('tab',{name:'Overview'})).toHaveAttribute('aria-selected','true');
 await expect(dialog.getByRole('link',{name:'Call',exact:true})).toHaveAttribute('href','tel:8175550100');
 await expect(dialog.getByRole('button',{name:'Create quote',exact:true})).toBeVisible();
 await expect(dialog.getByRole('region',{name:'Request photos'})).toHaveCount(0);
 await expect(dialog.getByLabel('Name',{exact:true})).toHaveCount(0);
 await page.screenshot({animations:'disabled',path:'test-results/lead-simple-mobile.png'});
 await page.setViewportSize({width:1366,height:900});
 await page.screenshot({animations:'disabled',path:'test-results/lead-simple-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await dialog.getByRole('tab',{name:'Details',exact:true}).click();
 await dialog.getByLabel('Request / notes').fill('Updated request with expired quote.');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const discard=page.getByRole('dialog',{name:'Discard changes?'});
 await expect(discard.getByRole('button',{name:'Keep editing'})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(dialog.getByLabel('Request / notes')).toHaveValue('Updated request with expired quote.');
 let failSave=true;
 const failOnce=async route=>{
  if(route.request().method()==='PATCH'&&failSave){failSave=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary test outage. Try again.'})});}
  else await route.continue();
 };
 await page.route(`**/api/crm/leads/${lead.id}`,failOnce);
 await dialog.getByRole('button',{name:'Save changes'}).click();
 await expect(page.getByRole('alert')).toContainText('Temporary test outage');
 await expect(dialog.getByLabel('Request / notes')).toHaveValue('Updated request with expired quote.');
 await dialog.getByRole('button',{name:'Save changes'}).click();
 await expect(dialog).toHaveCount(0);
 expect(app.sqlite.prepare('SELECT notes FROM crm_leads WHERE id=?').get(lead.id).notes).toBe('Updated request with expired quote.');
 expect(app.sqlite.prepare('SELECT status FROM quotes WHERE id=?').get(quote.id).status).toBe('sent');
 await page.goto(app.base+`/#/crm/leads?lead=${lead.id}`);
 await dialog.getByRole('tab',{name:'Activity',exact:true}).click();
 await dialog.getByLabel('Activity note').fill('Called to confirm measurements.');
 await dialog.getByRole('button',{name:'Log call',exact:true}).click();
 await expect(dialog.getByLabel('Activity note')).toHaveValue('');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.goto(app.base+`/#/crm/leads?lead=${lead.id}`);
 await dialog.getByLabel('Stage',{exact:true}).selectOption('won');
 const closing=page.getByRole('dialog',{name:`Mark "${lead.name}" won`,exact:true});
 await expect(closing.getByText(/The linked quote has expired/)).toBeVisible();
 await expect(closing.getByRole('button',{name:'Mark won',exact:true})).toBeDisabled();
 await expect(closing.getByRole('button',{name:`Create revision of ${quote.number}`})).toBeEnabled();
 expect(app.sqlite.prepare('SELECT COUNT(*) n FROM fin_invoices WHERE quote_id=?').get(quote.id).n).toBe(0);
 await closing.getByRole('button',{name:'Close',exact:true}).click();
 expect(errors).toEqual([]);
});

test('All quote statuses can be trashed and restored without deleting financial records',async({page})=>{
 const rows=[];
 for(const status of ['draft','sent','declined','accepted']){
  const lead=await makeLead('Trash fixture '+status),q=await makeQuote(lead);
  const shared=status!=='draft'?await app.api(`/api/quotes/${q.id}/share`,'POST',{},app.owner):null;
  if(status==='accepted')expect((await app.api(`/api/quotes/${q.id}/accept`,'POST',{},app.owner)).status).toBe(200);
  if(status==='declined')app.sqlite.prepare("UPDATE quotes SET status='declined' WHERE id=?").run(q.id);
  rows.push({...q,status,token:shared?.data.token});
 }
 const accepted=rows.at(-1),before=app.sqlite.prepare('SELECT * FROM fin_invoices WHERE quote_id=?').all(accepted.id);
 await page.goto(app.base+'/#/crm/quotes');await page.getByRole('button',{name:'Saved',exact:true}).click();
 await page.getByLabel('Search quotes',{exact:true}).fill('Trash fixture');
 for(const q of rows){
  const row=page.locator('.lines>.line').filter({has:page.getByText(q.number,{exact:true})});
  await row.getByRole('button',{name:'Delete',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:`Delete ${q.number}?`});
  await expect(dialog).toContainText('Linked jobs, invoices, and payments');
  await dialog.getByRole('button',{name:'Move to Trash'}).click();
  await expect(dialog).toHaveCount(0);await expect(row).toHaveCount(0);
  expect((await app.api(`/api/quotes/${q.id}`,'GET',undefined,app.owner)).status).toBe(404);
  if(q.token)expect((await app.api(`/api/public/quote/${q.token}`)).status).toBe(404);
 }
 expect(app.sqlite.prepare('SELECT * FROM fin_invoices WHERE quote_id=?').all(accepted.id)).toEqual(before);
 await page.getByRole('button',{name:'Trash',exact:true}).click();
 for(const q of rows){
  const row=page.locator('.lines>.line').filter({has:page.getByText(q.number,{exact:true})});
  await row.getByRole('button',{name:'Restore',exact:true}).click();await expect(row).toHaveCount(0);
  expect((await app.api(`/api/quotes/${q.id}`,'GET',undefined,app.owner)).data.status).toBe(q.status);
 }
 await page.getByRole('button',{name:'Active quotes'}).click();
 await expect(page.locator('.lines>.line')).toHaveCount(4);
 const worker=(await app.api('/api/users','POST',{name:'Trash permission fixture',pin:'5678',role:'worker'},app.owner)).data;
 const {createSession}=await import('../server/auth.ts');const token=createSession(worker.id,'worker',worker.name);
 for(const [url,method] of [[`/api/quotes/${accepted.id}`,'DELETE'],[`/api/quotes/${accepted.id}/restore`,'POST'],['/api/quotes?deleted=1','GET']])expect((await app.api(url,method,undefined,token)).status).toBe(403);
});

test('Shared popups fit small screens, retain drafts, and keep actions visible',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:360,height:640});
 for(const [route,button,title,action] of [
  ['/crm/leads','New lead','New lead','Create lead'],
  ['/crm/clients','New customer','New customer','Create customer'],
  ['/finance/expenses','Add expense','Add expense','Add expense'],
  ['/hr/employees','New employee','New employee','Add employee'],
 ]){
  await page.goto(app.base+'/#'+route);await page.getByRole('button',{name:button,exact:true}).first().click();
  const modal=page.getByRole('dialog',{name:title,exact:true});await expect(modal).toBeVisible();
  expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),title+' has no sideways scrolling').toBe(true);
  const body=modal.locator('.suite-form');expect(await body.locator('form').evaluate(el=>!['auto','scroll'].includes(getComputedStyle(el).overflowY)),title+' has only one scroll area').toBe(true);
  const box=await modal.getByRole('button',{name:action,exact:true}).boundingBox();expect(box.y+box.height,title+' action remains visible').toBeLessThanOrEqual(640);
  await page.screenshot({animations:'disabled',path:`test-results/popup-${title.replaceAll(' ','-').toLowerCase()}.png`});
  if(title==='New lead'){
   await modal.getByLabel('Name',{exact:true}).fill('Keep my draft');await page.keyboard.press('Escape');
   const discard=page.getByRole('dialog',{name:'Discard changes?'});await discard.getByRole('button',{name:'Keep editing'}).click();
   await expect(modal.getByLabel('Name',{exact:true})).toHaveValue('Keep my draft');
   await page.keyboard.press('Escape');await discard.getByRole('button',{name:'Discard changes',exact:true}).click();
  }else await modal.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:button,exact:true}).first()).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 }
 expect(errors).toEqual([]);
});
