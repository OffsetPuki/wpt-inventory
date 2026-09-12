import * as THREE from 'three';
import {framePositions,WALLS} from './model.js';
import {wallPoint} from './drawing.js';
import {wallFramingLayout} from './wall-framing.js';

// Schematic sections, centered on the member axis. Dimensions here only define
// the preview, not engineering sizes. Width/depth must be included in clearances.
function section(kind){
 const d=.65,w=.32,t=.045;
 const points=kind==='cee'?[[0,0],[w,0],[w,t],[t,t],[t,d-t],[w,d-t],[w,d],[0,d]]:
 kind==='zee'?[[0,0],[w,0],[w,d-t],[2*w-t,d-t],[2*w-t,d],[w-t,d],[w-t,t],[0,t]]:
 [[-w,-d/2],[w,-d/2],[w,-d/2+t],[t,-d/2+t],[t,d/2-t],[w,d/2-t],[w,d/2],[-w,d/2],[-w,d/2-t],[-t,d/2-t],[-t,-d/2+t],[-w,-d/2+t]];
 const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();return shape;
}
export function memberGeometry(a,b,kind='ibeam',size=.5,up=[0,1,0],scale=1){
 const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),axis=end.clone().sub(start),length=axis.length();
 if(length<.001)return null;
 const geo=kind==='post'?new THREE.BoxGeometry(size*scale,size*scale,length):new THREE.ExtrudeGeometry(section(kind),{depth:length,bevelEnabled:false,steps:1});
 if(kind!=='post'){
  geo.computeBoundingBox();const box=geo.boundingBox;
  geo.translate(-(box.min.x+box.max.x)/2,-(box.min.y+box.max.y)/2,-length/2);geo.scale(scale,scale,1);
 }
 axis.normalize();let reference=new THREE.Vector3(...up);
 if(Math.abs(axis.dot(reference.clone().normalize()))>.99)reference=new THREE.Vector3(0,0,1);
 const x=reference.cross(axis).normalize(),y=axis.clone().cross(x).normalize();
 geo.applyMatrix4(new THREE.Matrix4().makeBasis(x,y,axis));
 geo.translate(...start.add(end).multiplyScalar(.5).toArray());
 return geo;
}

// One continuous casing instead of centerline beams with missing outer corners.
// Coordinates follow the opening's wall: X along it, Y up, Z toward the outside.
export function openingFrameGeometry(o){
 const half=Math.min(.125,o.width/4,o.height/4),w=o.width,h=o.height,shape=new THREE.Shape();
 const outline=o.kind==='window'?
  [[-half,-half],[w+half,-half],[w+half,h+half],[-half,h+half]]:
  [[-half,0],[half,0],[half,h-half],[w-half,h-half],[w-half,0],[w+half,0],[w+half,h+half],[-half,h+half]];
 outline.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
 if(o.kind==='window'){
  const hole=new THREE.Path();hole.moveTo(half,half);hole.lineTo(half,h-half);hole.lineTo(w-half,h-half);hole.lineTo(w-half,half);hole.closePath();shape.holes.push(hole);
 }
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:.25,bevelEnabled:false,steps:1});
 geometry.translate(o.x,o.sill,.015);return geometry;
}

