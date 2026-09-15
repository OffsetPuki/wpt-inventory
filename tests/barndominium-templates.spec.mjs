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

test('Save Quote finishes for a restored draft normalized by the server',async({page})=>{
 const session={sid:'normalized-save-regression',type:'barndominium',state:fresh(),customer:{name:'Save regression'},overrides:{barndoQuote:{specs:{cee:'8 inch CEE'}}}};
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(({token,session})=>{localStorage.setItem('wpt-auth-token',token);localStorage.setItem('cjm.session.v2.user.1',JSON.stringify(session));},{token,session});
 let writes=0;page.on('request',r=>{if(/\/api\/quotes(?:\/\d+)?$/.test(r.url())&&['POST','PATCH'].includes(r.method()))writes++;});
 await page.goto(app.base+'/#/crm/quotes');
 await page.getByRole('button',{name:/Continue draft/}).click();
 const save=page.getByRole('button',{name:'Save Quote',exact:true});
 await save.click();await expect(page.getByText('Quote saved',{exact:true})).toBeVisible();
 await expect(save).toBeEnabled();
 const count=writes;await save.click();await expect(save).toBeEnabled();expect(writes).toBe(count);
 expect(writes).toBeLessThanOrEqual(2);
 const stored=app.sqlite.prepare("SELECT payload FROM quotes WHERE customer_name='Save regression'").get();
 expect(JSON.parse(stored.payload).state.width).toBe(session.state.width);
});

test('Save Quote persists edits and Duplicate recovers a conflicting draft without changing its source',async({page})=>{
 const initialCount=app.sqlite.prepare("SELECT count(*) n FROM quotes WHERE type='barndominium'").get().n;
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),token);
 await page.goto(app.base+'/#/crm/quotes');
 await expect(page.getByRole('button',{name:'Barndominium templates',exact:true})).toHaveCount(0);
 await page.locator('.type-card').filter({has:page.getByRole('heading',{name:'Barndominium',exact:true})}).click();
 await expect(page.getByRole('button',{name:'Save as template',exact:true})).toHaveCount(0);
 const editor=page.locator('.barndo');
 await editor.locator('[data-key="depth"]').fill('48');await editor.locator('[data-key="depth"]').press('Tab');
 await page.getByRole('button',{name:'Save Quote',exact:true}).click();await expect(page.getByText('Quote saved',{exact:true})).toBeVisible();
 const original=app.sqlite.prepare("SELECT * FROM quotes WHERE type='barndominium' ORDER BY id DESC LIMIT 1").get();expect(JSON.parse(original.payload).state.depth).toBe(48);
 await page.route(`**/api/quotes/${original.id}`,r=>r.request().method()==='PATCH'?r.fulfill({status:409,json:{message:'Changed on another device'}}):r.continue());
 await editor.locator('[data-key="depth"]').fill('52');await editor.locator('[data-key="depth"]').press('Tab');
 await page.getByRole('button',{name:'Save Quote',exact:true}).click();await expect(page.getByText('This quote has changed elsewhere',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Duplicate quote',exact:true}).click();await expect(page.getByText('Quote duplicated',{exact:true})).toBeVisible();
 const copy=app.sqlite.prepare("SELECT * FROM quotes WHERE type='barndominium' ORDER BY id DESC LIMIT 1").get();expect(copy.id).not.toBe(original.id);expect(copy.number).not.toBe(original.number);expect(JSON.parse(copy.payload).state.depth).toBe(52);
 expect(app.sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(original.id).payload).toBe(original.payload);
 await page.getByRole('button',{name:'Saved',exact:true}).click();
 const row=page.locator('.saved-quotes .line-row').filter({hasText:original.number});
 const duplicate=page.getByRole('button',{name:'Duplicate',exact:true});
 await duplicate.last().click();await expect(page.locator('.barndo')).toBeVisible();
 await expect.poll(()=>app.sqlite.prepare("SELECT count(*) n FROM quotes WHERE type='barndominium'").get().n).toBe(initialCount+3);
 await expect(page.getByRole('button',{name:'Save Quote',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
