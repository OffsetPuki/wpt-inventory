import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
import {apiRequest,setAuthToken} from '../client/src/lib/queryClient.ts';

const app=await testApp();
const directFetch=globalThis.fetch;
let legacyHeaders=false;
// A CDN can weaken an ETag when it changes the response's encoding.
globalThis.fetch=async(url,init)=>{
 const response=await directFetch(new URL(url,app.base),init);
 if((init?.method||'GET')!=='GET'||!response.headers.has('etag'))return response;
 const headers=new Headers(response.headers);
 headers.set('etag','W/'+headers.get('etag'));
 if(legacyHeaders)headers.delete('X-Record-Version');
 return new Response(await response.arrayBuffer(),{status:response.status,headers});
};
setAuthToken(app.owner);
try {
 const create=await app.api('/api/finance/invoices','POST',{
  clientName:'Synthetic revision customer',items:[{description:'Test fabrication',qty:1,unitPriceCents:10000}],
 },app.owner);
 assert.equal(create.status,201);
 const url=`/api/finance/invoices/${create.data.id}`;
 const detail=await apiRequest('GET',url);
 const before=(await detail.json()).invoice;
 const sent=await apiRequest('PATCH',url,{status:'sent'});
 assert.equal((await sent.json()).status,'sent','Unchanged invoice can be marked sent through a transforming proxy');
 const emailCount=()=>app.sqlite.prepare("SELECT count(*) n FROM suite_outbox WHERE kind='queueInvoiceEmail' AND json_extract(payload,'$.inv.id')=?").get(create.data.id).n;
 assert.equal(emailCount(),1);
 await apiRequest('GET',url);
 await apiRequest('PATCH',url,{status:'sent'});
 assert.equal(emailCount(),1,'Repeated status updates do not queue another invoice email');
 console.log('PASS unchanged invoice sends with a weakened transport ETag');

 const stale=await apiRequest('GET',url);
 await stale.json();
 await app.api(url,'PATCH',{customerNote:'Changed in another session'},app.owner);
 await assert.rejects(apiRequest('PATCH',url,{customerNote:'Stale overwrite'}),e=>e.status===409&&e.code==='RECORD_VERSION_CONFLICT');
 const fresh=await apiRequest('GET',url),current=(await fresh.json()).invoice;
 assert.ok(current._version>before._version);
 assert.equal(fresh.headers.get('X-Record-Version'),String(current._version));
 assert.equal((await apiRequest('PATCH',url,{customerNote:'Reviewed update'})).status,200);
 assert.equal((await app.api(url,'DELETE',undefined,app.owner,{'If-Match':`"${before._version}"`})).status,409);
 console.log('PASS real concurrent edits remain protected and reload permits a reviewed retry');
 legacyHeaders=true;
 await apiRequest('GET',url);
 assert.equal((await apiRequest('PATCH',url,{customerNote:'Legacy header compatibility'})).status,200);
 console.log('PASS legacy numeric cache validators remain compatible');
} finally {
 globalThis.fetch=directFetch;
 await app.close();
}
