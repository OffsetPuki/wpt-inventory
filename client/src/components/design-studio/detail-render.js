import {Vector3} from 'three';

// Omit subpixel hardware only for the current render. Restore source visibility
// immediately so picking, isolation, drawings, and animation keep exact geometry.
export function createDetailRender(renderer,modelRoot){
 const pieces=[];modelRoot.traverse(o=>{if(o.isMesh&&o.userData.shopPartId){if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();pieces.push(o);}});
 const center=new Vector3(),eye=new Vector3();
 return(scene,camera)=>{
  scene.updateMatrixWorld();camera.updateMatrixWorld();eye.setFromMatrixPosition(camera.matrixWorld);
  const scale=renderer.domElement.clientHeight/(2*Math.tan(camera.fov*Math.PI/360)),hidden=[];
  if(modelRoot.visible)for(const mesh of pieces){
   if(!mesh.visible)continue;const sphere=mesh.geometry.boundingSphere;if(!sphere)continue;
   center.copy(sphere.center).applyMatrix4(mesh.matrixWorld);const radius=sphere.radius*mesh.matrixWorld.getMaxScaleOnAxis(),distance=Math.max(camera.near,center.distanceTo(eye)-radius);
   if(radius*scale/distance<.8){hidden.push(mesh);mesh.visible=false;}
  }
  try{renderer.render(scene,camera);}finally{for(const mesh of hidden)mesh.visible=true;}
 };
}
