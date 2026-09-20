import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
const app=await testApp();
const {api,owner,sqlite}=app;
try{
 const path='/api/quotes/settings';
 const current=(await api(path,'GET',undefined,owner)).data;
 const changed=await api(path,'PUT',{...current,shop:{...current.shop,name:'Versioned shop'}},owner);
 assert.equal(changed.status,200,JSON.stringify(changed.data));
 assert.equal((await api(path,'PUT',{...current,shop:{name:'Stale shop'}},owner)).status,409);
 assert.equal((await api(path,'GET',undefined,owner)).data.shop.name,'Versioned shop');
 const job=(await api('/api/projects','POST',{jobNumber:'AUDIT-FIX',name:'Audit test'},owner)).data;
 sqlite.prepare("UPDATE projects SET site='concrete' WHERE id=?").run(job.id);
 const invoice=sqlite.prepare("INSERT INTO fin_invoices(number,project_id,status,subtotal_cents,tax_cents,total_cents,paid_cents) VALUES('AUDIT-TAX',?,'partial',10000,825,10825,5000)").run(job.id).lastInsertRowid;
 sqlite.prepare("INSERT INTO fin_invoice_payments(invoice_id,amount_cents,paid_at,created_at) VALUES(?,5000,'2026-09-15',?)").run(invoice,Date.now());
 sqlite.prepare("INSERT INTO fin_expenses(date,vendor,amount_cents,project_id,created_at) VALUES('2026-09-15','Materials',2000,?,?)").run(job.id,Date.now());
 const margin=(await api(`/api/finance/projects/${job.id}/summary`,'GET',undefined,owner)).data;
 assert.equal(margin.totals.revenueCents,10000);
 const report=(await api('/api/business-report?site=concrete&from=2026-09-01&to=2026-09-30','GET',undefined,owner)).data;
 assert.equal(report.paidCents,5000);assert.equal(report.expensesCents,2000);assert.equal(report.cashDifferenceCents,3000);assert.equal(report.outstandingCents,5825);
 assert.equal((await api('/api/business-report?site=insulation&from=2026-09-01&to=2026-09-30','GET',undefined,owner)).data.rows.length,0);
 assert.equal((await api('/api/business-report?from=invalid','GET',undefined,owner)).status,400);
 assert.equal((await api('/api/business-report')).status,401);

 const made=await api('/api/quotes','POST',{type:'custom',customerName:'Project test',totalCents:10000,payload:{type:'custom',business:'concrete',state:{width:30},customer:{name:'Project test'}}},owner);
 assert.equal(made.status,201);const q=made.data;
 const bytes=fs.readFileSync(new URL('../server/preview-seeds/kalkat-5.glb',import.meta.url));
 const metadata={title:'Private design',quoteId:q.id,sourceQuoteVersion:q.version,width:'30 ft'};
 async function upload(path,details,extra={}){const form=new FormData();form.append('model',new Blob([bytes]),'model.glb');form.append('details',JSON.stringify(details));form.append('requestId',crypto.randomUUID());for(const [k,v] of Object.entries(extra))form.append(k,String(v));const r=await fetch(app.base+path,{method:'POST',headers:{'X-Auth':owner},body:form});return {status:r.status,data:await r.json()};}
 let preview=(await upload('/api/customer-previews/from-model',metadata)).data;
 assert.equal(preview.options[0].sourceStatus,'current');
 preview=(await api(`/api/customer-previews/${preview.id}/sharing`,'POST',{version:preview.version,published:true},owner)).data;
 const modelId=preview.options[0].id;
 sqlite.prepare("UPDATE quotes SET version=version+1,payload=json_set(payload,'$.state.width',40) WHERE id=?").run(q.id);
 preview=(await api(`/api/customer-previews/${preview.id}`,'GET',undefined,owner)).data;assert.equal(preview.options[0].sourceStatus,'outdated');
 const staleModel=await upload(`/api/customer-previews/${preview.id}/refresh-from-quote`,metadata,{version:preview.version,sourceQuoteVersion:q.version,optionId:modelId});assert.equal(staleModel.status,409,JSON.stringify(staleModel.data));
 let staged=await upload(`/api/customer-previews/${preview.id}/refresh-from-quote`,{...metadata,width:'40 ft'},{version:preview.version,sourceQuoteVersion:q.version+1,optionId:modelId});assert.equal(staged.status,200,JSON.stringify(staged.data));preview=staged.data;assert.equal(preview.width,'30 ft');
 preview=(await api(`/api/customer-previews/${preview.id}/publish-models`,'POST',{version:preview.version},owner)).data;assert.equal(preview.width,'40 ft');assert.equal(preview.options[0].sourceStatus,'current');
 const shared=await api(`/api/quotes/${q.id}/share`,'POST',{version:q.version+1},owner);assert.equal(shared.status,200,JSON.stringify(shared.data));assert.ok(shared.data.projectUrl);
 const portal=await fetch(app.base+new URL(shared.data.projectUrl).pathname);assert.equal(portal.status,200);const html=await portal.text();assert.ok(html.includes('Private design'));assert.ok(html.includes('CJM Concrete'));assert.ok(!html.includes('source_signature'));assert.equal(portal.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.equal((await fetch(app.base+'/customer-project/unknown')).status,404);
 sqlite.prepare("UPDATE quotes SET deleted_at=? WHERE id=?").run(Date.now(),q.id);assert.equal((await fetch(app.base+new URL(shared.data.projectUrl).pathname)).status,404);

 const {defaultState}=await import('../client/src/quote/data/configurators.js');
 const {DEFAULT_PRICE_BOOK}=await import('../client/src/quote/data/priceBook.js');
 const {buildLineState}=await import('../client/src/quote/lib/estimate.js');
 const {computeTotals}=await import('../client/src/quote/lib/quote.js');
 const lines={items:[{key:'part',qty:1,rate:100}],labor:{hours:0,rate:0},install:{hours:0,rate:0}},pricing={taxPct:10,minJobCharge:200,pricingRulesVersion:2};
 assert.equal(computeTotals(lines,pricing).total,220);assert.equal(computeTotals({...lines,carportPricing:{minimum:200,required:0,estimatedCost:100}},pricing).total,220);
 assert.equal(computeTotals(lines,{...pricing,pricingRulesVersion:1}).total,200,'Historical minimum calculation remains unchanged');
 const options=[];
 for(const lengthFt of [20,30]){const session={type:'concrete',business:'concrete',pricingRulesVersion:2,state:{...defaultState('concrete'),lengthFt},priceBookSnapshot:DEFAULT_PRICE_BOOK,customer:{name:'Alternative fixture',email:'alternative@example.test',location:'Test address'},overrides:{},taxPct:0};const amount=Math.round(computeTotals(buildLineState('concrete',session.state,DEFAULT_PRICE_BOOK,{}),{...session,minJobCharge:DEFAULT_PRICE_BOOK.minJobCharge}).total*100);const made=await api('/api/quotes','POST',{type:'concrete',customerName:session.customer.name,payload:session,totalCents:amount},owner);assert.equal(made.status,201);options.push(made.data);}
 const review=await api('/api/quote-options/preview','POST',{options:options.map((q,i)=>({id:q.id,version:q.version,title:'Option '+i,explanation:'Different patio length'})),recommendedId:options[0].id},owner);assert.equal(review.status,200,JSON.stringify(review.data));assert.ok(review.data.differences.some(d=>d.changed));
 sqlite.prepare('UPDATE quotes SET total_cents=1 WHERE id=?').run(options[0].id);assert.equal((await api(`/api/quotes/${options[0].id}/share`,'POST',{version:options[0].version},owner)).status,400);
 const beforeMarketing=sqlite.prepare("SELECT version FROM suite_revisions WHERE topic='marketing'").get().version;
 assert.equal((await api('/api/marketing/spending','POST',{site:'concrete',date:'2026-09-18',channel:'google',amountCents:10000},owner)).status,201);
 assert.ok(sqlite.prepare("SELECT version FROM suite_revisions WHERE topic='marketing'").get().version>beforeMarketing);
 const userId=sqlite.prepare("SELECT id FROM users WHERE name='Owner'").get().id;
 let task=(await api('/api/pm/tasks','POST',{title:'Reopen fixture',assigneeId:userId},owner)).data;
 task=(await api(`/api/pm/tasks/${task.id}`,'PATCH',{version:task.version,status:'done'},owner)).data;
 task=(await api(`/api/pm/tasks/${task.id}`,'GET',undefined,owner)).data;
 assert.equal((await api(`/api/pm/tasks/${task.id}`,'PATCH',{version:task.version,status:'todo'},owner)).status,200);
 assert.equal(sqlite.prepare('SELECT resolved_at FROM suite_notifications WHERE event_key=?').get('task:'+task.id+':'+userId).resolved_at,null);
 const client=(await api('/api/crm/clients','POST',{name:'Merge fixture'},owner)).data;
 const sources=[];for(let i=0;i<2;i++){const p=(await upload('/api/customer-previews/from-model',{title:'Merge '+i,clientId:client.id})).data;sources.push({id:p.id,version:p.version});}
 const merged=await api('/api/customer-previews/merge','POST',{requestId:crypto.randomUUID(),title:'Linked merge',sources},owner);assert.equal(merged.status,201,JSON.stringify(merged.data));assert.equal(merged.data.clientId,client.id);
 const uid=sqlite.prepare("SELECT id FROM users WHERE name='Owner'").get().id;
 const employee=sqlite.prepare("INSERT INTO hr_employees(user_id,first_name,last_name,pay_type,pay_rate_cents,created_at) VALUES(?,'Audit','Hourly','hourly',2000,?)").run(uid,Date.now()).lastInsertRowid;
 sqlite.prepare("INSERT INTO hr_pay_rates(employee_id,effective_date,pay_type,rate_cents,created_at) VALUES(?,'2026-01-01','hourly',2000,?)").run(employee,Date.now());
 assert.equal((await api('/api/hr/labor-policy','POST',{effectiveDate:'2026-09-14',weeklyHours:40,multiplier:1.5,burdenPct:10,reviewed:true},owner)).status,201);
 for(let day=14;day<=18;day++){const start=new Date(`2026-09-${day}T08:00:00`).getTime();sqlite.prepare('INSERT INTO pm_time_entries(user_id,project_id,started_at,ended_at,duration_min) VALUES(?,?,?,?,540)').run(uid,job.id,start,start+9*3600000);}
 const pay=(await api('/api/hr/payroll/summary?from=2026-09-14&to=2026-09-20','GET',undefined,owner)).data.find(r=>r.employeeId===Number(employee));
 assert.equal(pay.hours,45);assert.equal(pay.overtimeHours,5);assert.equal(pay.overtimeCents,5000);assert.equal(pay.grossCents,95000);
 sqlite.prepare("UPDATE users SET role='technician' WHERE id=?").run(uid);
 for(const path of ['/api/hr/payroll/summary?from=2026-09-14&to=2026-09-20','/api/business-report','/api/finance/stats'])assert.equal((await api(path,'GET',undefined,owner)).status,403);
 console.log('Business audit regressions passed: rates, tax, company reports, overtime, permissions.');
}finally{await app.close();}
