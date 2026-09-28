import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {testApp} from './test-app.mjs';
import {partChecks,cutCsv} from '../client/src/components/design-studio/manufacturing.ts';
import {FeaturePage,featureCount} from '../client/src/components/design-studio/PartFeatureDrawing.tsx';
import {inchFraction} from '../client/src/components/design-studio/fractions.ts';
import {decodeFilmTableAsset,createProcess,PROCESS_STEPS} from '../client/src/lib/generated/film-table-runtime.js';
import {makePartIndex,isolatedPart} from '../client/src/components/design-studio/part-selection.js';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PartDrawing from '../client/src/components/design-studio/PartDrawing.tsx';
import * as T from 'three';
import {createDetailRender} from '../client/src/components/design-studio/detail-render.js';
const lodScene=new T.Scene(),lodRoot=new T.Group(),lodCamera=new T.PerspectiveCamera(36,1,.01,100);lodScene.add(lodRoot);lodCamera.position.z=10;
const tiny=new T.Mesh(new T.SphereGeometry(.001)),large=new T.Mesh(new T.BoxGeometry(1,1,1)),alreadyHidden=new T.Mesh(new T.BoxGeometry(1,1,1));
for(const m of [tiny,large,alreadyHidden]){m.userData.shopPartId='test';lodRoot.add(m);}alreadyHidden.visible=false;
let rendered;const drawDetail=createDetailRender({domElement:{clientHeight:400},render(){rendered=[tiny.visible,large.visible,alreadyHidden.visible];}},lodRoot);
drawDetail(lodScene,lodCamera);assert.deepEqual(rendered,[false,true,false]);assert.equal(tiny.visible,true,'Drawing restores picking visibility');assert.equal(alreadyHidden.visible,false);
lodCamera.position.z=.05;drawDetail(lodScene,lodCamera);assert.equal(rendered[0],true,'Zooming restores the full small part');
const detailedRail=new T.Mesh(new T.BoxGeometry(6,.05,.025,100,4,4)),broadPlate=new T.Mesh(new T.BoxGeometry(1,1,.002,20,20,1));
for(const mesh of [detailedRail,broadPlate]){mesh.userData.shopPartId='test';lodRoot.add(mesh);}
const railGeometry=detailedRail.geometry,plateGeometry=broadPlate.geometry;
const drawProfiles=createDetailRender({domElement:{clientHeight:400},render(){rendered=[detailedRail.geometry,broadPlate.geometry];}},lodRoot);
lodCamera.position.z=20;drawProfiles(lodScene,lodCamera);assert.notEqual(rendered[0],railGeometry,'Narrow distant profiles have a lightweight visual');assert.equal(rendered[1],plateGeometry,'Broad plate outlines remain exact');assert.equal(detailedRail.geometry,railGeometry,'Selection retains the original rail geometry');
lodCamera.position.z=1;drawProfiles(lodScene,lodCamera);assert.equal(rendered[0],railGeometry,'Close-up restores detailed profiles');drawProfiles.dispose();drawDetail.dispose();
assert.equal(inchFraction(12.7),'1/2″');assert.equal(inchFraction(47.625),'1 7/8″');assert.equal(inchFraction(6.35),'1/4″');assert.equal(inchFraction(25.39),'1″');assert.equal(inchFraction(-1.5875),'-1/16″');assert.equal(inchFraction(.359),'<1/16″');
const index=JSON.parse(fs.readFileSync('server/design-studio/current/parts.json','utf8'));
assert(index.parts.length>300);
assert.equal(index.parts.find(p=>p.name==='Purchased nylon guide wheel').quantity,6);
assert.equal(index.parts.find(p=>p.name==='Purchased 3/8 × 10-1/2 inch turnbuckle').quantity,1);
assert.equal(index.parts.find(p=>p.name==='Purchased golden lynch coupling pin').quantity,1);
assert(index.parts.some(p=>p.category==='Existing angles & brackets'));
for(const name of ['Retainer upper mounting angle','Retainer lower mounting angle'])assert.equal(index.parts.filter(p=>p.name===name).reduce((n,p)=>n+p.quantity,0),4);
assert.equal(index.parts.find(p=>p.name==='Overlap cam bolt-on bridge plate').quantity,10);
for(const p of index.parts){const d=JSON.parse(fs.readFileSync('server/design-studio/current/parts/'+p.id+'.json','utf8'));assert(d.edges.length>0,p.name);assert(d.dimensions.every(n=>Number.isFinite(n)&&n>0));for(const edge of d.edges)assert(edge.flat().every(Number.isFinite));for(const h of d.holes)assert(h.diameter>0&&[...h.start,...h.end].every(Number.isFinite));}
const feed=index.parts.find(p=>p.name==='Feed arm mounting plate'),plate=JSON.parse(fs.readFileSync('server/design-studio/current/parts/'+feed.id+'.json','utf8'));
assert.deepEqual(plate.dimensions,[200,97.6,12.7]);assert.equal(plate.holes.filter(h=>h.diameter===14).length,2);
assert.equal(plate.holes.filter(h=>h.diameter===9).length,2);
const bytes=gunzipSync(fs.readFileSync('server/design-studio/current/studio-model.bin.gz')),model=decodeFilmTableAsset(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
assert.equal(model.root.userData.studioRevision,index.revision);
assert.equal(model.spec.table[0],6);assert.equal(model.rollGroups.length,6);assert.equal(model.guideWheels.length,6);
const process=createProcess(model);for(const step of PROCESS_STEPS){for(const fraction of [0,.25,.5,.75,.999]){process.apply(step.start+(step.end-step.start)*fraction);model.root.updateMatrixWorld(true);model.root.traverse(o=>{assert(o.matrixWorld.elements.every(Number.isFinite),o.name+' pose');});}}assert.deepEqual(model.root.userData.hardwareAudit.issues,[]);
process.apply(PROCESS_STEPS.find(s=>s.id==='cutFar').start);
const overviewScene=new T.Scene(),overviewCamera=new T.PerspectiveCamera(36,390/548,.015,100);overviewScene.add(model.root);overviewCamera.position.set(17,14,19);overviewCamera.lookAt(-.28,.58,-.65);
const sourceGeometries=new Map();let fullTriangles=0,overviewTriangles=0;model.root.traverseVisible(o=>{if(o.isMesh){sourceGeometries.set(o,o.geometry);fullTriangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
const overviewDraw=createDetailRender({domElement:{clientHeight:548},render(){model.root.traverseVisible(o=>{if(o.isMesh)overviewTriangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});}},model.root);
overviewDraw(overviewScene,overviewCamera);assert(overviewTriangles<fullTriangles*.25,'Whole-table overview reduces invisible detail by at least 75%');for(const [mesh,geometry] of sourceGeometries)assert.equal(mesh.geometry,geometry);overviewDraw.dispose();
console.log(JSON.stringify({fullTriangles,overviewTriangles,geometryPreserved:true}));
const picking=makePartIndex(model.root);
assert.equal(picking.parts.size,index.parts.length);
for(const p of index.parts){const entries=picking.parts.get(p.id);assert(entries?.length,p.name);assert.equal(new Set(entries.map(e=>e.instance)).size,p.quantity,p.name);const isolated=isolatedPart(picking,p.id),box=new T.Box3().setFromObject(isolated.group),size=box.getSize(new T.Vector3()).toArray();size.forEach((v,i)=>assert(Math.abs(v*1000-p.dimensions[i])<.015,p.name+': '+size));isolated.group.traverse(o=>o.geometry?.dispose());}
const target=picking.parts.get(feed.id)[0],m=target.mesh.matrixWorld.clone().multiply(new T.Matrix4().fromArray(target.mesh.userData.shopToDrawing).invert());
const point=new T.Vector3(.06,.02,.0127).applyMatrix4(m),normal=new T.Vector3(0,0,1).transformDirection(m),ray=new T.Raycaster(point.clone().addScaledVector(normal,.02),normal.clone().negate());
const hit=picking.pick(ray);assert.equal(hit.hit?.id,feed.id,'Plate surface can be picked');assert(hit.checked<30,'Picking avoids testing every mesh');
for(const mesh of picking.instances.get(target.instance))mesh.visible=false;
assert.notEqual(picking.pick(ray).hit?.instance,target.instance,'Hidden piece cannot be selected');
for(const mesh of picking.instances.get(target.instance))mesh.visible=true;
assert.equal(picking.pick(ray).hit?.instance,target.instance,'Restored piece is selectable');
const saddle=index.parts.find(p=>p.name==='Open U saddle'),detail=JSON.parse(fs.readFileSync('server/design-studio/current/parts/'+saddle.id+'.json'));
const svg=renderToStaticMarkup(React.createElement(PartDrawing,{part:detail}));
assert(svg.includes('data-feature="H1"')&&svg.includes('data-feature="R1"'));
assert(svg.includes('Hole centers &amp; curve dimensions'));assert(svg.includes('R 13/16″'));
const details=index.parts.map(p=>JSON.parse(fs.readFileSync('server/design-studio/current/parts/'+p.id+'.json')));
const lower=details.find(p=>p.name==='Entry pipe split clamp lower'),upper=details.find(p=>p.name==='Entry pipe split clamp upper');
assert(Math.abs(lower.holes[0].start[1]-lower.dimensions[1]-.3)<.001,'Lower clamp keeps off-stock circular center');assert.equal(upper.holes[0].start[1],-.3,'Upper clamp center must not be moved onto stock');
let featurePages=0;
for(const p of details){
 for(const r of p.radii)if(r.mid)assert(Math.abs(Math.hypot(...r.mid.map((v,i)=>v-r.center[i]))-r.radius)<.02,p.id+' radius matches curve');
 for(const s of p.segments||[]){assert(Math.hypot(...s.end.map((v,i)=>v-s.start[i]))>0,p.id+' segment length');assert(s.normal?.every(Number.isFinite),p.id+' outline plane');}
 const overview=renderToStaticMarkup(React.createElement(PartDrawing,{part:p,features:false,revision:index.revision}));assert(!/NaN|Infinity/.test(overview),p.id+' drawing');
 for(let page=0;page<Math.ceil(featureCount(p)/2);page++){const detailSvg=renderToStaticMarkup(React.createElement(FeaturePage,{part:p,page,unit:'mm',revision:index.revision}));assert(!/NaN|Infinity/.test(detailSvg),p.id+' feature drawing');featurePages++;}
}
const book=fs.readFileSync('server/design-studio/current/field-book.html','utf8'),encoded=book.match(/<script id="field-data" type="application\/octet-stream">([^<]+)<\/script>/)[1],offline=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')));
assert.equal(offline.revision,index.revision);assert.equal(offline.parts.length,index.parts.length);assert(!/<script[^>]+src=|<link[^>]+href=/.test(book),'Offline book has no external assets');assert.equal(offline.parts.find(p=>p.id===feed.id).holes.length,plate.holes.length);
assert(cutCsv(index.parts,index.revision).includes('Cut length mm (if specified)'));assert(partChecks(details.find(p=>p.name==='Fixed 2-1-2 inch Schedule 40 entry pipe')).some(n=>/unconfirmed/i.test(n)));
const audit={revision:index.revision,drawings:index.parts.length,physicalPieces:index.parts.reduce((n,p)=>n+p.quantity,0),customDrawings:details.filter(p=>p.kind==='custom').length,customPieces:details.filter(p=>p.kind==='custom').reduce((n,p)=>n+p.quantity,0),animationPoses:PROCESS_STEPS.length*5,featurePages,offlineBytes:Buffer.byteLength(book),geometryBytes:fs.statSync('server/design-studio/current/studio-model.bin.gz').size,checks:details.filter(p=>p.kind==='custom').map(p=>({id:p.id,name:p.name,notes:partChecks(p)}))};
fs.mkdirSync('../output/film-table-bolted',{recursive:true});
fs.writeFileSync('../output/film-table-bolted/field-audit.json',JSON.stringify(audit,null,2));
const app=await testApp();try{
 const prefix='/api/design-studio/film-table';
 for(const route of ['/parts','/geometry','/field-book','/parts/'+feed.id])assert.equal((await app.api(prefix+route)).status,401);
 assert.equal((await app.api(prefix+'/parts','GET',undefined,app.owner)).status,200);
 const response=await app.api(prefix+'/parts/'+feed.id,'GET',undefined,app.owner);assert.equal(response.status,200);assert.equal(response.data.name,feed.name);assert.match(response.headers.get('cache-control'),/private/);
 assert.equal((await app.api(prefix+'/parts/FT-999','GET',undefined,app.owner)).status,404);
 assert.equal((await app.api(prefix+'/parts/not-a-part','GET',undefined,app.owner)).status,404);
 assert.equal((await app.api(prefix+'/parts/'+feed.id+'?revision=old','GET',undefined,app.owner)).status,409);
 assert.equal((await app.api(prefix+'/field-book?revision=old','GET',undefined,app.owner)).status,409);
 assert.equal((await app.api(prefix+'/field-book?revision='+index.revision,'GET',undefined,app.owner)).status,200);
 const before=app.sqlite.prepare('SELECT count(*) AS n FROM customer_previews').get().n;await app.api(prefix+'/parts','GET',undefined,app.owner);assert.equal(app.sqlite.prepare('SELECT count(*) AS n FROM customer_previews').get().n,before);
 console.log(JSON.stringify({drawings:index.parts.length,parts:index.parts.reduce((n,p)=>n+p.quantity,0),animationPoses:PROCESS_STEPS.length*5,authorization:'passed',fractionRounding:'passed',purchasedHardwareSelectable:true,hiddenPicking:"passed",dimensionDrawing:"passed"}));
}finally{await app.close();}
