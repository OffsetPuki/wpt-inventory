import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {testApp} from './test-app.mjs';
const app=await testApp(),{sqlite,api,owner}=app;
try{
 const client=Number(sqlite.prepare("INSERT INTO crm_clients(name) VALUES('Synthetic high-volume account')").run().lastInsertRowid);
 const quote=sqlite.prepare("INSERT INTO quotes(number,type,status,payload) VALUES(?,'custom','accepted',?)"),job=sqlite.prepare('INSERT INTO projects(name,job_number,client_id,quote_id) VALUES(?,?,?,?)'),invoice=sqlite.prepare("INSERT INTO fin_invoices(number,status,project_id,quote_id,client_id,items) VALUES(?,'draft',?,?,?,'[]')");
 sqlite.transaction(()=>{for(let i=0;i<2500;i++){
  const q=Number(quote.run('SCALE-Q-'+i,JSON.stringify({customer:{clientId:client}})).lastInsertRowid);
  const j=Number(job.run('Synthetic job '+i,'SCALE-J-'+i,client,q).lastInsertRowid);
  invoice.run('SCALE-I-'+i,j,q,client);
 }})();
 const {recordConnections}=await import('../server/record-connections.ts');
 const original=sqlite.prepare;let prepared=0;
 sqlite.prepare=function(...args){prepared++;return original.apply(this,args);};
 let bounded;
 try{bounded=recordConnections('customer',client,{page:0,size:25});}finally{sqlite.prepare=original;}
 assert.equal(bounded.total,7501);assert.equal(bounded.records.length,25);assert(prepared<=8,'Connection queries must stay bounded; saw '+prepared);
 const times=[];let bytes=0;
 for(let i=0;i<10;i++){
  const start=performance.now(),res=await api(`/api/suite/connections/customer/${client}?size=25&page=${i}`,'GET',undefined,owner);
  times.push(performance.now()-start);assert.equal(res.status,200);assert.equal(res.data.records.length,25);bytes=Math.max(bytes,Buffer.byteLength(JSON.stringify(res.data)));
 }
 assert(bytes<16000,'Phone connection responses must remain under 16 KB');
 const last=recordConnections('customer',client,{page:100000,size:25});assert.equal(last.page,300);assert.equal(last.records.length,1);
 const first=recordConnections('customer',client,{page:0,size:25}),second=recordConnections('customer',client,{page:1,size:25});assert(!first.records.some(a=>second.records.some(b=>a.type===b.type&&a.id===b.id)));
 times.sort((a,b)=>a-b);assert(times[9]<2000,'Local synthetic lookup exceeded the 2-second regression ceiling');
 console.log(JSON.stringify({result:'PASS',linkedRecords:7501,queries:prepared,maxResponseBytes:bytes,medianMs:Math.round(times[5]),maxMs:Math.round(times[9])}));
}finally{await app.close();}
