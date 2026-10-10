import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
const preview=process.argv.includes('--preview');
const app=await testApp({serve:preview}),{api,owner,sqlite}=app;
const get=async(path)=>{const r=await api(path,'GET',undefined,owner);assert.equal(r.status,200,`${path}: ${JSON.stringify(r.data)}`);return r.data;};
const post=async(path,body)=>{const r=await api(path,'POST',body,owner);assert.ok(r.status<300,`${path}: ${JSON.stringify(r.data)}`);return r.data;};
const report=(area,site='metals',extra='')=>get(`/api/insights/${area}?from=2026-10-01&to=2026-10-10&site=${site}&compare=1${extra}`);
const chart=(r,id)=>r.charts.find(c=>c.id===id);
try{
 for(const area of ['today','finance','invoices','sales','jobs','schedule','time','inventory','purchasing','expenses','payroll']){
  const report=await get(`/api/insights/${area}?from=2026-10-01&to=2026-10-10&site=all&compare=1`);
  assert.ok(report.charts.length);
  for(const chart of report.charts){
   const detail=await get(`/api/insights/${area}?from=2026-10-01&to=2026-10-10&site=all&chart=${chart.id}`);
   assert.ok(Array.isArray(detail.rows));
  }
  console.log('PASS report and drill-downs: '+area);
 }
 const client=await post('/api/crm/clients',{name:'Graph customer'});
 const m=await post('/api/projects',{jobNumber:'GRAPH-M',name:'Metals job',clientId:client.id});
 const c=await post('/api/projects',{jobNumber:'GRAPH-C',name:'Concrete job',clientId:client.id});
 sqlite.prepare("UPDATE projects SET site='concrete' WHERE id=?").run(c.id);
 const lm=await post('/api/crm/leads',{name:'Metals lead',site:'metals',source:'website',stage:'quote_sent',estimatedValueCents:12000});
 const lc=await post('/api/crm/leads',{name:'Concrete lead',site:'concrete',source:'other',stage:'new',estimatedValueCents:34000});
 const quote=await post('/api/quotes',{type:'custom',customerName:'Graph quote',totalCents:10000,payload:{type:'custom',business:'metals',customer:{name:'Graph customer'}}});
 sqlite.prepare("UPDATE quotes SET status='sent',sent_at=?,lead_id=? WHERE id=?").run(Date.parse('2026-09-01T12:00:00Z'),lm.id,quote.id);
 assert.equal((await get('/api/crm/stats?site=metals')).openLeads,1);
 assert.equal((await get('/api/crm/stats?site=concrete')).pipelineValueCents,34000);
 assert.equal((await get('/api/crm/reports?site=concrete')).byStage.reduce((n,r)=>n+r.count,0),1);
 assert.equal(chart(await report('sales'),'waiting').total,1);
 assert.equal(chart(await report('sales','concrete'),'waiting').total,0);
 assert.equal(chart(await report('sales'),'stages').previousTotal,null,'Current snapshots cannot pretend to have historical comparisons');
 const makeInvoice=async(projectId,cents)=>post('/api/finance/invoices',{clientId:client.id,projectId,items:JSON.stringify([{description:'Graph work',qty:1,unitPriceCents:cents}])});
 const invoice=await makeInvoice(m.id,10000),other=await makeInvoice(c.id,90000);
 sqlite.prepare("UPDATE fin_invoices SET status='sent',due_date='2026-09-01',retainage_cents=1000,paid_cents=2000 WHERE id=?").run(invoice.id);
 sqlite.prepare("UPDATE fin_invoices SET status='sent',due_date=NULL WHERE id=?").run(other.id);
 const draft=await makeInvoice(m.id,99000);assert.ok(draft.id);
 const aging=chart(await report('invoices'),'aging');assert.equal(aging.total,7000);
 const detail=await report('invoices','metals',`&chart=aging&group=${encodeURIComponent(aging.rows[0].key)}&unit=USD`);
 assert.equal(detail.total,1);assert.equal(detail.rows[0].href,'/finance/invoices?invoice='+invoice.id);
 assert.equal(chart(await report('invoices','concrete'),'aging').rows[0].label,'No due date');
 await post('/api/finance/expenses',{category:'materials',vendor:'=unsafe formula',amountCents:500,date:'2026-10-02',projectId:m.id});
 await post('/api/finance/expenses',{category:'software',vendor:'Prior-only cost',amountCents:800,date:'2026-09-24',projectId:m.id});
 await post('/api/finance/expenses',{category:'materials',vendor:'Concrete expense',amountCents:600,date:'2026-10-02',projectId:c.id});
 const categories=chart(await report('expenses'),'categories');
 assert.equal(categories.total,500);assert.equal(categories.previousTotal,800);
 assert.deepEqual(categories.rows.find(r=>r.key==='software')&&[categories.rows.find(r=>r.key==='software').value,categories.rows.find(r=>r.key==='software').previous],[0,800]);
 assert.equal(chart(await report('today'),'cash').total,-500,'Cash headline must be a difference, not a sum of inflows and outflows');
 const csv=await api('/api/insights/expenses?from=2026-10-01&to=2026-10-10&site=metals&chart=categories&format=csv','GET',undefined,owner);
 assert.equal(csv.status,200);assert.match(csv.data,/'=unsafe formula/);assert.ok(!csv.data.includes('Concrete expense'));
 const start=Date.parse('2026-10-02T12:00:00Z');
 sqlite.transaction(()=>{const s=sqlite.prepare('INSERT INTO pm_time_entries(user_id,project_id,started_at,ended_at,duration_min,created_at) VALUES(1,?,?,?,?,?)');for(let i=0;i<550;i++)s.run(m.id,start,start+60000,1,start);})();
 const range=await import('../server/payroll.ts');const boundary=range.payrollRange('2026-10-01','2026-10-10').start;
 sqlite.prepare('INSERT INTO pm_time_entries(user_id,project_id,started_at,ended_at,duration_min,created_at) VALUES(1,?,?,?,?,?)').run(m.id,boundary-3600000,boundary+3600000,120,boundary);
 const time=chart(await report('time'),'logged');assert.equal(Math.round(time.total*60),610);
 const times=await report('time','metals','&chart=logged&page=20');assert.equal(times.total,551);assert.equal(times.rows.length,25);
 const stock=await post('/api/items',{name:'Tube lengths',category:'raw_materials',itemType:'raw_material',unit:'ft',quantity:5});
 sqlite.prepare('UPDATE items SET low_stock_threshold=10,reorder_target=12 WHERE id=?').run(stock.id);
 sqlite.prepare("INSERT INTO project_checklist(project_id,label,item_id,qty,unit) VALUES(?,'Tube',?,10,'ft')").run(m.id,stock.id);
 assert.equal(chart(await report('inventory'),'shortage').rows.find(r=>r.key===stock.id+':needed').value,7);
 sqlite.prepare('UPDATE items SET quantity_reserved=3 WHERE id=?').run(stock.id);
 assert.equal(chart(await report('inventory'),'shortage').rows.find(r=>r.key===stock.id+':needed').value,10,'Replenishment must cover reserved stock as well as the available-stock target');
 assert.equal(chart(await report('inventory','concrete'),'shortage').rows.length,0);
 const po=await post('/api/finance/purchase-orders',{orderType:'supplier',vendor:'Graph supplier',projectId:m.id,expectedDate:'2026-09-30',items:[{description:'Tube',qty:10,unit:'ft',unitPriceCents:100}]});
 sqlite.prepare("UPDATE fin_purchase_orders SET status='sent',created_at=? WHERE id=?").run(start,po.id);
 sqlite.prepare('INSERT INTO inventory_receipts(po_id,line_index,quantity,item_id,stock_quantity,user_id) VALUES(?,0,4,?,4,1)').run(po.id,stock.id);
 const receiving=chart(await report('purchasing'),'receiving');
 assert.equal(receiving.rows.find(r=>r.key==='Still needed:ft').value,6);assert.equal(receiving.rows.find(r=>r.key==='Received:ft').value,4);
 assert.equal(chart(await report('purchasing','concrete'),'receiving').rows.length,0);
 sqlite.prepare('INSERT INTO hr_payroll_runs(from_date,to_date,snapshot,total_cents,closed_by,closed_at) VALUES(?,?,?,?,1,?)').run('2026-10-01','2026-10-07',JSON.stringify([{grossCents:10000,overtimeCents:2000}]),10000,start);
 const payroll=chart(await report('payroll','all'),'payroll');assert.equal(payroll.total,10000);assert.equal(payroll.rows.find(r=>r.key.startsWith('Overtime premium')).value,2000);
 assert.equal((await api('/api/insights/payroll?site=metals','GET',undefined,owner)).status,400);
 for(const query of ['from=2026-02-30','from=2026-10-10&to=2026-10-01','from=2024-01-01&to=2026-10-01','site=invalid'])assert.equal((await api('/api/insights/sales?'+query,'GET',undefined,owner)).status,400);
 assert.equal((await api('/api/insights/sales','GET')).status,401);
 await post('/api/users',{name:'Graph worker',pin:'5678',role:'worker'});
 const login=await api('/api/auth/login','POST',{name:'Graph worker',pin:'5678'});
 assert.equal((await api('/api/insights/payroll','GET',undefined,login.data.token)).status,403);
 assert.equal((await api('/api/insights/finance?chart=aging&format=csv','GET',undefined,login.data.token)).status,403);
 console.log('PASS business boundaries, accurate labels, invoice aging, retainage, previous-only categories, safe CSV, complete pagination, partial receipts, separate units, closed payroll and access control');
 if(preview){
  sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='SYNTHETIC-ONLY' WHERE role='owner'").run();
  const {writeFileSync}=await import('node:fs');writeFileSync('../preview.json',JSON.stringify({base:app.base,metalsJob:m.id,concreteJob:c.id}));
  console.log('Local synthetic preview: '+app.base);await new Promise(()=>{});
 }
}finally{await app.close();}
