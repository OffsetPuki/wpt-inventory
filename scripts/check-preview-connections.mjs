import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
const app=await testApp();
const {api,owner}=app;
const key={'X-Lead-Key':'test-intake-key'};
const call=async(path,method='GET',body)=>{const r=await api(path,method,body,owner);assert.ok(r.status<300,JSON.stringify(r));return r.data;};
try {
 const a=await call('/api/crm/clients','POST',{name:'Linked preview customer'});
 const b=await call('/api/crm/clients','POST',{name:'Different customer'});
 const job=await call('/api/projects','POST',{name:'Preview job',jobNumber:'PREVIEW-1',clientId:a.id});
 const q=await call('/api/quotes','POST',{type:'custom',payload:{type:'custom',customer:{name:a.name,clientId:a.id},state:{},overrides:{}},totalCents:10000});
 const p=await call('/api/customer-previews','POST',{title:'Linked design',clientId:a.id,projectId:job.id,quoteId:q.id});
 assert.equal(p.clientId,a.id);assert.equal(p.projectId,job.id);assert.equal(p.quoteId,q.id);
 assert.equal((await call(`/api/customer-previews?clientId=${a.id}`)).length,1);
 assert.equal((await call(`/api/customer-previews?clientId=${b.id}`)).length,0);
 assert.equal((await call(`/api/customer-previews?projectId=${job.id}`))[0].id,p.id);
 assert.equal((await call('/api/customer-previews/connections?clientId='+a.id)).jobs[0].id,job.id);
 assert.equal((await api('/api/customer-previews','POST',{title:'Wrong',clientId:b.id,projectId:job.id},owner)).status,400);
 assert.equal((await api(`/api/customer-previews/${p.id}`,'PATCH',{...p,clientId:b.id,version:p.version},owner)).status,400);
 assert.equal((await call('/api/customer-previews/'+p.id)).clientId,a.id);
 const updated=await call('/api/customer-previews/'+p.id,'PATCH',{...p,linkName:'My Shop',version:p.version});
 assert.match(updated.shortUrl,/\/p\/my-shop-[\w-]{16}$/);
 assert.equal(updated.url,p.url);
 for(const link of [p.shortUrl,updated.shortUrl]) {
   const path='/api/public/share-links/p/'+link.split('/').at(-1);
   assert.equal((await api(path)).status,404);
   assert.equal((await api(path,'GET',undefined,undefined,key)).data.token,p.url.split('/').at(-1));
 }
 const preserved=await call('/api/customer-previews/'+p.id,'PATCH',{title:'Legacy edit without link fields',version:updated.version});
 assert.equal(preserved.clientId,a.id);assert.equal(preserved.projectId,job.id);
 const share=await call(`/api/quotes/${q.id}/share`,'POST',{version:q.version,linkName:'Customer Shop'});
 assert.match(share.shortUrl,/\/q\/customer-shop-[\w-]{16}$/);
 assert.ok(share.url.includes('/quote/'));
 assert.equal((await api('/api/public/share-links/q/'+share.shortUrl.split('/').at(-1),'GET',undefined,undefined,key)).data.token,share.token);
 assert.equal((await api('/api/public/quote/'+share.token)).status,200);
 console.log('Preview connections, mismatches, old links, custom aliases and source quotes passed.');
} finally {app.close();}
