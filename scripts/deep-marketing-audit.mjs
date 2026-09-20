// Correctness checks against a disposable database.
import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
const app=await testApp();const {api,owner,sqlite}=app;
try {
 const {safeGooglePage}=await import('../server/google-reporting.ts');
 const {recordReportingStatus,reportingStatus}=await import('../server/reporting-status.ts');
 const {portfolioServices,projectReadiness}=await import('../shared/portfolio.ts');
 for(const site of ['concrete','insulation']){
  const lead=await api('/api/public/leads','POST',{name:'Audit '+site,site,email:site+'@example.test'},null,{'X-Lead-Key':'test-intake-key'});assert.equal(lead.status,201);
  const token='audit-review-'+site;
  sqlite.prepare('INSERT INTO review_requests(token,name,lead_id) VALUES(?,?,?)').run(token,'Audit '+site,lead.data.id);
  const response=await api('/api/public/review-submit','POST',{token,rating:5,text:'Synthetic audit'});assert.equal(response.status,200);
  const review=sqlite.prepare('SELECT site FROM mk_reviews WHERE request_id=(SELECT id FROM review_requests WHERE token=?)').get(token);
  assert.equal(review.site,site);
 }
 let response=await api('/api/marketing/reviews','POST',{author:'Invalid rating',rating:99,reviewDate:'not-a-date'},owner);
 assert.equal(response.status,400);
 const body={author:'Retry fixture',rating:5,site:'metals'},headers={'Idempotency-Key':'audit-same-review-request'};
 const a=await api('/api/marketing/reviews','POST',body,owner,headers),b=await api('/api/marketing/reviews','POST',body,owner,headers);
 assert.equal(a.data.id,b.data.id);
 const one=await api('/api/marketing/reviews','POST',{author:'Same audit name',rating:3,site:'metals'},owner);
 await api('/api/marketing/reviews','POST',{author:'Same audit name',rating:3,site:'concrete'},owner);
 await new Promise(r=>setTimeout(r,30));
 const tasks=sqlite.prepare("SELECT id,status FROM pm_tasks WHERE title LIKE ? AND deleted_at IS NULL").all("Respond to Same audit name%");
 assert.equal(tasks.length,2);
 await api('/api/marketing/reviews/'+one.data.id,'PATCH',{responded:true},owner);
 assert.equal(sqlite.prepare('SELECT status FROM pm_tasks WHERE auto_key=?').get('auto:review:'+one.data.id).status,'done');
 for(const path of ['/q/customer-name-AbCdEfGh123456','/p/customer-name-AbCdEfGh123456','/preview/abcdeffedcba123456abcdef']){assert.equal(safeGooglePage(path),"/private");}
 
 recordReportingStatus('google','metals','traffic','Current failure','2026-01-01','2026-01-28');recordReportingStatus('google','metals','traffic',null,'2025-12-04','2025-12-31');
 assert.equal(reportingStatus('google','metals','2026-01-01','2026-01-28').find(s=>s.kind==='traffic').error,'Current failure');
 assert.deepEqual(projectReadiness({site:'trades',workType:'completed',city:'Arlington',scope:'Test',materials:'Steel',serviceSlug:'metal-fabrication'}),[]);
 const base=(await api('/api/marketing/settings','GET',undefined,owner)).data;
 await api('/api/marketing/settings','PUT',{staleLeadDays:15,quoteFollowUpDays:base.quoteFollowUpDays},owner);
 const stale=await api('/api/marketing/settings','PUT',{staleLeadDays:base.staleLeadDays,expectedUpdatedAt:base.updatedAt},owner);assert.equal(stale.status,409);
 assert.equal((await api('/api/marketing/settings','GET',undefined,owner)).data.staleLeadDays,15);
 const range=(await api('/api/marketing/growth?site=metals','GET',undefined,owner)).data.current;
 for(const [source,medium] of [['google','cpc'],['facebook','paid_social']]) {
  const lead=await api('/api/public/leads','POST',{name:'Audit '+source,site:'metals',email:source+'@example.test'},null,{'X-Lead-Key':'test-intake-key'});assert.equal(lead.status,201);
  const time=Date.parse(range.end+'T12:00:00Z');
  sqlite.prepare('UPDATE crm_leads SET created_at=?,utm_source=?,utm_medium=? WHERE id=?').run(time,source,medium,lead.data.id);
  sqlite.prepare('UPDATE crm_lead_intake SET qualified_at=? WHERE lead_id=?').run(time,lead.data.id);
 }
 sqlite.prepare('INSERT OR REPLACE INTO mk_google_reports(site,start_date,end_date,kind,payload,fetched_at) VALUES(?,?,?,?,?,?)').run('metals',range.start,range.end,'spend',JSON.stringify({hasData:true,rows:[{cents:10000,clicks:1}]}),Date.now());
 const costReport=(await api('/api/marketing/growth?site=metals','GET',undefined,owner)).data.current;
 assert.equal(costReport.totals.paidQualified,2);assert.equal(costReport.costPerQualifiedPaidLeadCents,10000);
 

 const entry={site:'metals',date:range.end,channel:'meta',amountCents:4000,campaign:'fixture',notes:''};
 const spending=await api('/api/marketing/spending','POST',entry,owner,{'Idempotency-Key':'spend-fixture-repeat'});assert.equal(spending.status,201);
 const again=await api('/api/marketing/spending','POST',entry,owner,{'Idempotency-Key':'spend-fixture-repeat'});assert.equal(again.data.id,spending.data.id);
 assert.equal((await api('/api/marketing/spending?site=concrete','GET',undefined,owner)).data.length,0);
 const combined=(await api('/api/marketing/growth?site=metals','GET',undefined,owner)).data.current;assert.equal(combined.spendCents,14000);assert.equal(combined.costPerQualifiedPaidLeadCents,7000);
 assert.equal((await api('/api/marketing/spending/'+spending.data.id,'PATCH',{...entry,site:'concrete',version:1},owner)).status,400);
 assert.equal((await api('/api/marketing/spending/'+spending.data.id,'PATCH',{...entry,amountCents:6000,version:1},owner)).status,200);
 assert.equal((await api('/api/marketing/spending/'+spending.data.id,'PATCH',{...entry,version:1},owner)).status,409);
 assert.equal((await api('/api/marketing/spending/'+spending.data.id+'/archive','POST',{version:2},owner)).status,200);
 assert.equal((await api('/api/marketing/growth?site=metals&end=2099-01-01','GET',undefined,owner)).status,400);
 const updated=await api('/api/marketing/reviews/'+a.data.id,'PATCH',{text:'Corrected',version:a.data.version},owner);assert.equal(updated.status,200);
 assert.equal((await api('/api/marketing/reviews/'+a.data.id,'PATCH',{text:'Stale',version:a.data.version},owner)).status,409);
 assert.equal((await api('/api/marketing/reviews/'+a.data.id,'DELETE',{version:updated.data.version},owner)).status,200);
 assert.ok((await api('/api/marketing/reviews?archived=1','GET',undefined,owner)).data.some(r=>r.id===a.data.id));
 assert.equal((await api('/api/marketing/reviews/'+a.data.id+'/restore','POST',{version:updated.data.version+1},owner)).status,200);
 const preferences={version:0,staleDays:4,followUpDays:null,googleProfileUrl:'',digest:false};assert.equal((await api('/api/marketing/preferences/concrete','PUT',preferences,owner)).status,200);
 assert.equal((await api('/api/marketing/preferences/concrete','PUT',preferences,owner)).status,409);
 assert.equal((await api('/api/marketing/preferences/insulation','GET',undefined,owner)).data.staleDays,undefined);

 const task1=await api('/api/marketing/opportunities','POST',{site:'concrete',path:'/services/concrete-patios'},owner);
 const task2=await api('/api/marketing/opportunities','POST',{site:'concrete',path:'/services/concrete-patios'},owner);assert.equal(task1.status,200);assert.equal(task1.data.id,task2.data.id);
 assert.equal((await api('/api/marketing/opportunities','POST',{site:'concrete',path:'/q/private-customer'},owner)).status,400);
 sqlite.prepare("UPDATE users SET role='technician' WHERE name='Owner'").run();
 assert.equal((await api('/api/marketing/growth?site=metals','GET',undefined,owner)).status,403);
 assert.equal((await api('/api/marketing/spending','POST',entry,owner)).status,403);
 assert.equal((await api('/api/marketing/reviews','POST',{rating:5,site:'metals',published:true},owner)).status,403);
 assert.equal((await api('/api/marketing/reviews','POST',{rating:5,site:'metals',published:false},owner)).status,201);
 sqlite.prepare("UPDATE users SET role='owner' WHERE name='Owner'").run();
 console.log('Marketing regressions passed.');
} finally {await app.close();}
