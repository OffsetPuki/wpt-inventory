import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
import {defaultState} from '../client/src/quote/data/configurators.js';
import {DEFAULT_PRICE_BOOK} from '../client/src/quote/data/priceBook.js';
let app,token;
test.beforeAll(async()=>{app=await testApp({serve:true});token=(await app.api('/api/security/password','POST',{currentPassword:'1234',password:'Recovery fixture 2026'},app.owner)).data.token;});
test.afterAll(async()=>app.close());

for(const kind of ['missing','deleted'])test(`Start a fresh quote directly with a ${kind} old draft`,async({page})=>{
 const sid=crypto.randomUUID();
 const payload={sid,type:'table',state:defaultState('table'),customer:{name:'Old customer'},notes:'Old measurements',priceBookSnapshot:DEFAULT_PRICE_BOOK};
 const original=await app.api('/api/quotes','POST',{type:'table',payload,totalCents:10000},token);
 expect(original.status).toBe(201);
 const oldId=original.data.id;
 if(kind==='missing')app.sqlite.prepare('DELETE FROM quotes WHERE id=?').run(oldId);
 else expect((await app.api(`/api/quotes/${oldId}`,'DELETE',undefined,token)).status).toBe(204);
 const before=app.sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(oldId);
 const session={...payload,quoteId:oldId,number:original.data.number,version:1,quoteStatus:'draft'};
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(({token,session})=>{
  localStorage.setItem('wpt-auth-token',token);
  if(!localStorage.getItem('cjm.session.v2.user.1'))localStorage.setItem('cjm.session.v2.user.1',JSON.stringify(session));
 },{token,session});
 await page.goto(app.base+'/#/crm/quotes');
 await expect(page.getByRole('heading',{name:'New quote',exact:true})).toBeVisible();
 await expect(page.locator('[data-draft-recovery]')).toBeVisible();
 await page.getByLabel('Customer name',{exact:true}).fill('Fresh customer '+kind);
 await page.locator('.type-card').filter({has:page.getByRole('heading',{name:'Carport',exact:true})}).click();
 await expect(page.locator('[data-draft-recovery]')).toHaveCount(0);
 await expect(page.locator('.draft-status')).toContainText('Saved');
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('cjm.session.v2.user.1')));
 expect(stored.sid).not.toBe(sid);
 expect(stored.quoteId).not.toBe(oldId);
 expect(stored.type).toBe('carport');
 expect(stored.customer.name).toBe('Fresh customer '+kind);
 expect(stored.notes).not.toBe(payload.notes);
 const backup=await page.evaluate(sid=>JSON.parse(localStorage.getItem('cjm.session.v2.user.1.recovery.'+sid)),sid);
 expect(backup.notes).toBe(payload.notes);
 expect(app.sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(oldId)).toEqual(before);
 await page.getByRole('button',{name:'Review quote',exact:false}).click();
 await expect(page.locator('.quote-review')).toBeVisible();
 await page.reload();
 await expect(page.getByRole('heading',{name:'New quote',exact:true})).toBeVisible();
 await expect(page.locator('[data-draft-recovery]')).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('cjm.session.v2.user.1')).sid)).toBe(stored.sid);
});

for(const kind of ['missing','deleted','conflict'])test(`Recover ${kind} draft from the starting screen without losing edits`,async({page})=>{
 const sid=crypto.randomUUID();
 const source={sid,type:'table',state:defaultState('table'),customer:{name:'Recovery customer '+kind,email:'recovery@example.test'},notes:'Keep these measurements',overrides:{items:{custom_work:{custom:true,name:'Custom work',kind:'flat',qty:1,rate:123}}},priceBookSnapshot:{...(kind==='missing'?{}:DEFAULT_PRICE_BOOK),materialMarkupPct:37},priceBookSnapshotAt:'2026-08-01T12:00:00Z'};
 const original=await app.api('/api/quotes','POST',{type:'table',customerName:source.customer.name,payload:source,totalCents:12300},token);
 expect(original.status).toBe(201);
 const oldId=original.data.id;
 if(kind==='missing')app.sqlite.prepare('DELETE FROM quotes WHERE id=?').run(oldId);
 else if(kind==='deleted')expect((await app.api(`/api/quotes/${oldId}`,'DELETE',undefined,token)).status).toBe(204);
 else app.sqlite.prepare('UPDATE quotes SET version=version+1 WHERE id=?').run(oldId);
 const before=app.sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(oldId);
 const session={...source,quoteId:oldId,number:original.data.number,version:1,quoteStatus:'draft',quotePolicy:{issuedAt:'old'},revisionOf:oldId,alternativeOf:oldId};
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(({token,session})=>{localStorage.setItem('wpt-auth-token',token);localStorage.setItem('cjm.session.v2.user.1',JSON.stringify(session));},{token,session});
 await page.goto(app.base+'/#/crm/quotes');
 await expect(page.getByRole('heading',{name:'New quote',exact:true})).toBeVisible();
 const recovery=page.locator('[data-draft-recovery]');
 await expect(recovery).toBeVisible();
 await recovery.getByRole('button',{name:'Keep edits as new quote',exact:true}).click();
 await expect(recovery).toHaveCount(0);
 await expect(page.locator('.draft-status')).toContainText('Saved');
 const row=app.sqlite.prepare('SELECT * FROM quotes WHERE draft_key LIKE ?').all('%').find(r=>JSON.parse(r.payload).sid!==sid&&JSON.parse(r.payload).customer?.name==='Recovery customer '+kind&&r.id!==oldId);
 expect(row).toBeTruthy();
 if(kind!=='missing')expect(row.number).not.toBe(original.data.number);
 const saved=JSON.parse(row.payload);
 expect(saved.customer).toEqual(source.customer);expect(saved.notes).toBe(source.notes);
 expect(saved.overrides).toEqual(source.overrides);expect(saved.state).toEqual(source.state);
 expect(saved.priceBookSnapshot.materialMarkupPct).toBe(37);
 expect(saved.quotePolicy).toBeUndefined();expect(saved.revisionOf).toBeUndefined();expect(saved.alternativeOf).toBeUndefined();
 expect(app.sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(oldId)).toEqual(before);
 await page.getByRole('button',{name:'Review quote',exact:false}).click();
 await expect(page.locator('.quote-review')).toBeVisible();
 await page.getByRole('button',{name:'New quote',exact:true}).click();
 await page.locator('.type-card').filter({has:page.getByRole('heading',{name:'Carport',exact:true})}).click();
 await expect(page.locator('.draft-status')).toContainText('Saved');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});



