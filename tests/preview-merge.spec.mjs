import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>app.close());
async function fixture(title,count=1){
 const p=(await app.api('/api/customer-previews','POST',{title,customer:'Test customer'},app.owner)).data;
 const model=app.sqlite.prepare('SELECT bytes,size FROM customer_preview_models LIMIT 1').get();
 for(let i=0;i<count;i++)app.sqlite.prepare('INSERT INTO customer_preview_models(id,preview_id,label,position,bytes,size) VALUES(?,?,?,?,?,?)').run(crypto.randomBytes(16).toString('hex'),p.id,`Design ${i+1}`,i,model.bytes,model.size);
 return p;
}
test('Merge creates an independent draft, retries safely and rejects stale or excessive selections',async()=>{
 const a=await fixture('Merge A'),b=await fixture('Merge B');
 const body={requestId:crypto.randomUUID(),title:'Merged API',customer:'Test customer',sources:[a,b].map(p=>({id:p.id,version:p.version}))};
 expect((await app.api('/api/customer-previews/merge','POST',body)).status).toBe(401);
 const before=app.sqlite.prepare('SELECT COUNT(*) n FROM customer_previews').get().n;
 expect((await app.api('/api/customer-previews/merge','POST',{...body,sources:[body.sources[0],{id:b.id,version:999}]},app.owner)).status).toBe(409);
 expect(app.sqlite.prepare('SELECT COUNT(*) n FROM customer_previews').get().n).toBe(before);
 const r=await app.api('/api/customer-previews/merge','POST',body,app.owner);expect(r.status).toBe(201);
 expect(r.data.options).toHaveLength(2);expect(r.data.published).toBe(false);expect(r.data.description).toBe('');expect(r.data.feedback).toEqual([]);
 expect((await app.api('/api/customer-previews/merge','POST',body,app.owner)).data.id).toBe(r.data.id);
 expect((await app.api('/api/customer-previews/merge','POST',{...body,title:'Different'},app.owner)).status).toBe(409);
 const copy=app.sqlite.prepare('SELECT bytes FROM customer_preview_models WHERE preview_id=? ORDER BY position').all(r.data.id);
 expect(copy[0].bytes.equals(app.sqlite.prepare('SELECT bytes FROM customer_preview_models WHERE preview_id=?').get(a.id).bytes)).toBe(true);
 await app.api(`/api/customer-previews/${a.id}`,'DELETE',{version:a.version},app.owner);
 expect(app.sqlite.prepare('SELECT COUNT(*) n FROM customer_preview_models WHERE preview_id=?').get(r.data.id).n).toBe(2);
 expect((await app.api('/api/customer-previews/merge','POST',{...body,requestId:crypto.randomUUID()},app.owner)).status).toBe(404);
 const c=await fixture('Many options',6);
 expect((await app.api('/api/customer-previews/merge','POST',{...body,requestId:crypto.randomUUID(),sources:[b,c].map(p=>({id:p.id,version:p.version}))},app.owner)).status).toBe(400);
});
test('Select cards and create one combined customer preview',async({page})=>{
 await fixture('Carport option A');await fixture('Carport option B');
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.goto(app.base+'/#/crm/previews');
 await page.getByRole('checkbox',{name:'Select Carport option A for merge'}).check();
 await page.getByRole('checkbox',{name:'Select Carport option B for merge'}).check();
 await page.getByRole('button',{name:'Merge selected (2)'}).click();
 const modal=page.getByRole('dialog');
 await modal.getByLabel('Combined preview title').fill('Carport alternatives');
 await modal.getByRole('button',{name:'Create combined preview'}).click();
 await expect(page.getByRole('dialog').getByLabel('Project title',{exact:true})).toHaveValue('Carport alternatives');
 await expect(page.getByRole('button',{name:'Enable customer link',exact:true})).toBeEnabled();
 const saved=(await app.api('/api/customer-previews','GET',undefined,app.owner)).data.find(p=>p.title==='Carport alternatives');
 expect(saved.options).toHaveLength(2);expect(saved.customer).toBe('Test customer');expect(saved.published).toBe(false);
 await page.screenshot({path:'test-results/merged-customer-preview.png',fullPage:true});
});
