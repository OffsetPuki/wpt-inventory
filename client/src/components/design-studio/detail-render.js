import {BoxGeometry,Vector3} from 'three';

// Omit subpixel hardware only for the current render. Restore source visibility
// immediately so picking, isolation, drawings, and animation keep exact geometry.
export function createDetailRender(renderer,modelRoot){
 const pieces=[];modelRoot.traverse(o=>{if(o.isMesh&&o.userData.shopPartId){if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();pieces.push(o);}});
 const center=new Vector3(),eye=new Vector3(),size=new Vector3(),boxes=new Map();
 const draw=(scene,camera)=>{
  scene.updateMatrixWorld();camera.updateMatrixWorld();eye.setFromMatrixPosition(camera.matrixWorld);
  const scale=renderer.domElement.clientHeight/(2*Math.tan(camera.fov*Math.PI/360)),hidden=[],replaced=[];
  if(modelRoot.visible)for(const mesh of pieces){
   if(!mesh.visible)continue;const sphere=mesh.geometry.boundingSphere;if(!sphere)continue;
   center.copy(sphere.center).applyMatrix4(mesh.matrixWorld);const radius=sphere.radius*mesh.matrixWorld.getMaxScaleOnAxis(),distance=Math.max(camera.near,center.distanceTo(eye)-radius);
   if(radius*scale/distance<.8){hidden.push(mesh);mesh.visible=false;continue;}
   const geometry=mesh.geometry;
   if((geometry.index?.count||geometry.attributes.position.count)>768){
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    geometry.boundingBox.getSize(size);
    // Only narrow profiles qualify: a broad plate keeps its actual outline,
    // holes and curves even if its thickness is tiny. At close range all
    // geometry is restored. Isolated parts always use the exact source mesh.
    const crossSection=size.toArray().sort((a,b)=>a-b)[1];
    if(crossSection*mesh.matrixWorld.getMaxScaleOnAxis()*scale/distance<4){
     let box=boxes.get(geometry);
     if(!box){geometry.boundingBox.getCenter(center);box=new BoxGeometry(size.x,size.y,size.z);box.translate(center.x,center.y,center.z);boxes.set(geometry,box);}
     replaced.push([mesh,geometry]);mesh.geometry=box;
    }
   }
  }
  try{renderer.render(scene,camera);}finally{for(const mesh of hidden)mesh.visible=true;for(const [mesh,geometry] of replaced)mesh.geometry=geometry;}
 };
 draw.dispose=()=>{for(const geometry of boxes.values())geometry.dispose();boxes.clear();};
 return draw;
}
