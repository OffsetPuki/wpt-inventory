import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {createPlantFilmModel,PLANT_FACTS,PLANT_STEPS} from '../client/src/components/design-studio/plant-film-model.js';
const m=createPlantFilmModel(),part=id=>m.parts.find(p=>p.id===id),bounds=id=>new Box3().setFromObject(part(id).group);
assert.equal(PLANT_FACTS.tableSize,6);
assert.equal(new Set(m.parts.map(p=>p.id)).size,m.parts.length);
assert.equal(m.parts.filter(p=>p.id.startsWith('rack-pipe-')).length,3);
assert.equal(m.parts.filter(p=>p.id.startsWith('film-roll-')).length,6);
assert.equal(m.parts.filter(p=>p.id.startsWith('tape-roll-')).length,5);
assert.equal(m.parts.filter(p=>p.id.startsWith('caster-')).length,6);
for(let i=0;i<6;i++){
 const roll=part('film-roll-'+i).group,pipe=part('rack-pipe-'+(i%2)).group;
 assert.ok(Math.abs(roll.position.z-new Box3().setFromObject(pipe).getCenter(new Vector3()).z)<1e-6);
 if(i<5){const next=part('film-roll-'+(i+1));assert.ok(roll.position.z!==next.group.position.z);assert.ok(bounds('film-roll-'+i).max.x>bounds(next.id).min.x);}
}
for(let i=0;i<5;i++){
 const seam=part('tape-roll-'+i).group;
 assert.ok(Math.abs(seam.position.x-(part('film-roll-'+i).group.position.x+part('film-roll-'+(i+1)).group.position.x)/2)<1e-6);
 assert.ok(seam.position.z>part('film-roll-1').group.position.z);
}
const rack=bounds('rack-frame'),table=bounds('table');assert.ok(rack.max.z<table.min.z-.5,'rack separated from table');
for(const id of ['caster-2.83--1','caster-2.83-1'])assert.ok(Math.abs(bounds(id).min.y-.9)<1e-6,'wheel touches work surface');
const states=[0,4,9,15,22,28].map(t=>m.pose(t));assert.ok(states[0].barZ<states.at(-1).barZ);assert.equal(states.at(-1).step.id,'hold');assert.equal(PLANT_STEPS.at(-1).end,m.duration);
let triangles=0;const geometries=new Set();m.root.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(const value of p.array)assert.ok(Number.isFinite(value));geometries.add(o.geometry);triangles+=(o.geometry.index?.count||p.count)/3;});
assert.ok(m.pickable.every(o=>part(o.userData.plantPartId)));assert.ok(m.pickable.length<400);assert.ok(triangles<150000);
console.log(JSON.stringify({plantParts:m.parts.length,pickableMeshes:m.pickable.length,uniqueGeometries:geometries.size,triangles,checks:'layout, staggered rolls, tape alignment, animation, finite geometry and render budget passed'}));
