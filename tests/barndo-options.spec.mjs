import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
import {testApp} from '../scripts/test-app.mjs';
import {fresh} from '../client/src/quote/lib/barndominium/model.js';
import {purchasing,SCOPE,cleanBarndoQuote,compareBarndo,scopeIssues} from '../client/src/quote/lib/barndoQuote.js';
import {deriveItems,buildLineState} from '../client/src/quote/lib/estimate.js';
import {computeTotals} from '../client/src/quote/lib/quote.js';
import {DEFAULT_PRICE_BOOK} from '../client/src/quote/data/priceBook.js';
let app,token;
const purchase={columnStock:24,rafterStock:24,ceeStock:20,zeeStock:20,lap:1,kerf:.125,roofCover:3,wallCover:3,roofRoll:100,wallRoll:100,waste:10};
test.beforeAll(async()=>{app=await testApp({serve:true});const r=await app.api('/api/security/password','POST',{currentPassword:'1234',password:'Options fixture 2026'},app.owner);token=r.data.token;});
test.afterAll(async()=>app.close());
async function create(name='Options customer',rate=5,lang='en'){
 const state={...fresh(),width:20,depth:25,openings:[],roofInsulation:'fiberglass'},book={...DEFAULT_PRICE_BOOK,minJobCharge:0};
 const overrides={items:Object.fromEntries(deriveItems('barndominium',state,book).items.map(i=>[i.key,{rate}])),barndoQuote:{scopeEnabled:true,scope:Object.fromEntries(SCOPE.map(([k])=>[k,{status:'excluded',note:''}])),specs:{cee:rate===5?'8 in CEE, 14 gauge':'8 in CEE, 16 gauge'},purchase}};
 const s={sid:crypto.randomUUID(),type:'barndominium',state,overrides,priceBookSnapshot:book,customer:{name,email:name.replaceAll(' ','').toLowerCase()+'@example.test',location:'Arlington',preferredLanguage:lang},materialMarkupPct:20,laborMarkupPct:20,taxPct:0,depositPct:25};
 const totalCents=Math.round(computeTotals(buildLineState('barndominium',state,book,overrides),{...s,minJobCharge:0}).total*100);
 const r=await app.api('/api/quotes','POST',{type:'barndominium',payload:s,customerName:name,totalCents},token);expect(r.status).toBe(201);return r.data;
}
const body=(a,b)=>({options:[{id:a.id,version:a.version,title:'Recommended material',explanation:'14 gauge CEE as proposed for this job.'},{id:b.id,version:b.version,title:'Thinner material alternative',explanation:'16 gauge CEE alternative; review suitability before approval.'}],recommendedId:a.id});

test('Purchasing uses whole stock, panels and rolls and preserves net pricing',()=>{
 const s={...fresh(),width:20,depth:25,openings:[],roofInsulation:'fiberglass'},q={purchase};
 const p=purchasing(s,q);expect(p.issues).toEqual([]);
 expect(p.rows.find(r=>r.key==='building-columns').qty).toBe(7); // 6 columns; kerf prevents two exact 12ft cuts from 24ft.
 expect(p.rows.find(r=>r.key==='building-cee').qty).toBe(18); // 8 runs × two lapped pieces + 10%.
 expect(p.rows.find(r=>r.key==='building-roof').qty).toBe(20); // two slopes × 9 panels + 10%.
 expect(p.rows.find(r=>r.key==='building-roof-insulation').qty).toBe(6);
 expect(purchasing(s,{purchase:{...purchase,rafterStock:5}}).issues.join()).toContain('structural splices');
 expect(purchasing(s,{purchase:{...purchase,lap:10,ceeStock:10}}).issues.join()).toContain('end lap');
 expect(purchasing(s,{}).rows).toEqual([]);
 expect(()=>cleanBarndoQuote({purchase:{waste:-1}})).toThrow();
 expect(buildLineState('barndominium',s,DEFAULT_PRICE_BOOK,{barndoQuote:q})).toEqual(buildLineState('barndominium',s,DEFAULT_PRICE_BOOK,{}));
 const left={state:{...s,porches:[{id:'p',wall:'front',width:12,depth:6,x:0,height:10,pitch:2}]}},right=structuredClone(left);right.state.porches[0].depth=8;
 expect(compareBarndo(left,right).find(r=>r.label==='Porches')).toMatchObject({changed:true});expect(compareBarndo(left,right).find(r=>r.label==='Porches').b).toContain('12×8 ft');
 expect(scopeIssues({type:'barndominium',overrides:{barndoQuote:{scopeEnabled:true,scope:{delivery:{status:'excluded'}}}}},{lines:{delivery:{total:100}}}).join()).toContain('Delivery is excluded but has a charge');
});

