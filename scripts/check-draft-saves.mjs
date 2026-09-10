import assert from 'node:assert/strict';
import { createDraftSaver } from '../client/src/quote/lib/draftSaver.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture(write, isOnline = () => true) {
  let current = {session:{sid:'one',type:'table',state:{height:12},customer:{name:'First'},version:1},book:{rate:5},totalCents:500};
  const statuses=[];
  const saver=createDraftSaver({getCurrent:()=>current,write,online:isOnline,delay:5,onStatus:s=>statuses.push(s),
    acknowledge:(row,sent)=>{ if(current.session.sid===sent.sid) current={...current,session:{...current.session,quoteId:row.id,version:row.version}}; }});
  return {saver,statuses,get:()=>current,edit:patch=>{current={...current,session:{...current.session,...patch}};}};
}
const row=(sess,totalCents,version=1)=>({id:71,version,totalCents,payload:JSON.stringify(sess)});

let release, calls=[];
const slow=fixture(async(sess,total)=>{
  calls.push(sess);
  if(calls.length===1) await new Promise(r=>release=r);
  return row(sess,total,calls.length);
});
const waiting=slow.saver.flush();
await tick();
slow.edit({customer:{name:'Latest customer'},notes:'Last note'});
slow.saver.schedule();
const same=slow.saver.flush();
assert.equal(waiting,same);
release(); await waiting;
assert.equal(calls.length,2); assert.equal(calls[0].quoteId,undefined);
assert.equal(calls[1].quoteId,71); assert.equal(calls[1].version,1);
assert.equal(calls[1].customer.name,'Latest customer');
await slow.saver.flush(); assert.equal(calls.length,2);
slow.saver.dispose();

let receipt, attempts=0;
const lost=fixture(async(sess,total)=>{
  attempts++;
  if(attempts===1) { receipt=row(sess,total); throw new TypeError('Response lost'); }
  return sess.quoteId ? row(sess,total,2) : receipt;
});
await assert.rejects(lost.saver.flush());
lost.edit({notes:'Edited after lost response'});
await lost.saver.retry();
assert.equal(attempts,3); assert.equal(lost.get().session.quoteId,71);
assert.equal(lost.get().session.notes,'Edited after lost response');
lost.saver.dispose();

let count=0;
const conflict=fixture(async()=>{count++; throw Object.assign(new Error('Changed on another screen'),{status:409});});
await assert.rejects(conflict.saver.flush());
conflict.edit({notes:'Keep my edits'}); conflict.saver.schedule(); await tick(); await tick();
await assert.rejects(conflict.saver.retry()); assert.equal(count,1);
assert.equal(conflict.statuses.at(-1),'Conflict'); assert.equal(conflict.get().session.notes,'Keep my edits');
conflict.saver.dispose();

let connected=false, writes=0;
const offline=fixture(async(s,t)=>{writes++;return row(s,t);},()=>connected);
await assert.rejects(offline.saver.flush()); assert.equal(writes,0);
assert.equal(offline.statuses.at(-1),'Offline');
connected=true; await offline.saver.retry(); assert.equal(writes,1);
offline.saver.dispose();
console.log('PASS: Draft saves serialize edits, deduplicate unchanged saves, recover a lost creation response, preserve conflicts, and resume after reconnect.');