export function buildWallFraming(s,wall){
 const layout=wallFramingLayout(s,wall),{scale,depth,t,frames,girts}=layout,members=[];
 const front=-.002,center=front-depth/2,webThickness=.045*scale;
 const add=(geo,kind,extra={})=>{
  const p=geo.attributes.position;
  for(let i=0;i<p.count;i++)p.setXYZ(i,...wallPoint(s,wall,p.getX(i),p.getY(i),p.getZ(i)));
  // Wall-local outward coordinates reflect the mesh; preserve outward winding.
  if(geo.index){const indices=geo.index.array;for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];}
  else for(const attr of Object.values(geo.attributes))for(let i=0;i<attr.count;i+=3)for(let k=0;k<attr.itemSize;k++){
   const a=(i+1)*attr.itemSize+k,b=(i+2)*attr.itemSize+k;[attr.array[a],attr.array[b]]=[attr.array[b],attr.array[a]];
  }
  geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();members.push({geometry:geo,kind,region:'main',wall,...extra});
 };
 const box=(a,b,kind,extra={})=>{if(b.some((v,i)=>v-a[i]<.0001))return;const g=new THREE.BoxGeometry(...b.map((v,i)=>v-a[i]));g.translate(...a.map((v,i)=>(v+b[i])/2));add(g,kind,extra);};
 const extrusion=(points,length,map,kind,extra={})=>{
  if(length<.0001)return;const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:length,steps:1,bevelEnabled:false}),p=g.attributes.position;
  for(let i=0;i<p.count;i++)p.setXYZ(i,...map(p.getX(i),p.getY(i),p.getZ(i)));add(g,kind,extra);
 };
 const channel=(width,d)=>[[0,0],[width,0],[width,-t],[t,-t],[t,-d+t],[width,-d+t],[width,-d],[0,-d]];
 const bolt=(position,normal,extra)=>{
  const axis=new THREE.Vector3(...normal),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis);
  for(const [radius,length,offset,sides] of [[.022*scale,.1*scale,-.03*scale,6],[.046*scale,.018*scale,.009*scale,8],[.037*scale,.035*scale,.035*scale,6]]){
   const g=new THREE.CylinderGeometry(radius,radius,length,sides);g.applyQuaternion(q);g.translate(...position.map((v,i)=>v+normal[i]*offset));add(g,'bolt',extra);
  }
 };
 const clip=(face,dir,y,up,run,height,seat,extra={})=>{
  const thick=.018*scale,d=.38*scale,z0=center-d/2,base=y+up*seat;
  if(run<.07*scale||height<.07*scale)return;
  extrusion([[0,0],[run,0],[run,thick],[thick,thick],[thick,height],[0,height]],d,
   (u,v,z)=>[face+dir*u,base+up*v,z0+z],'clip',extra);
  for(const z of [center-.1*scale,center+.1*scale]){
   bolt([face+dir*run*.65,base+up*thick,z],[0,up,0],extra);
   bolt([face+dir*thick,base+up*height*.65,z],[dir,0,0],extra);
  }
 };
 for(const f of frames){
  const o=f.opening,extra={opening:o.id};
  for(const j of f.jambs){
   extrusion(channel(j.width,depth),j.upper-j.lower,(u,z,y)=>[j.web+j.sign*u,j.lower+y,front+z],'jamb',extra);
   if(j.lower===0){
    box([Math.min(j.web,j.web+j.sign*j.width),0,front-depth],[Math.max(j.web,j.web+j.sign*j.width),t,front],'base',extra);
    clip(j.sign>0?j.hi:j.lo,j.sign,0,1,Math.min(j.width-t,.22*scale),.2*scale,t,extra);
   }
  }
  // Headers/sills fit between jamb webs, set inside their flanges. This is a
  // structural channel behind the separate exterior casing in home3d.js.
  const left=f.jambs[0].hi,right=f.jambs[1].lo,channelFront=front-t-.004*scale,channelDepth=depth-2*t-.008*scale;
  for(const [y,up,width,kind] of [[f.top,1,f.headWidth,'header'],...(o.kind==='window'&&f.sillWidth>0?[[o.sill,-1,f.sillWidth,'sill']]:[])]){
   extrusion(channel(width,channelDepth),right-left,(v,z,u)=>[left+u,y+up*v,channelFront+z],kind,extra);
   for(const [face,dir] of [[left,1],[right,-1]])clip(face,dir,y,up,Math.min(.3*scale,(right-left)/3),Math.min(width,.22*scale),t,extra);
  }
 }
 for(const girt of girts){
  const {a,b,y,copeStart,copeEnd}=girt,extra={girt:{a,b,y},opening:''};
  const start=a+copeStart,end=b-copeEnd;
  if(start<end){
   const g=memberGeometry([start,y,center],[end,y,center],'zee',.5,[0,0,1],scale);if(g)add(g,'zee',extra);
  }
  // At an inward-facing channel, only the web continues into the connection;
  // cope the ZEE flanges to avoid passing them through the jamb flanges.
  const stub=(lo,hi)=>box([lo,y-webThickness/2,front-depth+.045*scale],[hi,y+webThickness/2,front-.045*scale],'girt-web',extra);
  if(start>=end)stub(a,b);else{if(copeStart)stub(a,start);if(copeEnd)stub(end,b);}
  for(const joint of girt.joints){
   const j=joint.jamb,up=j.upper-y>=y-j.lower?1:-1,height=Math.min(.22*scale,up>0?j.upper-y-webThickness/2:y-j.lower-webThickness/2);
   clip(joint.face,joint.dir,y,up,Math.min(.32*scale,(b-a)*.4),height,webThickness/2,{opening:j.opening,connection:'girt-jamb',girt:{a,b,y}});
  }
 }
 return members;
}

