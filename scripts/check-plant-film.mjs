import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {createPlantFilmModel,PLANT_FACTS,PLANT_STEPS} from '../client/src/components/design-studio/plant-film-model.js';
const m=createPlantFilmModel(),part=id=>m.parts.find(p=>p.id===id),bounds=id=>new Box3().setFromObject(part(id).group,true);
assert.equal(PLANT_FACTS.tableSize,6);
assert.equal(new Set(m.parts.map(p=>p.id)).size,m.parts.length);
assert.equal(m.parts.filter(p=>p.id.startsWith('rack-pipe-')).length,3);
assert.equal(m.parts.filter(p=>p.id.startsWith('film-roll-')).length,6);
assert.equal(m.parts.filter(p=>p.id.startsWith('tape-roll-')).length,5);
const upper=m.parts.filter(p=>p.id.startsWith('caster-')).sort((a,b)=>bounds(a.id).min.x-bounds(b.id).min.x);
assert.equal(upper.length,4);
for(let i=0;i<upper.length;i++){
 const center=bounds(upper[i].id).getCenter(new Vector3());
 assert.ok((center.z-m.carriage.position.z)*(i%2===0?-1:1)>0,'four upper wheels alternate sides in a zigzag');
 if(i)assert.ok(bounds(upper[i-1].id).max.x<bounds(upper[i].id).min.x,'upper wheel stations are separated along the bar');
}
assert.equal(m.parts.filter(p=>p.id.startsWith('side-guide-wheel-')).length,2);
for(let i=0;i<6;i++){
 const roll=part('film-roll-'+i).group,pipe=part('rack-pipe-'+(i%2)).group;
 assert.ok(Math.abs(roll.position.z-new Box3().setFromObject(pipe).getCenter(new Vector3()).z)<1e-6);
 if(i<5){const next=part('film-roll-'+(i+1));assert.ok(roll.position.z!==next.group.position.z);assert.ok(bounds('film-roll-'+i).max.x>bounds(next.id).min.x);}
}
for(let i=0;i<5;i++){
 const seam=part('tape-roll-'+i).group;
 assert.ok(Math.abs(seam.position.x-(part('film-roll-'+i).group.position.x+part('film-roll-'+(i+1)).group.position.x)/2)<1e-6);
 assert.ok(seam.position.z<Math.min(part('film-roll-0').group.position.z,part('film-roll-1').group.position.z),'tape pipe behind both film rows');
}
for(const route of m.webs.filter(o=>o.userData.tapeFeed))for(const row of [0,1]){
 const roll=part('film-roll-'+row).group,p=route.geometry.attributes.position;let clearance=false;
 for(let i=0;i<p.count;i+=6){const z1=p.getZ(i),z2=p.getZ(i+2),z=roll.position.z;if(z>=z1&&z<=z2){const y=p.getY(i)+(p.getY(i+2)-p.getY(i))*(z-z1)/(z2-z1);assert.ok(y<roll.position.y-.115-.005,'tape clears underneath film rolls');clearance=true;}}
 assert.ok(clearance,'tape route passes under each film row');
}
const rack=bounds('rack-frame'),table=bounds('table');assert.ok(rack.max.z<table.min.z-.5,'rack separated from table');
const rail=bounds('fixed-rail').getSize(new Vector3()),arm=new Box3().setFromObject(part('arm-2.92').group.children.find(o=>o.userData.extrusion),true);
assert.ok(Math.abs(rail.y-.08)<1e-6&&Math.abs(rail.z-.04)<1e-6,'fixed rail is upright, as photographed');
assert.ok(Math.abs(arm.max.y-bounds('fixed-rail').min.y)<1e-6,'support arm supports the bottom of the upright rail');
const rackProfiles=part('rack-frame').group.children.filter(o=>o.userData.extrusion);
assert.equal(rackProfiles.filter(o=>o.userData.extrusion.length>6).length,2,'rack has two upper longitudinal rails and open lower spans');
assert.ok(rackProfiles.every(o=>o.userData.extrusion.width===.04),'rack uses single-cell sections');
assert.ok(part('panel-0').group.children[0].material[2].map.isDataTexture,'light worktop uses one efficient perforation texture');
for(let i=0;i<3;i++)assert.equal(part('rack-pipe-'+i).group.children.filter(o=>o.name==='Blue coupling witness mark').every(o=>o.geometry.type==='ExtrudeGeometry'),true,'coupling marks are open rings, not solid caps');
assert.ok(part('bar-top-plate'));assert.ok(part('table-foot-angles'));
for(const p of upper)assert.ok(Math.abs(bounds(p.id).min.y-.9)<1e-6,'upper wheel touches work surface');
const states=[0,4,9,15,22,28].map(t=>{
 const state=m.pose(t);
 for(const [suffix,side] of [['left',-1],['right',1]]){
  const wheel=part('side-guide-wheel-'+suffix),b=bounds(wheel.id),contact=side>0?b.min.x:b.max.x;
  assert.ok(Math.abs(contact-side*PLANT_FACTS.tableEdgeHalf)<.0001,'guide wheel stays against the metal table edge');
  assert.ok(b.min.y>.84&&b.max.y<.9,'guide wheel contacts the table edge below its surface');
  const drop=bounds('bar-drop-'+side*3.05);assert.ok(side>0?drop.min.x>b.max.x:drop.max.x<b.min.x,'wheel clears the vertical guide');
  const position=wheel.group.getWorldPosition(new Vector3());assert.ok(Math.abs(position.z-state.barZ)<1e-6,'side wheels travel with the bar');
 }
 return state;
});assert.ok(states[0].barZ<states.at(-1).barZ);assert.equal(states.at(-1).step.id,'hold');assert.equal(PLANT_STEPS.at(-1).end,m.duration);
// Positive X rotation moves the top tangent toward +Z, the table/feed direction.
assert.ok(Math.abs(part('film-roll-0').group.rotation.x*.115-5.43)<1e-9);
// Tape leaves the bottom of the rear reel, so it turns the opposite direction.
assert.ok(Math.abs(part('tape-roll-0').group.rotation.x*.085+5.43)<1e-9);
assert.ok(part('side-guide-wheel-right').group.rotation.y>0&&part('side-guide-wheel-left').group.rotation.y<0);
let triangles=0;const geometries=new Set();m.root.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(const value of p.array)assert.ok(Number.isFinite(value));geometries.add(o.geometry);triangles+=(o.geometry.index?.count||p.count)/3;});
assert.ok(m.pickable.every(o=>part(o.userData.plantPartId)));assert.ok(m.pickable.length<450);assert.ok(triangles<75000);
console.log(JSON.stringify({plantParts:m.parts.length,pickableMeshes:m.pickable.length,uniqueGeometries:geometries.size,triangles,checks:'layout, staggered rolls, tape alignment, animation, finite geometry and render budget passed'}));
