import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{test.setTimeout(180000);app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>app?.close());
test.beforeEach(async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
});
const create=async(url,body)=>{const r=await app.api(url,'POST',body,app.owner);expect(r.status).toBe(201);return r.data;};
const expense=()=>create('/api/finance/expenses',{date:'2026-10-12',vendor:'Record audit supplies',category:'materials',amountCents:2500,paymentMethod:'cash',notes:'Original notes'});

test('Reopening a record link fetches current data and never reopens a deleted record',async({page})=>{
 const row=await expense(),url=app.base+`/#/finance/expenses?expense=${row.id}`;
 await page.goto(url);const modal=page.getByRole('dialog',{name:'Edit expense',exact:true});
 await expect(modal.getByLabel('Notes (optional)')).toHaveValue('Original notes');await modal.getByRole('button',{name:'Close',exact:true}).click();
 expect((await app.api(`/api/finance/expenses/${row.id}`,'PATCH',{notes:'Updated by another session'},app.owner)).status).toBe(200);
 await page.goto(url);await expect(modal.getByLabel('Notes (optional)')).toHaveValue('Updated by another session');
 await modal.getByRole('button',{name:'Close',exact:true}).click();
 expect((await app.api(`/api/finance/expenses/${row.id}`,'DELETE',undefined,app.owner)).status).toBeLessThan(300);
 await page.goto(url);await expect(page.getByRole('alert')).toContainText('Record unavailable');await expect(modal).toHaveCount(0);
 await page.getByRole('button',{name:'Back to list',exact:true}).click();expect(page.url()).not.toContain('expense=');
});

test('Failed record links offer retry and malformed links have a clear exit',async({page})=>{
 const row=await expense();let unavailable=true;
 await page.route(`**/api/finance/expenses/${row.id}`,r=>unavailable?r.fulfill({status:503,contentType:'application/json',body:'{"message":"Temporary outage"}'}):r.continue());
 await page.goto(app.base+`/#/finance/expenses?expense=${row.id}`);
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();unavailable=false;
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('dialog',{name:'Edit expense'})).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.goto(app.base+'/#/finance/expenses?expense=wrong');
 await expect(page.getByRole('alert')).toContainText('Invalid record link');await page.getByRole('button',{name:'Back to list'}).click();
});

test('Customer details recover from errors; logged notes close without false discard warnings',async({page})=>{
 const client=await create('/api/crm/clients',{name:'Customer audit fixture'});let unavailable=true;
 await page.route(`**/api/crm/clients/${client.id}/detail`,r=>unavailable?r.fulfill({status:503,contentType:'application/json',body:'{"message":"Temporary customer outage"}'}):r.continue());
 await page.goto(app.base+`/#/crm/clients?client=${client.id}`);
 const modal=page.getByRole('dialog');await expect(modal.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
 const retry=modal.getByRole('button',{name:'Retry',exact:true});
 // Keep the outage active until the initial live-data refresh has settled.
 await retry.click({trial:true});unavailable=false;await retry.click();
 await expect(modal.getByRole('heading',{name:client.name,exact:true})).toBeVisible();
 await modal.getByPlaceholder('Add a note…').fill('Confirmed delivery date.');await modal.getByRole('button',{name:'Log note',exact:true}).click();
 await expect(modal.getByPlaceholder('Add a note…')).toHaveValue('');await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
});

test('An in-flight expense save protects fields and closing until its response arrives',async({page})=>{
 const row=await expense();await page.goto(app.base+`/#/finance/expenses?expense=${row.id}`);
 const modal=page.getByRole('dialog',{name:'Edit expense'});await modal.getByLabel('Vendor',{exact:true}).fill('Saved vendor');
 let release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route(`**/api/finance/expenses/${row.id}`,async r=>{if(r.request().method()==='PATCH'){const response=await r.fetch();await gate;await r.fulfill({response});}else await r.continue();});
 try {
  await modal.getByRole('button',{name:'Save changes'}).click();await expect(modal.getByLabel('Vendor',{exact:true})).toBeDisabled();
  await expect(modal.getByRole('button',{name:'Close',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(modal).toBeVisible();
  await page.keyboard.press('Tab');expect(await modal.evaluate(dialog=>dialog.contains(document.activeElement))).toBe(true);
 }finally{release();}
 await expect(modal).toHaveCount(0);
 expect((await app.api(`/api/finance/expenses/${row.id}`,'GET',undefined,app.owner)).data.vendor).toBe('Saved vendor');
});

test('Task deletion requires a clear confirmation and Cancel keeps the task',async({page})=>{
 const task=await create('/api/pm/tasks',{title:'Task deletion audit'});
 await page.goto(app.base+`/#/pm/board?task=${task.id}`);const modal=page.getByRole('dialog',{name:'Edit task'});
 await modal.getByRole('button',{name:'Delete',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Delete task?',exact:true});
 await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'Cancel'}).click();
 expect(app.sqlite.prepare('SELECT deleted_at FROM pm_tasks WHERE id=?').get(task.id).deleted_at).toBeNull();
 await modal.getByRole('button',{name:'Delete',exact:true}).click();await confirm.getByRole('button',{name:'Delete task',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(app.sqlite.prepare('SELECT deleted_at FROM pm_tasks WHERE id=?').get(task.id).deleted_at).toBeTruthy();
});

test('Opening a record creates no false draft; real edits recover and discard to current data',async({page})=>{
 const row=await expense(),url=app.base+`/#/finance/expenses?expense=${row.id}`,key=`suite-dialog:1:ExpenseFormModal:${row.id}`;
 await page.goto(url);const modal=page.getByRole('dialog',{name:'Edit expense'});
 await expect(modal.getByLabel('Notes (optional)')).toHaveValue('Original notes');
 expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBeNull();
 await modal.getByLabel('Notes (optional)').fill('My unfinished edits');await modal.getByRole('button',{name:'Close',exact:true}).click();
 expect((await app.api(`/api/finance/expenses/${row.id}`,'PATCH',{notes:'New server notes'},app.owner)).status).toBe(200);
 await page.goto(url);await expect(modal.getByLabel('Notes (optional)')).toHaveValue('My unfinished edits');
 await modal.getByRole('button',{name:'Discard recovered edits'}).click();await expect(modal.getByLabel('Notes (optional)')).toHaveValue('New server notes');
 await modal.getByLabel('Notes (optional)').fill('Reviewed current notes');await modal.getByRole('button',{name:'Save changes'}).click();await expect(modal).toHaveCount(0);
 expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBeNull();
 expect((await app.api(`/api/finance/expenses/${row.id}`,'GET',undefined,app.owner)).data.notes).toBe('Reviewed current notes');
});
