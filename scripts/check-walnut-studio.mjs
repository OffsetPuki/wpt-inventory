import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testApp} from './test-app.mjs';
import {modelDimensions,partGroups} from '../client/src/components/design-studio/walnut-dimensions.ts';

const model=JSON.parse(fs.readFileSync('server/design-studio/walnut-table/model.json','utf8'));
const near=(a,b,message)=>assert(Math.abs(a-b)<.00001,message+`: ${a} / ${b}`);
for(const [top,variant] of Object.entries(model.variants)){
  assert.equal(variant.parts.length,53);
  assert.equal(new Set(variant.parts.map(p=>p.id)).size,53);
  assert.equal(variant.parts.filter(p=>p.category==='Legs').length,4);
  const stretcher=variant.parts.find(p=>p.name==='Lower center stretcher');
  near(stretcher.measurements.find(m=>m.label==='Tube length between bridges').inches,96,'Lower stretcher length');
  assert.equal(partGroups(variant.parts).flat().length,53,'Visual groups retain every piece');
  for(const group of ['table','frame','layout','rails','clearance'])for(const d of modelDimensions(variant,'',group)){
    near(d.value,Math.hypot(...d.b.map((v,i)=>v-d.a[i])),'Dimension line matches measured geometry');
    assert([...d.a,...d.b,...d.from,...d.to].every(Number.isFinite));
  }
  assert.deepEqual(modelDimensions(variant,'','layout').slice(0,2).map(d=>d.value),[14,14]);
  assert.equal(modelDimensions(variant,'','rails')[0].value,15);
  const leg=variant.parts.find(p=>p.category==='Legs');
  near(modelDimensions(variant,leg.id,'table')[2].value,leg.bounds[2],'Part annotation follows selected top');
  assert.equal(variant.parts.filter(p=>p.category==='Bearing strips').length,13);
  assert.equal(variant.integratedDetails.reduce((n,d)=>n+d.quantity,0),18);
  const headers=variant.parts.filter(p=>p.name==='Top trestle header');
  near(Math.min(...headers.map(p=>p.min[0])),14,'Near-end assembly setback');
  near(132-Math.max(...headers.map(p=>p.max[0])),14,'Far-end assembly setback');
  const rails=variant.parts.filter(p=>p.name==='Long upper rail').sort((a,b)=>a.min[1]-b.min[1]);
  near(rails[1].min[1]-rails[0].max[1],15,'Clear rail gap');
  for(const rail of rails){near(rail.bounds[0],96,'Rail length');near(rail.bounds[1],2,'Rail width');near(rail.bounds[2],4,'Rail depth');}
  for(const foot of variant.parts.filter(p=>p.name==='Flush-cut outward foot'))near(foot.min[2],0,'Foot lies flush with floor');
  const wood=variant.parts.find(p=>p.category==='Tabletop');
  near(wood.min[2],30-Number(top),'Wood underside');near(wood.max[2],30,'Finished table height');
  for(const p of variant.parts){
    assert(p.p.length>0&&p.p.length%9===0,p.id+' triangle geometry');assert.equal(p.n.length,p.p.length);assert(p.e.length%6===0);
    assert([...p.p,...p.n,...p.e].every(Number.isFinite),p.id+' finite geometry');
    for(let axis=0;axis<3;axis++){
      const coords=[];for(let i=0;i<p.p.length;i+=3)coords.push([p.p[i]+66,-p.p[i+2],p.p[i+1]][axis]);
      near(Math.min(...coords),p.min[axis],p.id+' minimum');near(Math.max(...coords),p.max[axis],p.id+' maximum');
      near(p.max[axis]-p.min[axis],p.bounds[axis],p.id+' drawing envelope');
    }
    assert(p.measurements.every(d=>d.inches>0&&Number.isFinite(d.inches)));
  }
}
assert.deepEqual(model.variants['2'].parts.map(p=>p.id),model.variants['3'].parts.map(p=>p.id),'Part selection survives thickness changes');
const app=await testApp();
try{
  const route='/api/design-studio/walnut-table';
  const before=app.sqlite.prepare('SELECT * FROM customer_previews ORDER BY id').all();
  assert.equal((await app.api(route)).status,401);
  const result=await app.api(route,'GET',undefined,app.owner);
  assert.equal(result.status,200);assert.equal(result.data.revision,model.revision);assert.match(result.headers.get('cache-control'),/private, no-store/);
  app.sqlite.prepare("UPDATE users SET role='worker' WHERE name='Owner'").run();
  assert.equal((await app.api(route,'GET',undefined,app.owner)).status,403);
  app.sqlite.prepare("UPDATE users SET role='owner' WHERE name='Owner'").run();
  assert.deepEqual(app.sqlite.prepare('SELECT * FROM customer_previews ORDER BY id').all(),before,'Viewing parts never changes customer previews');
  console.log('Walnut parts: geometry, 14-inch setbacks, 15-inch rail gap, variants and private read-only access passed.');
}finally{await app.close();}
