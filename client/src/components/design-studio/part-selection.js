import * as T from 'three';

export function makePartIndex(root){
 root.updateMatrixWorld(true);const entries=[],instances=new Map(),parts=new Map();
 root.traverse(mesh=>{if(!mesh.isMesh||!mesh.userData.shopPartId)return;const {shopPartId:id,shopInstanceId:instance}=mesh.userData;
  const entry={mesh,id,instance,box:new T.Box3().setFromObject(mesh)};entries.push(entry);
  if(!instances.has(instance))instances.set(instance,[]);instances.get(instance).push(mesh);
  if(!parts.has(id))parts.set(id,[]);parts.get(id).push(entry);
 });
 const point=new T.Vector3();
 return {entries,instances,parts,pick(raycaster){
  const candidates=[];
  for(const e of entries){let visible=true;for(let o=e.mesh;o;o=o.parent)if(!o.visible){visible=false;break;}if(!visible)continue;
   if(raycaster.ray.intersectBox(e.box,point))candidates.push({entry:e,distance:e.box.containsPoint(raycaster.ray.origin)?0:raycaster.ray.origin.distanceTo(point)});
  }
  candidates.sort((a,b)=>a.distance-b.distance);let closest=null;let checked=0;
  for(const c of candidates){if(closest&&c.distance>closest.distance+1e-5)break;checked++;const hit=raycaster.intersectObject(c.entry.mesh,false)[0];if(hit&&(!closest||hit.distance<closest.distance))closest={...hit,...c.entry};}
  return {hit:closest,checked,candidates:candidates.length};
 }};
}
export function isolatedPart(index,id,instance){
 const entry=index.parts.get(id)?.find(e=>!instance||e.instance===instance);if(!entry)return null;
 const group=new T.Group();for(const mesh of index.instances.get(entry.instance)){const geometry=mesh.geometry.clone();geometry.applyMatrix4(new T.Matrix4().fromArray(mesh.userData.shopToDrawing));geometry.computeBoundingBox();geometry.computeBoundingSphere();const isolated=new T.Mesh(geometry,mesh.material);isolated.userData.originalMaterial=mesh.material;group.add(isolated);}return {group,instance:entry.instance};
}
