import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {testApp} from './test-app.mjs';
import {CUSTOMER_REFERENCE_TABLES,NON_CUSTOMER_CLIENT_ID_TABLES} from '../shared/suite-contracts.ts';
const app=await testApp(),{api,owner,sqlite}=app;
const call=async(url,method='GET',body)=>{const r=await api(url,method,body,owner);assert.ok(r.status<300,`${url}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;};
const reject=async(url,method,body,status)=>assert.equal((await api(url,method,body,owner)).status,status,url);
try{
 const customer=await call('/api/crm/clients','POST',{name:'Audit customer'}),target=await call('/api/crm/clients','POST',{name:'Surviving customer'});
 const preview=await call('/api/customer-previews','POST',{title:'Customer drawing',clientId:customer.id});
 const first=await call(`/api/suite/customer-merge?source=${customer.id}&target=${target.id}`);
 await call('/api/customer-previews','POST',{title:'New drawing during review',clientId:customer.id});
 await reject('/api/suite/customer-merge','POST',{requestKey:crypto.randomUUID(),source:customer.id,target:target.id,version:first.version,reason:'Review changed'},409);
 const reviewed=await call(`/api/suite/customer-merge?source=${customer.id}&target=${target.id}`);
 await call('/api/suite/customer-merge','POST',{requestKey:crypto.randomUUID(),source:customer.id,target:target.id,version:reviewed.version,reason:'Combine duplicate records'});
 assert.equal(sqlite.prepare('SELECT client_id FROM customer_previews WHERE id=?').get(preview.id).client_id,target.id);
 const actual=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().filter(t=>sqlite.pragma(`table_info(${t.name})`).some(c=>c.name==='client_id')).map(t=>t.name).sort();
 assert.deepEqual([...CUSTOMER_REFERENCE_TABLES,...NON_CUSTOMER_CLIENT_ID_TABLES].sort(),actual,'Every client_id column must declare whether it represents a customer');
 console.log('PASS customer references, previews and stale merge review');

 const jobs=[];for(const site of ['metals','concrete']){const j=await call('/api/projects','POST',{jobNumber:'AUDIT-'+site,name:'Audit '+site,clientId:target.id});sqlite.prepare("UPDATE projects SET site=?,billing_mode='time_materials',start_date='2026-10-01',due_date='2026-10-15' WHERE id=?").run(site,j.id);jobs.push(j);}
 const [a,b]=jobs,start=Date.parse('2026-10-01T12:00:00Z');
 const task=await call('/api/pm/tasks','POST',{title:'Original work',projectId:a.id,startDate:'2026-10-01',dueDate:'2026-10-02'});
 await reject('/api/pm/tasks','POST',{title:'Bad date',startDate:'2026-02-30'},400);
 await reject(`/api/pm/tasks/${task.id}`,'PATCH',{startDate:'2026-10-03'},400);
 const time=await call('/api/pm/time','POST',{taskId:task.id,startedAt:start,endedAt:start+3600000});
 await reject(`/api/pm/tasks/${task.id}`,'PATCH',{projectId:b.id},409);
 const body={projectId:b.id,requestKey:crypto.randomUUID()},copy=await call(`/api/pm/tasks/${task.id}/copy`,'POST',body);
 assert.equal((await call(`/api/pm/tasks/${task.id}/copy`,'POST',body)).id,copy.id);
 assert.equal(sqlite.prepare('SELECT project_id FROM pm_time_entries WHERE id=?').get(time.id).project_id,a.id);
 assert.equal(copy.projectId,b.id);
 await reject('/api/pm/time','POST',{projectId:a.id,startedAt:start,endedAt:start+86400000*3},400);
 await reject(`/api/pm/time/${time.id}`,'PATCH',{endedAt:start+86400000*3},400);
 sqlite.transaction(()=>{const s=sqlite.prepare('INSERT INTO pm_time_entries(user_id,project_id,started_at,ended_at,duration_min,created_at) VALUES(1,?,?,?,?,?)');for(let i=0;i<550;i++)s.run(b.id,start+i*60000,start+(i+1)*60000,1,start);})();
 const history=await call(`/api/pm/time?projectId=${b.id}&page=10&limit=50`);
 assert.equal(history.rows.length,50);assert.equal(history.total,550);assert.equal(history.totalMinutes,550);
 console.log('PASS task history, idempotent copy, final duration validation and complete time pagination');

 const expense=await call('/api/finance/expenses','POST',{category:'materials',amountCents:10000,date:'2026-10-01',projectId:b.id,billable:true,vendor:'Audit supply'});
 // Use the second job with no billable fixture time.
 sqlite.prepare('UPDATE pm_time_entries SET billable=0 WHERE project_id=?').run(b.id);
 const invoice=await call('/api/finance/invoices','POST',{clientId:target.id,projectId:b.id,items:'[]'});
 await call(`/api/finance/invoices/${invoice.id}/pull-unbilled`,'POST',{projectId:b.id});
 await reject(`/api/finance/expenses/${expense.id}`,'PATCH',{amountCents:20000,projectId:a.id},409);
 await reject(`/api/finance/expenses/${expense.id}`,'DELETE',undefined,409);
 const correction={requestKey:crypto.randomUUID(),expectedAmountCents:10000,amountCents:12000,customerDeltaCents:2000,reason:'Actual supplier cost',reviewed:true};
 await call(`/api/finance/expenses/${expense.id}/corrections`,'POST',correction);
 await call(`/api/finance/expenses/${expense.id}/corrections`,'POST',correction);
 assert.equal(sqlite.prepare('SELECT total_cents FROM fin_invoices WHERE id=?').get(invoice.id).total_cents,12000);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM fin_expense_corrections WHERE expense_id=?').get(expense.id).n,1);
 sqlite.prepare("UPDATE fin_invoices SET status='sent',share_token='audit-issued' WHERE id=?").run(invoice.id);
 const issued=await call(`/api/finance/expenses/${expense.id}/corrections`,'POST',{...correction,requestKey:crypto.randomUUID(),expectedAmountCents:12000,amountCents:13000,customerDeltaCents:1000});
 assert.notEqual(issued.invoiceId,invoice.id);assert.equal(sqlite.prepare('SELECT total_cents FROM fin_invoices WHERE id=?').get(invoice.id).total_cents,12000);
 await reject(`/api/finance/expenses/${expense.id}/corrections`,'POST',{...correction,requestKey:crypto.randomUUID(),expectedAmountCents:13000,amountCents:11000,customerDeltaCents:-2000},400);
 assert.equal(sqlite.prepare('SELECT amount_cents FROM fin_expenses WHERE id=?').get(expense.id).amount_cents,13000,'Rejected correction rolls back cost');
 await call(`/api/finance/expenses/${expense.id}/corrections`,'POST',{...correction,requestKey:crypto.randomUUID(),expectedAmountCents:13000,amountCents:12500,customerDeltaCents:-500,draftInvoiceId:issued.invoiceId});
 assert.equal(sqlite.prepare('SELECT total_cents FROM fin_invoices WHERE id=?').get(issued.invoiceId).total_cents,500);
 console.log('PASS billed expense guard, reviewed correction, immutable issued invoice, rollback and retry');

 assert.equal((await call('/api/projects?site=concrete')).length,1);
 assert.ok((await call('/api/pm/tasks?site=concrete')).every(t=>t.projectId===b.id));
 assert.ok((await call('/api/finance/invoices?site=concrete')).every(i=>i.projectId===b.id));
 assert.equal((await call('/api/finance/invoices?site=metals')).length,0);
 assert.equal((await call('/api/finance/stats?site=metals')).outstandingCents,0);
 assert.equal((await call('/api/suite/today?site=concrete')).jobs.length,1);
 const {jobReadiness,jobReadinessMany}=await import('../server/suite-data.ts');
 const batch=jobReadinessMany(jobs.map(j=>j.id));for(const job of jobs)assert.deepEqual(batch.get(job.id),jobReadiness(job.id));
 const before=sqlite.prepare("SELECT version FROM suite_revisions WHERE topic='team'").get().version;
 const user=await api('/api/users','POST',{name:'Audit teammate',pin:'4321',role:'worker'},owner);assert.equal(user.status,201);
 assert.ok(sqlite.prepare("SELECT version FROM suite_revisions WHERE topic='team'").get().version>before);
 assert.ok(user.headers.get('x-suite-revisions'));
 const report=await call('/api/business-report?site=concrete&from=2026-10-01&to=2026-10-31');
 assert.equal(report.expensesCents,12500);assert.equal(report.outstandingCents,12000);
 const filtered=await call('/api/business-report?site=concrete&from=2026-10-01&to=2026-10-31&kind=outstanding&q=absent');
 assert.equal(filtered.rows.length,0);assert.equal(filtered.outstandingCents,report.outstandingCents);
 console.log('PASS consistent business scope, batched readiness, live user revisions and filtered report totals');

 const quote=await call('/api/quotes','POST',{type:'custom',customerName:'Surviving customer',totalCents:10000,payload:{type:'custom',customer:{name:'Surviving customer',clientId:target.id,email:'audit@example.test'}}});
 const share=await call(`/api/quotes/${quote.id}/share`,'POST',{version:quote.version});sqlite.prepare("UPDATE quotes SET status='accepted' WHERE id=?").run(quote.id);sqlite.prepare("UPDATE projects SET quote_id=?,status='done' WHERE id=?").run(quote.id,b.id);
 const slug=sqlite.prepare('SELECT slug FROM suite_share_links WHERE token=?').get(share.token).slug,portal=await call('/customer-project/'+slug);
 assert.ok(portal.includes('Completed'));assert.ok(portal.includes(invoice.number));assert.ok(!portal.includes(sqlite.prepare('SELECT number FROM fin_invoices WHERE id=?').get(issued.invoiceId).number));
 assert.equal((await call(`/api/suite/jobs/${b.id}/source-files`)).length,0);
 console.log('PASS customer job status, shared extra invoice, private draft exclusion and connected file endpoint');

 // Paid history remains immutable; original invoices cannot release a cost while an adjustment is active.
 await reject('/api/finance/invoices/'+invoice.id,'PATCH',{status:'void'},409);
 await reject('/api/finance/invoices/'+invoice.id,'DELETE',undefined,409);
 sqlite.prepare("UPDATE fin_invoices SET status='paid',paid_cents=total_cents WHERE id=?").run(invoice.id);
 await reject('/api/finance/expenses/'+expense.id,'PATCH',{amountCents:1},409);
 await call('/api/finance/expenses/'+expense.id+'/corrections','POST',{...correction,requestKey:crypto.randomUUID(),expectedAmountCents:12500,amountCents:12600,customerDeltaCents:0});
 assert.equal(sqlite.prepare('SELECT paid_cents FROM fin_invoices WHERE id=?').get(invoice.id).paid_cents,12000);
 await call('/api/finance/invoices/'+issued.invoiceId,'DELETE');
 sqlite.prepare("UPDATE fin_invoices SET status='sent',paid_cents=0 WHERE id=?").run(invoice.id);
 await call('/api/finance/invoices/'+invoice.id,'PATCH',{status:'void'});
 assert.equal(sqlite.prepare('SELECT invoice_id FROM fin_expenses WHERE id=?').get(expense.id).invoice_id,null);
 await call('/api/finance/expenses/'+expense.id,'PATCH',{projectId:a.id});
 console.log('PASS paid corrections, active adjustment void/delete guards and released expense reassignment');

 // Compare the optimized readiness path with the original single-job path with actual conflicts and stock.
 const worker=user.data, token=(await api('/api/auth/login','POST',{name:worker.name,pin:'4321'})).data.token;
 const crewTask=await call('/api/pm/tasks','POST',{title:'Crew conflict one',projectId:a.id,assigneeId:worker.id,startDate:'2026-10-01',dueDate:'2026-10-10'});
 await call('/api/pm/tasks','POST',{title:'Crew conflict two',projectId:b.id,assigneeId:worker.id,dueDate:'2026-10-02'});
 await api('/api/pm/time/start','POST',{taskId:crewTask.id},token);
 await reject('/api/pm/tasks/'+crewTask.id,'PATCH',{projectId:b.id},409);
 const item=await call('/api/items','POST',{name:'Audit readiness material',category:'raw_materials',itemType:'raw_material',unit:'ft',quantity:0});
 sqlite.prepare("INSERT INTO project_checklist(project_id,label,item_id,qty,unit) VALUES(?,'Audit stock',?,10,'ft')").run(a.id,item.id);
 const order=await call('/api/suite/jobs/'+a.id+'/order','POST',{requestKey:crypto.randomUUID(),vendor:'Audit supplier',expectedDate:'2026-10-10',lines:[{itemId:item.id,quantity:10,unitCostCents:20}]});
 const {receivePo}=await import('../server/inventory-receiving.ts');receivePo(order.id,1,{requestKey:crypto.randomUUID(),lines:[{lineIndex:0,quantity:4,itemId:item.id,stockQuantity:4}]});
 for(const job of jobs)sqlite.prepare("INSERT OR REPLACE INTO suite_job_rules(project_id,deposit_required,documents_required,tools) VALUES(?,1,?,?)").run(job.id,JSON.stringify(['permit']),JSON.stringify([item.id]));
 sqlite.prepare("UPDATE projects SET status='active',schedule_state='confirmed' WHERE id IN (?,?)").run(a.id,b.id);
 const employee=await call('/api/hr/employees','POST',{firstName:'Audit',lastName:'Crew',userId:worker.id,payType:'hourly',hourlyRateCents:2000});
 sqlite.prepare("INSERT INTO hr_leave_requests(employee_id,start_date,end_date,status,type) VALUES(?,'2026-10-02','2026-10-03','approved','vacation')").run(employee.id);
 const ready=jobReadinessMany(jobs.map(j=>j.id));for(const job of jobs)assert.deepEqual(ready.get(job.id),jobReadiness(job.id));
 assert.ok(ready.get(a.id).conflicts.some(c=>c.kind==='crew'));assert.ok(ready.get(a.id).conflicts.some(c=>c.kind==='leave'));
 assert.equal((await call('/api/finance/purchase-orders?site=concrete')).length,0);
 assert.equal((await call('/api/finance/purchase-orders?site=metals&page=0&limit=1')).length,1);
 assert.equal((await call('/api/finance/purchase-orders?site=metals&page=1&limit=1')).length,0);
 assert.equal((await api('/api/suite/pickers/invoice-drafts','GET',undefined,token)).status,403);
 assert.equal((await api('/api/finance/stats','GET',undefined,token)).status,403);
 // Worker streams carry only revision counters, never finance data; they refresh the safe crew picker.
 const controller=new AbortController();const stream=await fetch(app.base+'/api/suite/events',{headers:{'X-Auth':token},signal:controller.signal});
 const reader=stream.body.getReader(),decoder=new TextDecoder();let packet=decoder.decode((await reader.read()).value);
 assert.ok(packet.includes('"team"'));assert.ok(!packet.includes('"finance"'));
 const version=sqlite.prepare("SELECT version FROM suite_revisions WHERE topic='team'").get().version;
 sqlite.prepare('UPDATE users SET name=? WHERE id=?').run('Renamed audit teammate',worker.id);
 assert.ok(sqlite.prepare("SELECT version FROM suite_revisions WHERE topic='team'").get().version>version);
 assert.ok((await api('/api/suite/people','GET',undefined,token)).data.some(u=>u.name==='Renamed audit teammate'));
 controller.abort();await reader.cancel().catch(()=>{});
 await call('/api/users/'+worker.id+'/access','PATCH',{active:false});
 assert.ok(!(await call('/api/suite/people')).some(u=>u.id===worker.id));
 console.log('PASS running task guard, stock/crew/leave/tool readiness parity, order scope/pages and crew privacy/revisions');
}finally{await app.close();}
