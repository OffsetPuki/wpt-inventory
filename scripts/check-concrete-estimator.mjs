import assert from 'node:assert/strict';
import {defaultConcreteEstimate,calculateConcrete,sectionArea,concreteEstimateSchema} from '../shared/concrete-estimate.ts';
import {testApp} from './test-app.mjs';
const original=defaultConcreteEstimate(),base=calculateConcrete(original);
assert.equal(Math.round(base.total),17900);assert.equal(base.allowances,1);assert.equal(base.rows[0].area,595);
assert.equal(sectionArea(original.sections.walk),72.25);assert.equal(base.rows[4].amount,1400);
const changed=structuredClone(original);changed.sections.drive.length={feet:35,inches:0};assert.equal(calculateConcrete(changed).rows[0].area,612.5);assert.equal(calculateConcrete(changed).rows[0].amount,7411.25);
changed.sections.sidewalk={...changed.sections.sidewalk,shape:'two-rectangles',length:{feet:20,inches:0},width:{feet:3,inches:0},returnLength:{feet:4,inches:0},returnWidth:{feet:3,inches:0},measured:true};assert.equal(sectionArea(changed.sections.sidewalk),72);assert.equal(calculateConcrete(changed).rows[4].amount,1296);
changed.sections.sidewalk.included=false;assert.equal(calculateConcrete(changed).rows[4].amount,0);
for(const invalid of [{...original,discount:999999},(()=>{const d=structuredClone(original);d.sections.drive.width.inches=12;return d;})(),(()=>{const d=structuredClone(original);d.sections.sidewalk.measured=true;return d;})()])assert.equal(concreteEstimateSchema.safeParse(invalid).success,false);
const app=await testApp();try{
 const d=await app.api('/api/design-studio/registry','POST',{name:'Synthetic concrete visit',modelKey:'residential-concrete',jobId:null},app.owner);assert.equal(d.status,201,JSON.stringify(d.data));
 const url=`/api/design-studio/registry/${d.data.id}/concrete-estimate`;
 assert.equal((await app.api(url)).status,401);const first=await app.api(url,'GET',undefined,app.owner);assert.equal(first.data.version,0);
 const saved=await app.api(url,'PUT',{version:0,data:changed},app.owner);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.version,1);
 assert.equal((await app.api(url,'PUT',{version:0,data:original},app.owner)).status,409);
 const read=await app.api(url,'GET',undefined,app.owner);assert.deepEqual(read.data.data,changed);assert.equal(read.data.calculation.rows[0].amount,7411.25);
 assert.equal((await app.api(url,'PUT',{version:1,data:{...changed,washout:-1}},app.owner)).status,400);
 const history=await app.api(`/api/design-studio/registry/${d.data.id}/history`,'GET',undefined,app.owner);assert.equal(history.data.total,2);assert(JSON.parse(history.data.rows[0].snapshot_json).concreteEstimate);
 await app.api(`/api/design-studio/registry/${d.data.id}`,'PATCH',{version:d.data.version,action:'archive'},app.owner);assert.equal((await app.api(url,'PUT',{version:1,data:original},app.owner)).status,409);
 const film=await app.api('/api/design-studio/registry','POST',{name:'Other model',modelKey:'film-plant',jobId:null},app.owner);assert.equal((await app.api(`/api/design-studio/registry/${film.data.id}/concrete-estimate`,'GET',undefined,app.owner)).status,400);
 console.log('Concrete pricing, fractional dimensions, taper/L shapes, allowances, exclusions, validation, persistence, history and conflict protection passed.');
}finally{await app.close();}
