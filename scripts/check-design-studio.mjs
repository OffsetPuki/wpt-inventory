import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
const app=await testApp();
try{
 const route='/api/design-studio/film-table';
 assert.equal((await app.api(route,'POST')).status,401);
 const a=await app.api(route,'POST',{},app.owner);assert.equal(a.status,201);assert.equal(a.data.published,false);assert.equal(a.data.options[0].kind,'html');
 const b=await app.api(route,'POST',{},app.owner);assert.equal(b.data.id,a.data.id);assert.equal(b.data.options.length,1);
 const path='/api/public/customer-previews/'+a.data.url.split('/').at(-1),key={'X-Lead-Key':'test-intake-key'};
 assert.equal((await app.api(path,'GET',undefined,undefined,key)).status,404);
 const enabled=await app.api('/api/customer-previews/'+a.data.id+'/sharing','POST',{published:true,version:a.data.version},app.owner);assert.equal(enabled.status,200);
 assert.equal((await app.api(path,'GET',undefined,undefined,key)).status,200);
 const unchanged=await app.api(route,'POST',{},app.owner);assert.equal(unchanged.data.version,enabled.data.version);assert.equal(unchanged.data.published,true);
 console.log('Studio draft authorization, full HTML model, idempotency, private draft and link enablement passed.');
}finally{await app.close();}
