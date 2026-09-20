import {containViewerMouse} from './viewer-mouse.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
export function copyProduct(sources){
 const group=new THREE.Group();
 for(const root of sources){root.updateWorldMatrix(true,true);root.traverseVisible(o=>{
  if(!o.isMesh)return;let visible=true;for(let p=o.parent;p;p=p.parent)if(!p.visible)visible=false;if(!visible)return;
  const count=o.isInstancedMesh?o.count:1;
  for(let i=0;i<count;i++){const matrix=o.matrixWorld.clone();if(o.isInstancedMesh){const instance=new THREE.Matrix4();o.getMatrixAt(i,instance);matrix.multiply(instance);}
   const geometry=o.geometry.clone();geometry.applyMatrix4(matrix);
   if(matrix.determinant()<0){if(geometry.index){const a=geometry.index.array;for(let j=0;j<a.length;j+=3)[a[j],a[j+2]]=[a[j+2],a[j]];}else{const index=Array.from({length:geometry.attributes.position.count},(_,n)=>n);for(let j=0;j<index.length;j+=3)[index[j],index[j+2]]=[index[j+2],index[j]];geometry.setIndex(index);}}
   geometry.userData={};const materials=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{const c=m.clone();c.userData={};return c;});const mesh=new THREE.Mesh(geometry,Array.isArray(o.material)?materials:materials[0]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
 });}
 if(!group.children.length)throw new Error('No 3D product is available.');
 const bounds=new THREE.Box3().setFromObject(group),center=bounds.getCenter(new THREE.Vector3());group.position.set(-center.x,-bounds.min.y,-center.z);group.updateMatrixWorld(true);return group;
}
export async function exportProduct(group,frame=null){
 let exported=group.clone(true);
 if(frame){const shell=exported;exported=new THREE.Group();shell.name='CJM_Finished';const structure=frame.clone(true);structure.name='CJM_Frame';exported.add(shell,structure);}
 // Index duplicate vertices from material-batched meshes. Normals and UVs
 // participate in the merge, preserving hard edges and texture seams.
 const owned=[];
 try{
  exported.traverse(o=>{if(o.isMesh){o.geometry=mergeVertices(o.geometry,1e-6);owned.push(o.geometry);}});
  const result=await new GLTFExporter().parseAsync(exported,{binary:true,onlyVisible:true});
  if(!(result instanceof ArrayBuffer))throw new Error('Could not export the model.');return result;
 }finally{owned.forEach(g=>g.dispose());}
}
export function disposeProduct(group){group?.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])m.dispose();});}
export function createProductStudio(host){
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;host.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#f2f0e9');const camera=new THREE.PerspectiveCamera(38,1,.01,5000),controls=new OrbitControls(camera,renderer.domElement);const releaseMouse=containViewerMouse(renderer.domElement);controls.maxPolarAngle=Math.PI/2-.01;controls.enableDamping=false;controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;
 scene.add(new THREE.HemisphereLight(0xffffff,0x888888,2.4));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-10,20,15);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.normalBias=.03;light.shadow.bias=-.0005;scene.add(light,light.target);
 // Paint the decorative floor first without writing depth; shadows still test against the product.
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(10000,10000),new THREE.ShadowMaterial({opacity:.22,depthWrite:false}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);const base=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:'#ded9cc',toneMapped:false,depthWrite:false}));base.renderOrder=-1;base.rotation.x=-Math.PI/2;base.position.y=-.016;scene.add(base);let product=null,key='';
 const draw=()=>renderer.render(scene,camera);const resize=()=>{const w=host.clientWidth||800,h=host.clientHeight||450;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();draw();};const observer=new ResizeObserver(resize);observer.observe(host);controls.addEventListener('change',draw);
 function setProduct(next){if(product){scene.remove(product);disposeProduct(product);}product=next;scene.add(next);const b=new THREE.Box3().setFromObject(next),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());const shape=size.toArray().map(n=>n.toFixed(2)).join(',');const radius=Math.max(1,size.length());base.scale.set(Math.max(size.x*1.3,2),Math.max(size.z*1.3,size.x*.35,2),1);base.position.set(center.x,-.016,center.z);
  light.position.copy(center).add(new THREE.Vector3(-radius,radius*1.5,radius));light.target.position.copy(center);Object.assign(light.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:.1,far:radius*5});light.shadow.camera.updateProjectionMatrix();
  // Preserve slab/ground depth separation throughout the allowed zoom range.
  camera.near=Math.max(.01,radius*.01);camera.far=Math.max(100,radius*12);camera.updateProjectionMatrix();
  if(shape!==key){key=shape;controls.minDistance=radius*.08;controls.maxDistance=radius*8;fit();}else resize();
 }
 function fit(){
  if(!product)return;resize();
  const box=new THREE.Box3().setFromObject(product),center=box.getCenter(new THREE.Vector3());
  const direction=new THREE.Vector3(.6,.4,1).normalize(),right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
  const vertical=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),horizontal=vertical*camera.aspect;let distance=0;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const v=new THREE.Vector3(x,y,z).sub(center);distance=Math.max(distance,v.dot(direction)+Math.max(Math.abs(v.dot(right))/horizontal,Math.abs(v.dot(up))/vertical));}
  controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,Math.max(controls.minDistance,distance*1.12));controls.update();draw();
 }
 function zoom(factor){const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();draw();}
 return {setProduct,fit,zoom,exportModel:(frame=null)=>exportProduct(product,frame),destroy(){observer.disconnect();releaseMouse();controls.dispose();disposeProduct(product);floor.geometry.dispose();floor.material.dispose();base.geometry.dispose();base.material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