export function buildFraming(s,{includeMain=true}={}){
 const members=[],W=s.width,D=s.depth,H=s.height,m=s.pitch/12;
 const scale=Math.min(1,W/4,D/4,H/4),inset=.4*scale,normalClearance=.365*scale,rafterClearance=1.03*scale;
 const roof=x=>H+Math.min(x,W-x)*m;
 const add=(a,b,kind='ibeam',up=[0,1,0],region='main',memberScale=scale,wall='')=>{
  const geometry=memberGeometry(a,b,kind,.5,up,memberScale);
  if(geometry)members.push({geometry,kind,region,wall});
 };
 if(includeMain){
 for(const z of framePositions(s).map(z=>Math.max(inset,Math.min(D-inset,z)))){
  for(const x of [inset,W-inset])add([x,0,z],[x,roof(x)-rafterClearance*Math.hypot(1,m),z],s.frame==='post'?'post':'ibeam');
  for(const [a,b,slope] of [[inset,W/2,m],[W/2,W-inset,-m]]){
   const drop=rafterClearance*Math.hypot(1,m);
   add([a,roof(a)-drop,z],[b,roof(b)-drop,z],'ibeam',[-slope,1,0]);
  }
 }
 // Keep edge/ridge purlins fully under the roof, with no duplicate at the ridge.
 const run=W/2-inset-.35*scale,rows=Math.max(1,Math.ceil(run*Math.hypot(1,m)/s.roofSpacing));
 for(let i=0;i<=rows;i++)for(const side of [0,1]){
  const distance=inset+run*i/rows,x=side?W-distance:distance,slope=side?-m:m,y=roof(x)-normalClearance*Math.hypot(1,m);
  add([x,y,inset],[x,y,D-inset],'cee',[-slope,1,0]);
 }
 for(const wall of WALLS)members.push(...buildWallFraming(s,wall));
 }
 for(const p of s.porches){
  const k=p.pitch/12,outer=p.height-p.depth*k,ps=Math.min(scale,p.width/2,p.depth/2,outer/2),edge=.4*ps;
  const roof=d=>p.height-d*k,wp=(u,y,d)=>wallPoint(s,p.wall,p.x+u,y,d),out=wp(0,0,1),base=wp(0,0,0),normal=[(out[0]-base[0])*k,1,(out[2]-base[2])*k];
  const addPorch=(a,b,kind='ibeam',up=[0,1,0])=>add(a,b,kind,up,p.id,ps);
  const n=Math.max(1,Math.ceil(p.width/10)),d=p.depth-edge;
  for(let i=0;i<=n;i++){
   const u=edge+(p.width-2*edge)*i/n;
   addPorch(wp(u,0,d),wp(u,roof(d)-1.03*ps*Math.hypot(1,k),d),'post');
   addPorch(wp(u,roof(edge)-1.03*ps*Math.hypot(1,k),edge),wp(u,roof(d)-1.03*ps*Math.hypot(1,k),d),'ibeam',normal);
  }
  // Outer beam and ledger sit below the purlins, not through the sheet.
  for(const depth of [edge,d])addPorch(wp(edge,roof(depth)-1.03*ps*Math.hypot(1,k),depth),wp(p.width-edge,roof(depth)-1.03*ps*Math.hypot(1,k),depth),'ibeam');
  const rows=Math.max(1,Math.ceil((p.depth-2*edge)/s.roofSpacing));
  for(let i=0;i<=rows;i++){const depth=edge+(p.depth-2*edge)*i/rows,y=roof(depth)-.365*ps*Math.hypot(1,k);addPorch(wp(edge,y,depth),wp(p.width-edge,y,depth),'cee',normal);}
 }
 return members;
}
