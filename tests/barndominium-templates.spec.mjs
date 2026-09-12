import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
import {fresh} from '../client/src/quote/lib/barndominium/model.js';
import {duplicateSession} from '../client/src/quote/lib/store.js';
let app,token;
test.beforeAll(async()=>{app=await testApp({serve:true});const r=await app.api('/api/security/password','POST',{currentPassword:'1234',password:'Template fixture 2026'},app.owner);token=r.data.token;});
test.afterAll(async()=>app.close());

test('Templates validate designs and store no quote or customer fields',async()=>{
 const state={...fresh(),width:20,depth:25,openings:[],customer:{name:'Must not persist'},quoteId:55};
 expect((await app.api('/api/quotes/barndominium-templates','GET')).status).toBe(401);
 const created=await app.api('/api/quotes/barndominium-templates','POST',{name:'Shared shell',state,customer:{name:'Also excluded'},priceBookSnapshot:{secret:99}},token);
 expect(created.status).toBe(201);expect(created.data.state.customer).toBeUndefined();expect(created.data.state.quoteId).toBeUndefined();expect(created.data.customer).toBeUndefined();
 const stored=app.sqlite.prepare('SELECT state FROM barndominium_quote_templates WHERE id=?').get(created.data.id);expect(stored.state).not.toMatch(/Must not persist|secret|quoteId/);
 expect((await app.api('/api/quotes/barndominium-templates','POST',{name:'shared SHELL',state},token)).status).toBe(409);
 expect((await app.api('/api/quotes/barndominium-templates','POST',{name:'Invalid',state:{...fresh(),width:3}},token)).status).toBe(400);
 expect((await app.api('/api/quotes/barndominium-templates','POST',{name:' ',state},token)).status).toBe(400);
 const original={quoteId:4,number:'Q-4',sid:'original',type:'barndominium',state:fresh(),customer:{name:'Original'},overrides:{items:{cee:{rate:8}}}};
 const copied=duplicateSession(original,'copy');copied.state.openings[0].x=9;copied.overrides.items.cee.rate=10;
 expect(original.state.openings[0].x).toBe(7);expect(original.overrides.items.cee.rate).toBe(8);expect(copied.quoteId).toBeNull();expect(copied.customer.name).toBe('');
});

test('Save a design template, duplicate independently and reuse on another device',async({page,browser})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),token);
 await page.goto(app.base+'/#/crm/quotes');await page.getByRole('button',{name:'Barndominium templates',exact:true}).click();
 await page.getByRole('button',{name:'Use 20 × 25 shell',exact:true}).click();
 const editor=page.locator('.barndo');await expect(editor.locator('[data-key="width"]')).toHaveValue('20');await expect(editor.locator('[data-key="depth"]')).toHaveValue('25');
 await editor.locator('[data-key="depth"]').fill('26');await editor.locator('[data-key="depth"]').press('Tab');
 await page.getByRole('button',{name:'Save as template',exact:true}).click();await page.getByLabel('Template name').fill('Shop 20 × 26');await page.getByRole('button',{name:'Save template',exact:true}).click();
 await expect(page.getByLabel('Template name')).toHaveCount(0);
 await page.getByRole('button',{name:'Duplicate quote',exact:true}).click();await expect(page.getByText(/Copy of Q/)).toBeVisible();
 await expect.poll(()=>app.sqlite.prepare("SELECT count(*) AS n FROM quotes WHERE type='barndominium'").get().n).toBe(2);
 const rows=app.sqlite.prepare("SELECT * FROM quotes WHERE type='barndominium' ORDER BY id").all(),original=rows[0],copy=rows[1];expect(copy.number).not.toBe(original.number);
 await editor.locator('[data-key="width"]').fill('22');await editor.locator('[data-key="width"]').press('Tab');
 await expect.poll(()=>JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(copy.id).payload).state.width).toBe(22);
 const unchanged=app.sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(original.id);expect(unchanged.payload).toBe(original.payload);expect(unchanged.status).toBe(original.status);expect(unchanged.total_cents).toBe(original.total_cents);
 const context=await browser.newContext({viewport:{width:390,height:844}});try{
  await context.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),token);const second=await context.newPage();await second.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await second.goto(app.base+'/#/crm/quotes');await second.getByRole('button',{name:'Barndominium templates',exact:true}).click();await second.getByRole('button',{name:'Use Shop 20 × 26',exact:true}).click();
  await expect(second.locator('.barndo [data-key="width"]')).toHaveValue('20');await expect(second.locator('.barndo [data-key="depth"]')).toHaveValue('26');
  await expect.poll(()=>app.sqlite.prepare("SELECT count(*) AS n FROM quotes WHERE type='barndominium'").get().n).toBe(3);
  const reused=JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes ORDER BY id DESC LIMIT 1').get().payload);expect(reused.customer.name).toBe('');expect(reused.overrides).toEqual({});
  expect(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }finally{await context.close();}
});
