import assert from 'node:assert/strict';
import express from 'express';
import {testApp} from './test-app.mjs';
const app=await testApp();
try {
 const path='/api/settings/website/insulation',pub='/api/public/website-status/insulation';
 assert.equal((await app.api(path)).status,401);
 assert.equal((await app.api(path,'PUT',{active:true,version:1})).status,401);
 assert.deepEqual((await app.api(pub)).data,{active:false});
 let status=(await app.api(path,'GET',undefined,app.owner)).data;
 assert.equal(status.active,false);
 assert.equal((await app.api(path,'PUT',{active:'true',version:status.version},app.owner)).status,400);
 let saved=await app.api(path,'PUT',{active:true,version:status.version},app.owner);
 assert.equal(saved.status,200);assert.equal(saved.data.active,true);
 assert.deepEqual((await app.api(pub)).data,{active:true});
 const {registerWebsiteAvailability}=await import('../server/website-availability.ts');
 registerWebsiteAvailability(express());
 assert.deepEqual((await app.api(pub)).data,{active:true},'Restart initialization preserves the saved choice');
 assert.equal((await app.api(path,'PUT',{active:false,version:status.version},app.owner)).status,409);
 saved=await app.api(path,'PUT',{active:false,version:saved.data.version},app.owner);
 assert.equal(saved.status,200);assert.deepEqual((await app.api(pub)).data,{active:false});
 await app.api('/api/users','POST',{name:'Website Worker',pin:'1234',role:'worker'},app.owner);
 const worker=(await app.api('/api/auth/login','POST',{name:'Website Worker',pin:'1234'})).data.token;
 assert.equal((await app.api(path,'GET',undefined,worker)).status,403);
 assert.equal((await app.api(path,'PUT',{active:true,version:saved.data.version},worker)).status,403);
 assert.equal(app.sqlite.prepare("SELECT active FROM website_availability WHERE site='insulation'").get().active,0);
 console.log('PASS website availability: inactive default, persistence, activation/deactivation, authorization and stale-write protection.');
} finally {await app.close();}
