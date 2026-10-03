import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {testApp} from './test-app.mjs';
const t=await testApp();const {api,owner,sqlite}=t;
const key={'X-Lead-Key':'test-intake-key'};
const token=crypto.randomBytes(32).toString('hex');
const request={name:'Synthetic lead',email:'lead@example.test',site:'concrete',submissionId:crypto.randomUUID(),receiptToken:token,contact:'Email',bestTime:'After 3 pm',area:'Arlington',utm:{source:'google',campaign:'synthetic-driveways'},qualification:{removal:'Yes',dimensions:'20 x 30 ft'}};
try{
 const intake=await api('/api/public/leads','POST',request,null,key);assert.equal(intake.status,201);assert.equal(intake.data.receiptEnabled,true);const id=intake.data.id;
 const duplicate=await api('/api/public/leads','POST',request,null,key);assert.equal(duplicate.data.id,id);assert.equal(duplicate.data.deduped,true);assert.equal(duplicate.data.receiptEnabled,true);
 assert.equal((await api('/api/public/leads','POST',{...request,site:'insulation'},null,key)).status,409);
 const detail=await api(`/api/crm/leads/${id}/intake`,'GET',undefined,owner);assert.equal(detail.data.context.bestTime,'After 3 pm');assert.equal(detail.data.context.qualification.removal,'Yes');
 assert.equal((await api(`/api/crm/leads/${id}/intake`)).status,401);
 assert.equal(sqlite.prepare('SELECT token_hash FROM web_lead_access').get().token_hash,crypto.createHash('sha256').update(token).digest('hex'));
 const payload={token,site:'concrete',submissionId:crypto.randomUUID(),details:'There is an existing slab.'};
 assert.equal((await api('/api/public/lead-details','POST',payload)).status,401);
 assert.equal((await api('/api/public/lead-details','POST',{...payload,token:'a'.repeat(64)},null,key)).status,404);
 assert.equal((await api('/api/public/lead-details','POST',{...payload,site:'insulation'},null,key)).status,404);
 assert.equal((await api('/api/public/lead-details','POST',payload,null,key)).status,200);
 assert.equal((await api('/api/public/lead-details','POST',payload,null,key)).data.deduped,true);
 assert.equal((await api('/api/public/lead-details','POST',{...payload,details:'Changed payload'},null,key)).status,409);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM web_lead_supplements').get().n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM suite_notifications WHERE event_key=?').get(`lead-details:${payload.submissionId}`).n,1,'One owner notification, including retries');
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
 const before=readdirSync(t.uploadsDir).length;
 assert.equal((await api('/api/public/lead-details','POST',{...payload,submissionId:crypto.randomUUID(),photos:[photo,'data:image/jpeg;base64,aW52YWxpZA==']},null,key)).status,400);
 assert.equal(readdirSync(t.uploadsDir).length,before,'Failed batch cleans saved photo');
 const withPhoto=await api('/api/public/lead-details','POST',{...payload,submissionId:crypto.randomUUID(),photos:[photo]},null,key);assert.equal(withPhoto.status,200);
 const saved=sqlite.prepare('SELECT photos,notes FROM crm_leads WHERE id=?').get(id);assert.equal(JSON.parse(saved.photos).length,1);assert.match(saved.notes,/existing slab/);
 assert.equal((await api(JSON.parse(saved.photos)[0])).status,401,'Lead photos stay private');
 assert.equal((await api(`/api/crm/leads/${id}/detail`,'GET',undefined,owner)).data.photos,saved.photos,'Lead details expose previously saved and supplemental photos');
 sqlite.prepare('UPDATE web_lead_access SET expires_at=0').run();assert.equal((await api('/api/public/lead-details','POST',{...payload,submissionId:crypto.randomUUID()},null,key)).status,404);
 let funnel=(await api('/api/crm/lead-funnel','GET',undefined,owner)).data;assert.ok(funnel.queue.some(r=>r.id===id));
 await api('/api/crm/activities','POST',{entityType:'lead',entityId:id,kind:'note',notes:'Internal note'},owner);
 funnel=(await api('/api/crm/lead-funnel','GET',undefined,owner)).data;assert.ok(funnel.queue.some(r=>r.id===id),'An internal note is not customer contact');
 sqlite.prepare("INSERT INTO pm_tasks(title,kind,status,auto_key) VALUES ('Contact waiting lead','follow_up','todo',?)").run(`auto:lead-follow-up:${id}`);
 await api('/api/crm/activities','POST',{entityType:'lead',entityId:id,kind:'email',notes:'Replied to customer'},owner);
 assert.equal(sqlite.prepare('SELECT status FROM pm_tasks WHERE auto_key=?').get(`auto:lead-follow-up:${id}`).status,'done');
 await api(`/api/crm/leads/${id}/intake`,'PATCH',{qualified:true,surveyAt:Date.now()+86400000},owner);
 funnel=(await api('/api/crm/lead-funnel','GET',undefined,owner)).data;assert.ok(!funnel.queue.some(r=>r.id===id));const row=funnel.report.find(r=>r.site==='concrete');assert.equal(row.qualified,1);assert.equal(row.surveys,1);assert.equal(row.responseSample,1);
 assert.equal(funnel.bySource.find(r=>r.campaign==='synthetic-driveways').qualified,1);
 const review=await api('/api/marketing/reviews','POST',{author:'Approved concrete customer',site:'concrete',rating:5,text:'Synthetic approved review',published:true},owner);assert.equal(review.status,201);
 const concrete=(await api('/api/public/reviews?site=concrete')).data;assert.equal(concrete.site,'concrete');assert.equal(concrete.reviews.length,1);assert.equal((await api('/api/public/reviews?site=insulation')).data.reviews.length,0);assert.equal((await api('/api/public/reviews')).data.reviews.length,0);
 // Exercise the owner outbox without delivering any real email. The fixture
 // blocks external fetches and never starts a mail worker.
 process.env.RESEND_API_KEY='test-never-send';process.env.MAIL_FROM='test@example.test';process.env.OWNER_EMAIL='';process.env.TO_EMAIL='owner@example.test';process.env.SMTP_USER='';
 const {readMail}=await import('../server/mail-queue.ts');
 const {sendMail}=await import('../server/mailer.ts');
 const isolatedFetch=globalThis.fetch,deliveries=[];
 globalThis.fetch=async(url,init={})=>{
  if(String(url)==='https://api.resend.com/emails'){
   assert.equal(new Headers(init.headers).get('Authorization'),'Bearer test-never-send');
   deliveries.push(JSON.parse(init.body));
   return new Response(JSON.stringify({id:`synthetic-mail-${deliveries.length}`}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  return isolatedFetch(url,init);
 };
 const bytes=Buffer.from(photo.split(',')[1],'base64');
 for(const site of ['metals','concrete','insulation','trades']){
  const receiptToken=crypto.randomBytes(32).toString('hex');
  const input={name:`Photo test ${site}`,email:`${site}@example.test`,site,submissionId:crypto.randomUUID(),receiptToken,photos:[photo,photo]};
  const result=await api('/api/public/leads','POST',input,null,key);assert.equal(result.status,201);const leadId=result.data.id;
  const detail=(await api(`/api/crm/leads/${leadId}/detail`,'GET',undefined,owner)).data;
  const urls=JSON.parse(detail.photos);assert.equal(urls.length,2);
  for(const url of urls){assert.deepEqual(readFileSync(path.join(t.uploadsDir,path.basename(url))),bytes);assert.equal((await api(url,'GET',undefined,owner)).status,200);assert.equal((await api(url)).status,401);}
  const mail=readMail(`lead-intake-owner:${leadId}`).msg;assert.equal(mail.to,'owner@example.test');assert.equal(mail.attachments.length,2);mail.attachments.forEach(a=>assert.deepEqual(a.content,bytes));assert.match(mail.text,new RegExp(`/#/crm/leads\\?lead=${leadId}`));
  assert.equal((await api('/api/public/leads','POST',input,null,key)).data.id,leadId);assert.equal(JSON.parse((await api(`/api/crm/leads/${leadId}/detail`,'GET',undefined,owner)).data.photos).length,2,'Retry does not duplicate photos');
  const followup={site,token:receiptToken,submissionId:crypto.randomUUID(),details:'An extra angle',photos:[photo]};
  assert.equal((await api('/api/public/lead-details','POST',followup,null,key)).status,200);
  assert.equal(readMail(`lead-details:${followup.submissionId}`).msg.attachments.length,1,'Supplemental photos reach the configured owner fallback address');
  assert.equal((await api('/api/public/lead-details','POST',followup,null,key)).data.deduped,true);
  assert.equal(JSON.parse((await api(`/api/crm/leads/${leadId}/detail`,'GET',undefined,owner)).data.photos).length,3);
  const resubmit={...input,submissionId:crypto.randomUUID(),photos:[photo]};
  assert.equal((await api('/api/public/leads','POST',resubmit,null,key)).data.id,leadId);
  assert.equal(readMail(`lead-intake-photos:${resubmit.submissionId}`).msg.attachments.length,1,'New photos on a recent request get their own alert');
  assert.equal(JSON.parse((await api(`/api/crm/leads/${leadId}/detail`,'GET',undefined,owner)).data.photos).length,4);
  // Deliver from persisted queue through the real transport serializer, with
  // the provider intercepted above. No message leaves this isolated fixture.
  for(const [mailKey,count] of [[`lead-intake-owner:${leadId}`,2],[`lead-details:${followup.submissionId}`,1],[`lead-intake-photos:${resubmit.submissionId}`,1]]){
   assert.equal(await sendMail(readMail(mailKey).msg,{deliveryKey:mailKey}),true);
   const sent=deliveries.at(-1);assert.equal(sent.to,'owner@example.test');assert.equal(sent.attachments.length,count);
   for(const attachment of sent.attachments){assert.match(attachment.filename,/\.png$/);assert.deepEqual(Buffer.from(attachment.content,'base64'),bytes);}
   const deliveryCount=deliveries.length;assert.equal(await sendMail({to:'owner@example.test',subject:'Retry',text:'Retry',deliveryKey:mailKey}),true);assert.equal(deliveries.length,deliveryCount,'An accepted delivery is not sent twice');
  }
 }
 const uploadCount=readdirSync(t.uploadsDir).length;
 assert.equal((await api('/api/public/leads','POST',{name:'Invalid batch',photos:[photo,'data:image/jpeg;base64,aW52YWxpZA==']},null,key)).status,400);
 assert.equal(readdirSync(t.uploadsDir).length,uploadCount,'Rejected initial photo batches leave no orphan upload');
 console.log('PASS: intake, all four websites, original and supplemental photos, private image access, owner email attachments, retry deduplication, batch cleanup and lead details');
}finally{await t.close();}