test('Options are reviewed, issued together, private, idempotent and mutually exclusive',async({page})=>{
 const a=await create(),b=await create('Options customer',3),foreign=await create('Other customer');
 expect((await app.api('/api/quote-options/preview','POST',body(a,b))).status).toBe(401);
 expect((await app.api('/api/quote-options/preview','POST',body(a,foreign),token)).status).toBe(400);
 const stale=body(a,b);stale.options[1].version=0;expect((await app.api('/api/quote-options/preview','POST',stale,token)).status).toBe(400);
 const preview=await app.api('/api/quote-options/preview','POST',body(a,b),token);expect(preview.status).toBe(200);expect(preview.data.issues).toEqual([]);expect(preview.data.differences.some(r=>r.label==='CEE roof purlins'&&r.changed)).toBe(true);
 expect(JSON.stringify(preview.data)).not.toContain('priceBookSnapshot');
 const args={...body(a,b),materialReviewed:true,requestKey:crypto.randomUUID()};
 expect((await app.api('/api/quote-options/share','POST',{...args,materialReviewed:false},token)).status).toBe(400);
 const sent=await app.api('/api/quote-options/share','POST',args,token);expect(sent.status).toBe(200);expect((await app.api('/api/quote-options/share','POST',args,token)).data.url).toBe(sent.data.url);
 expect(app.sqlite.prepare('SELECT count(*) n FROM quote_option_sets').get().n).toBe(1);
 const leadIds=app.sqlite.prepare('SELECT lead_id FROM quotes WHERE id IN (?,?)').all(a.id,b.id);expect(leadIds[0].lead_id).toBeTruthy();expect(leadIds[0].lead_id).toBe(leadIds[1].lead_id);
 for(const q of [a,b])expect((await app.api(`/api/quotes/${q.id}`,'GET',undefined,token)).data.status).toBe('sent');
 expect((await app.api(`/api/quotes/${a.id}`,'PATCH',{version:1,payload:JSON.parse(a.payload)},token)).status).toBe(409);
 const pub=await app.api(new URL(sent.data.url).pathname);expect(pub.headers.get('x-robots-tag')).toContain('noindex');expect(pub.data).toContain('14 gauge');expect(pub.data).not.toContain('priceBookSnapshot');
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto(app.base+new URL(sent.data.url).pathname);await expect(page.getByRole('heading',{name:'Options for your project'})).toBeVisible();await expect(page.locator('svg')).toHaveCount(2);expect(await page.locator('svg').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(100);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:'test-results/customer-quote-options-mobile.png',fullPage:true});
 const buy=await app.api(`/api/quotes/buy-list?ids=${a.id}`,'GET',undefined,token);expect(buy.data.combined.some(r=>r.unit==='pieces'&&r.name.includes('14 gauge'))).toBe(true);
 expect((await app.api(`/api/quotes/buy-list?ids=${a.id},${b.id}`,'GET',undefined,token)).status).toBe(400);
 const tokens=[a,b].map(q=>app.sqlite.prepare('SELECT share_token token FROM quotes WHERE id=?').get(q.id).token);
 const doc=await app.api(`/api/public/quote/${tokens[0]}`);expect(doc.data.quote.options.position).toBe(1);expect(doc.data.quote.doc.specs.some(r=>r.value.includes('14 gauge'))).toBe(true);
 const accept=await app.api(`/api/public/quote/${tokens[1]}/accept`,'POST',{});expect(accept.status).toBe(200);
 expect((await app.api(`/api/public/quote/${tokens[0]}/accept`,'POST',{})).status).toBe(409);
 expect((await app.api(`/api/public/quote/${tokens[1]}/accept`,'POST',{})).data.alreadyAccepted).toBe(true);
 expect(app.sqlite.prepare('SELECT count(*) n FROM projects WHERE quote_id IN (?,?)').get(a.id,b.id).n).toBe(1);expect(app.sqlite.prepare('SELECT count(*) n FROM fin_invoices WHERE quote_id IN (?,?)').get(a.id,b.id).n).toBe(1);
});

