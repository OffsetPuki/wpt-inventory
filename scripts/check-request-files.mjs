import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {testApp} from './test-app.mjs';
import {restoreBackup} from './restore-backup.mjs';
const app=await testApp(),{api,owner,sqlite}=app,key={'X-Lead-Key':'test-intake-key'};
const file=(name,bytes)=>({name,data:Buffer.from(bytes).toString('base64')});
try{
 const attachmentDir=path.join(process.env.DATA_DIR,'lead-files');
 for(const site of ['metals','concrete','insulation','trades']){
  const token=crypto.randomBytes(32).toString('hex');
  const attachments=[file('project.pdf','%PDF-1.7\nfixture'),file('drawing.dwg',Buffer.from([0,1,255,2])),file('notes.xlsx','spreadsheet fixture')];
  const input={site,name:`Files ${site}`,email:`files-${site}@example.test`,submissionId:crypto.randomUUID(),receiptToken:token,attachments};
  const created=await api('/api/public/leads','POST',input,null,key);assert.equal(created.status,201,JSON.stringify(created.data));
  const id=created.data.id,detail=(await api(`/api/crm/leads/${id}/detail`,'GET',undefined,owner)).data;
  assert.equal(detail.files.length,3);
  for(const saved of detail.files){
   const url=`/api/crm/leads/${id}/files/${saved.id}`;
   assert.equal((await api(url)).status,401);
   assert.equal((await api(`/api/crm/leads/${id+999}/files/${saved.id}`,'GET',undefined,owner)).status,404);
   const response=await fetch(app.base+url,{headers:{'X-Auth':owner}});
   assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.match(response.headers.get('content-type'),/application\/octet-stream/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(attachments.find(a=>a.name===saved.name).data,'base64'));
  }
  assert.equal((await api('/api/public/leads','POST',input,null,key)).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM crm_lead_files WHERE lead_id=?').get(id).n,3,'Retries must not duplicate files');
  const supplement={site,token,submissionId:crypto.randomUUID(),attachments:[file('details.zip','zip fixture')]};
  assert.equal((await api('/api/public/lead-details','POST',supplement,null,key)).status,200);
  assert.equal((await api('/api/public/lead-details','POST',supplement,null,key)).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM crm_lead_files WHERE lead_id=?').get(id).n,4);
 }
 const submit=attachments=>api('/api/public/leads','POST',{name:'Boundary fixture',submissionId:crypto.randomUUID(),attachments},null,key);
 const before=fs.readdirSync(attachmentDir).length;
 assert.equal((await submit([file('one.txt','one'),{name:'broken.bin',data:'bad!'}])).status,400);
 assert.equal(fs.readdirSync(attachmentDir).length,before,'Invalid batches must not leave files');
 assert.equal((await submit(Array.from({length:4},(_,i)=>file(`${i}.txt`,'a')))).status,400);
 assert.equal((await submit([file('too-big.bin',Buffer.alloc(10_000_001))])).status,400);
 assert.equal((await submit([file('a.bin',Buffer.alloc(7_000_000)),file('b.bin',Buffer.alloc(7_000_000)),file('c.bin',Buffer.alloc(7_000_000))])).status,400);
 const large=await submit([file('first.bin',Buffer.alloc(10_000_000,17)),file('second.bin',Buffer.alloc(10_000_000,18))]);
 assert.equal(large.status,201,'Maximum-size files must pass the actual scoped body parser');
 const active=await submit([file('../../active.html','<script>alert(1)</script>')]);assert.equal(active.status,201);
 const activeFile=(await api(`/api/crm/leads/${active.data.id}/detail`,'GET',undefined,owner)).data.files[0];assert.ok(!activeFile.name.includes('/'));
 const response=await api(`/api/crm/leads/${active.data.id}/files/${activeFile.id}`,'GET',undefined,owner);assert.match(response.headers.get('content-security-policy'),/sandbox/);
 const {createFullBackup}=await import('../server/full-backup.ts');
 const backup=await createFullBackup(),destination=path.join(process.env.DATA_DIR,'restored-request-files');
 await restoreBackup(backup.file,destination);
 assert.equal(fs.readdirSync(path.join(destination,'lead-files')).length,fs.readdirSync(attachmentDir).length,'Backup and restore include request files');
 console.log('PASS: all four trades, arbitrary files, exact downloaded bytes, authenticated attachment downloads, retries, supplements, size boundaries, cleanup, backup and restore.');
}finally{await app.close();}
