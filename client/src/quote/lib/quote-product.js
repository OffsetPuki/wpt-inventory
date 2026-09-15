import * as THREE from 'three';
import {copyProduct} from './product-studio.js';
import {PIPE_OD} from './tradeMath.js';
export async function buildQuoteProduct(type,s,mode='shell'){
 if(type==='barndominium'){
  const {createHomeViewer}=await import('./barndominium/home3d.js');const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;width:800px;height:500px';document.body.append(host);let viewer;
  try{viewer=createHomeViewer(host,s);if(!viewer)throw new Error('3D is unavailable.');if(mode==='frame')viewer.update(s,'frame');return copyProduct([viewer.getProduct()]);}finally{viewer?.destroy();host.remove();}
 }
 const group=new THREE.Group(),steel=new THREE.MeshStandardMaterial({color:'#999d9f',metalness:.35,roughness:.5});
 if(type==='concrete'){const mesh=new THREE.Mesh(new THREE.BoxGeometry(Number(s.widthFt),Number(s.thickness)/12,Number(s.lengthFt)),new THREE.MeshStandardMaterial({color:'#bebdb9',roughness:.95}));mesh.position.y=Number(s.thickness)/24;group.add(mesh);}
 else if(type==='insulation'){
  const pipe=s.system==='pipe',radius=pipe?Number(PIPE_OD[s.nps]||s.nps)/24:Number(s.diaFt)/2,thickness=Number(s.thickness)/12,length=pipe?Math.min(Number(s.lengthFt),Math.max(3,radius*8)):Number(s.heightFt);
  const shell=new THREE.Mesh(new THREE.CylinderGeometry(radius+thickness,radius+thickness,length,48,1,true),steel);const core=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,48,1,true),new THREE.MeshStandardMaterial({color:'#555b60',side:THREE.DoubleSide}));const ends=new THREE.Mesh(new THREE.RingGeometry(radius,radius+thickness,48),new THREE.MeshStandardMaterial({color:'#d6cba3',side:THREE.DoubleSide}));ends.rotation.x=-Math.PI/2;ends.position.y=length/2;group.add(shell,core,ends);if(pipe||s.system==='autoclave')group.rotation.z=Math.PI/2;
 }else throw new Error('This product has no 3D model.');
 const result=copyProduct([group]);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return result;
}