test('Scope conflicts block sharing; Spanish option email uses one idempotent delivery',async()=>{
 const a=await create('Spanish customer',5,'es'),b=await create('Spanish customer',3,'es');
 const session=JSON.parse(a.payload);session.overrides.barndoQuote.scope.installation.status='review';
 const changed=await app.api(`/api/quotes/${a.id}`,'PATCH',{version:a.version,payload:session},token);expect(changed.status).toBe(200);
 const blocked=await app.api(`/api/quotes/${a.id}/share`,'POST',{version:changed.data.version},token);expect(blocked.status).toBe(400);
 session.overrides.barndoQuote.scope.installation.status='excluded';const fixed=await app.api(`/api/quotes/${a.id}`,'PATCH',{version:changed.data.version,payload:session},token);expect(fixed.status).toBe(200);
 const oldFetch=globalThis.fetch,messages=[];globalThis.fetch=async(url,init)=>new URL(String(url)).hostname==='api.resend.com'?(messages.push(JSON.parse(init.body)),new Response(JSON.stringify({id:'fake-options-mail'}),{status:200,headers:{'Content-Type':'application/json'}})):oldFetch(url,init);
 process.env.RESEND_API_KEY='test-only';process.env.MAIL_FROM='suite@example.test';
 try{const args={...body(fixed.data,b),requestKey:crypto.randomUUID(),materialReviewed:true,sendEmail:true};const sent=await app.api('/api/quote-options/share','POST',args,token);expect(sent.status).toBe(200);expect(sent.data.emailed).toBe(true);expect((await app.api('/api/quote-options/share','POST',args,token)).data.emailed).toBe(true);expect(messages.length).toBe(1);expect(messages[0].text).toContain('Opción 1');expect(messages[0].text).toContain('Opción 2');expect(messages[0].text).toContain(a.number);expect(messages[0].text).toContain(b.number);const pub=await app.api(new URL(sent.data.url).pathname);expect(pub.data).toContain('Opciones para su proyecto');}
 finally{globalThis.fetch=oldFetch;process.env.RESEND_API_KEY='';process.env.MAIL_FROM='';}
});

test('Suite creates a same-customer alternative, edits specifications and sends a comparison',async({page})=>{
 const a=await create('Browser customer');
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),token);
 await page.goto(app.base+'/#/crm/quotes');await page.getByRole('button',{name:'Saved',exact:true}).click();
 const row=page.locator('.line').filter({has:page.locator('.sq-number',{hasText:a.number})});await row.getByRole('button',{name:'Edit draft',exact:true}).click();
 await page.getByRole('button',{name:'Create alternative for this customer'}).click();await expect(page.getByText(`Copy of ${a.number}. The original quote is unchanged.`)).toBeVisible();
 await page.getByText('Material specifications',{exact:false}).first().click();await page.getByLabel('CEE roof purlins',{exact:true}).fill('8 in CEE, 16 gauge');
 await page.getByRole('button',{name:'Compare & send options',exact:true}).click();
 await page.getByLabel('Option 1 explanation for the customer').fill('Recommended 14 gauge purlins.');await page.getByLabel('Option 2 explanation for the customer').fill('Alternative uses 16 gauge purlins.');
 await page.getByRole('button',{name:'Review both quotes',exact:true}).click();await expect(page.locator('td').filter({hasText:'8 in CEE, 16 gauge'})).toBeVisible();
 await page.getByRole('checkbox',{name:/I reviewed both prices/}).check();await page.getByRole('button',{name:'Create customer options link'}).click();await expect(page.getByRole('heading',{name:'Both options issued'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:'test-results/suite-quote-options-mobile.png',fullPage:true});
});
