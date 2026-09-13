import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {testApp} from './test-app.mjs';
import {documentFixture} from './document-activity-fixture.mjs';
const app=await testApp();
const {api,owner,sqlite}=app;
try{
 const {docs,key,body}=await documentFixture(app);
 await api('/api/users','POST',{name:'Activity Worker',pin:'1111',role:'worker'},owner);
 const worker=(await api('/api/auth/login','POST',{name:'Activity Worker',pin:'1111'})).data.token;
 const before=sqlite.prepare('SELECT count(*) n FROM suite_outbox').get().n;
 for(const d of docs){
  assert.ok(d.revision);
  const path=`/api/public/document-activity/${d.kind}/${d.token}`,report=`/api/document-activity/${d.kind}/${d.id}`,b=body(d);
  assert.equal((await api(report)).status,401);
  assert.equal((await api(report,'GET',undefined,worker)).status,d.kind==='invoice'?403:200);
  assert.equal((await api(path,'POST',b)).status,404);
  for(const bad of [{...b,revision:'bad'},{...b,visitId:'bad'},{...b,seq:-1},{...b,activeMs:-1},{...b,extra:'private text'},{...b,actions:{...b.actions,unknown:1}}])assert.ok([400,409].includes((await api(path,'POST',bad,undefined,key)).status));
  assert.equal((await api(path,'POST',b,undefined,key)).status,201);
  assert.equal((await api(path,'POST',b,undefined,key)).status,200);
  assert.equal((await api(path,'POST',{...b,seq:3,activeMs:20000,actions:{...b.actions,print:3}},undefined,key)).status,200);
  assert.equal((await api(path,'POST',{...b,seq:2},undefined,key)).status,200);
  assert.equal((await api(path,'POST',{...b,seq:4},undefined,key)).status,200);
  let r=(await api(report,'GET',undefined,owner)).data;
  assert.equal(r.summary.visits,1);assert.equal(r.summary.activeMs,20000);assert.equal(r.summary.scrollPct,90);assert.equal(r.actions.find(x=>x.name==='print').count,3);assert.equal(r.visits[0].device,'Phone');assert.equal(r.visits[0].browser,'Safari');
  assert.equal(r.confirmed.status,'sent','Clicks cannot accept a quote or pay an invoice');
  if(d.kind==='quote'){assert.equal(r.confirmed.acceptedAt,null);assert.equal(r.confirmed.legacyOpens,7);sqlite.prepare('UPDATE quotes SET version=version+1 WHERE id=?').run(d.id);}
  else {assert.equal(r.confirmed.paidCents,0);assert.deepEqual(r.confirmed.payments,[]);sqlite.prepare("UPDATE fin_invoices SET customer_note='Revised content' WHERE id=?").run(d.id);}
  assert.equal((await api(path,'POST',{...b,visitId:crypto.randomUUID()},undefined,key)).status,409);
  assert.equal((await api(path,'POST',{...b,seq:5},undefined,key)).status,200,'Existing visit keeps original revision');
  const current=(await api('/api/public/'+d.kind+'/'+d.token)).data[d.kind];
  assert.notEqual(current.activityRevision,d.revision);
  assert.equal((await api(path,'POST',{...b,visitId:crypto.randomUUID(),revision:current.activityRevision,activeMs:600000},undefined,key)).status,201);
  r=(await api(report,'GET',undefined,owner)).data;
  assert.equal(r.summary.visits,2);assert.ok(r.visits[0].activeMs<=60000);
  assert.equal(current.visits,undefined);assert.equal(current.activity,undefined);
 }
 assert.equal(sqlite.prepare('SELECT count(*) n FROM suite_outbox').get().n,before,'Activity does not send email');
 const q=docs[0],inv=docs[1];
 sqlite.prepare("UPDATE quotes SET status='accepted',accepted_at=?,accept_note='Confirmed fixture response' WHERE id=?").run(Date.now(),q.id);
 sqlite.prepare("UPDATE fin_invoices SET status='partial',paid_cents=2500 WHERE id=?").run(inv.id);
 sqlite.prepare("INSERT INTO fin_invoice_payments(invoice_id,amount_cents,method,paid_at,created_at) VALUES(?,2500,'check','2026-09-13',?)").run(inv.id,Date.now());
 assert.equal((await api(`/api/document-activity/quote/${q.id}`,'GET',undefined,owner)).data.confirmed.acceptNote,'Confirmed fixture response');
 const paid=(await api(`/api/document-activity/invoice/${inv.id}`,'GET',undefined,owner)).data;
 assert.equal(paid.confirmed.paidCents,2500);assert.equal(paid.confirmed.payments[0].amountCents,2500);
 const preview=(await api(`/api/finance/invoices/${inv.id}/preview`,'POST',{},owner)).data.url;
 assert.equal(new URL(preview).searchParams.get('owner'),'1');
 for(const d of docs){sqlite.prepare(`UPDATE ${d.kind==='quote'?'quotes':'fin_invoices'} SET status='draft' WHERE id=?`).run(d.id);assert.equal((await api(`/api/public/document-activity/${d.kind}/${d.token}`,'POST',body(d),undefined,key)).status,404);}
 assert.equal(sqlite.pragma('integrity_check',{simple:true}),'ok');
 console.log('Document activity passed: permissions, validation, dedupe, monotonic counters, revision history, owner exclusion, and confirmed responses/payments distinct from clicks.');
}finally{await app.close();}
