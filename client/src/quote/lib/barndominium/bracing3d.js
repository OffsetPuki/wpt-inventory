import * as THREE from 'three';

// Typical arrangement only, following Mueller Prefab Manual C-6, C-12–C-17.
// No capacities, cable diameters or restraint spacing are specified by this model.
export function addFrameBracing(s,ctx){
 const {group,material,scale,W,D,H,zs,inset,axisY,rafterBottom,purlins,taperGradient,baseT}=ctx;
 const result={roof:0,wall:0,flange:0,restraint:0,blockedWalls:[]};
 function member(a,b,kind,{radius=.022,width,depth=.014}={}){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start),length=delta.length();
  if(length<.001)return;
  const geo=width?new THREE.BoxGeometry(width,length,depth):new THREE.CylinderGeometry(radius,radius,length,8);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
  geo.translate(...start.clone().add(end).multiplyScalar(.5).toArray());
  geo.userData.part={name:kind+' (illustrative)',length:length*scale};
  const mesh=new THREE.Mesh(geo,material);mesh.userData={memberKind:'bracing',connection:kind,a:a.map(v=>v*scale),b:b.map(v=>v*scale),engineeringRequired:true};group.add(mesh);return mesh;
 }
 function cable(a,b,kind){
  const mesh=member(a,b,kind);if(!mesh)return;
  const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b);
  // Enlarged tensioner sleeves and endpoint lugs are display geometry only.
  member(av.clone().lerp(bv,.16).toArray(),av.clone().lerp(bv,.20).toArray(),'Brace tensioner',{radius:.065});
  for(const [p,q] of [[av,bv],[bv,av]])member(p.toArray(),p.clone().lerp(q,.018).toArray(),'Brace end connection',{radius:.075});
  return mesh;
 }
 // NBG AG0010/AG0030 and BE0001: flange-to-secondary braces and
 // purlin restraint use bolted attachment faces, not floating line ends.
 // Clip envelopes below are illustrative, not those proprietary part sizes.
 group.updateMatrixWorld(true);
 const steel=group.children.filter(o=>o.isMesh&&['column','rafter','cee','zee','girt-web'].includes(o.userData.memberKind));
 const v=a=>new THREE.Vector3(...a);
 function surface(point,normal,targets){
  const n=v(normal).normalize(),p=v(point),ray=new THREE.Raycaster(p.clone().addScaledVector(n,1),n.clone().negate(),0,2);
  const hit=ray.intersectObjects(targets,false)[0];
  if(!hit)return null;
  const actual=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);if(actual.dot(n)<0)actual.negate();
  const reverse=new THREE.Raycaster(hit.point.clone().addScaledVector(actual,-.15),actual,0,.15).intersectObject(hit.object,false)[0];
  return {p:hit.point,n:actual,mesh:hit.object,thickness:reverse?Math.max(.006,.15-reverse.distance):.035};
 }
 function box(center,x,y,size,name){
  const z=x.clone().cross(y).normalize(),geo=new THREE.BoxGeometry(...size);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(x,y,z));geo.translate(...center.toArray());
  geo.userData.part={name:name+' (illustrative)'};
  const mesh=new THREE.Mesh(geo,material);mesh.userData={memberKind:'bracing-hardware',connection:name,engineeringRequired:true,attachment:'bolted'};group.add(mesh);return mesh;
 }
 function bolt(point,normal,grip=.08){
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
  for(const [r,h,d,sides,name] of [[.021,grip+.1,-grip/2,10,'Brace bolt'],[.047,.012,.022,16,'Brace washer'],[.047,.012,-grip-.012,16,'Brace washer'],[.038,.035,.043,6,'Brace bolt head'],[.038,.035,-grip-.035,6,'Brace nut']]){
   const geo=new THREE.CylinderGeometry(r,r,h,sides);geo.applyQuaternion(q);geo.translate(...point.clone().addScaledVector(normal,d).toArray());geo.userData.part={name:name+' (illustrative)'};
   const mesh=new THREE.Mesh(geo,material);mesh.userData={memberKind:'bracing-hardware',connection:name,engineeringRequired:true};group.add(mesh);
  }
 }
 function clip(face,toward,extension=0){
  const {p,n}=face,t=.02,along=toward.clone().addScaledVector(n,-toward.dot(n));
  if(along.length()<.001)along.set(0,0,1);along.normalize();
  const cross=along.clone().cross(n).normalize(),foot=box(p.clone().addScaledVector(n,t/2),along,cross,[.22,.20,t],'Bolted brace foot');
  foot.userData.contact=p.toArray();foot.userData.normal=n.toArray();foot.userData.support=face.mesh.uuid;
  bolt(p.clone().addScaledVector(n,t),n,t+face.thickness);
  const pin=p.clone().addScaledVector(n,.12).addScaledVector(along,extension),root=p.clone().addScaledVector(n,.02);
  const axis=pin.clone().sub(root).normalize(),length=pin.distanceTo(root);
  box(root.clone().add(pin).multiplyScalar(.5),axis,cross,[length+.12,.02,.13],'Brace clip tab');
  bolt(pin,cross,.04);
  return {pin,normal:cross};
 }
 function boltedLink(a,b,kind,extension=0){
  if(!a||!b)return false;
  const start=a.p.clone().addScaledVector(a.n,.12),end=b.p.clone().addScaledVector(b.n,.12);
  // Offset primary-frame clips beyond the flange edge before the brace rises.
  const toward=end.clone().sub(start);
  const c=clip(a,toward,extension),d=clip(b,toward.clone().negate());
  const body=member(c.pin.toArray(),d.pin.toArray(),kind,{width:.09,depth:.02});
  body.userData.bolted=true;
  return true;
 }
 const clear=(wall,a,b)=>!s.openings.some(o=>o.wall===wall&&Math.max(a,o.x/scale-.65)<Math.min(b,(o.x+o.width)/scale+.65));
 const bays=zs.slice(1).map((b,i)=>({i,a:zs[i],b}));
 const available=wall=>bays.filter(({a,b})=>clear(wall,wall==='right'?a:D-b,wall==='right'?b:D-a));
 const right=available('right'),left=available('left'),shared=right.find(b=>left.some(l=>l.i===b.i));
 const roofBays=new Set();
 for(const wall of ['left','right']){
  const bay=shared??available(wall)[0];
  if(!bay){result.blockedWalls.push(wall);continue;}
  roofBays.add(bay.i);
  const x=wall==='left'?inset:W-inset,low=baseT+.18,high=axisY(inset)-.4;
  for(const [a,b] of [[bay.a,bay.b],[bay.b,bay.a]]){
   const mesh=cable([x,low,a],[x,high,b],'Wall X-brace cable');if(mesh){mesh.userData.wall=wall;result.wall++;}
  }
 }
 for(const i of roofBays){
  const {a,b}=bays[i];
  for(const side of [-1,1]){
   const x0=side<0?inset+.7:W-inset-.7,x1=W/2+side*.4;
   for(const [za,zb] of [[a,b],[b,a]]){
    cable([x0,axisY(x0)+.18,za],[x1,axisY(x1)+.18,zb],'Roof X-brace cable');result.roof++;
   }
  }
 }
 // Short angle braces connect rafter lower flanges to adjacent purlin webs.
 // Mirror along the roof and use the available side of each frame station.
 for(let j=0;j<zs.length;j++){
  const z=zs[j],direction=j===zs.length-1?-1:1,reach=Math.min(1.1,Math.abs(zs[j+direction]-z)/4);
  for(const p of purlins){
   const slope=-p.side*s.pitch/12,cos=1/Math.hypot(1,slope),u=v([cos,slope*cos,0]).multiplyScalar(-p.side),web=v([p.x,p.y,z+direction*reach]).addScaledVector(u,-2.5/24);
   const x=web.x-u.x*.20;
   const a=surface([x,rafterBottom(x),z+direction*.12],[0,-1,0],steel.filter(o=>o.userData.memberKind==='rafter'));
   const b=surface(web.toArray(),u.clone().negate().toArray(),steel.filter(o=>o.userData.memberKind==='cee'));
   if(boltedLink(a,b,'Rafter flange brace',.43))result.flange++;
  }
  for(const wall of ['left','right']){
   const side=wall==='left'?1:-1,x=wall==='left'?inset:W-inset;
   const u=wall==='right'?z:D-z,v=wall==='right'?z+direction*reach:D-z-direction*reach;
   if(!clear(wall,Math.min(u,v),Math.max(u,v)))continue;
   const rows=[...new Set(group.children.filter(o=>o.userData.wall===wall&&o.userData.memberKind==='zee').map(o=>o.userData.girt?.y??o.userData.row).filter(Number.isFinite))];
   for(const row of rows){
    const y=row/scale;if(y<1.2||y>axisY(inset)-.5)continue;
    const inner=x+side*(9.73/24+taperGradient*(y-baseT));
    const a=surface([inner,y,z+direction*.13],[side,0,0],steel.filter(o=>o.userData.connection==='primary-column'));
    const b=surface([wall==='left'?0:W,y-.18,z+direction*reach],[side,0,0],steel.filter(o=>o.userData.wall===wall&&['zee','girt-web'].includes(o.userData.memberKind)));
    if(boltedLink(a,b,'Column flange brace',.48))result.flange++;
   }
  }
 }
 // Paired mid-bay straps restrain the CEE webs on each roof slope separately.
 // Final number of restraint lines and their anchorage come from engineering.
 for(const {a,b} of bays)for(const side of [-1,1]){
  const row=purlins.filter(p=>p.side===side);
  for(const offset of [-.25,.25])for(let i=1;i<row.length;i++){
   const p=row[i-1],q=row[i],z=(a+b)/2+offset;
   const slope=-side*s.pitch/12,cos=1/Math.hypot(1,slope),u=v([cos,slope*cos,0]).multiplyScalar(-side),dir=Math.sign(q.x-p.x);
   const web=p=>v([p.x,p.y,z]).addScaledVector(u,-2.5/24);
   const targets=steel.filter(o=>o.userData.memberKind==='cee');
   const first=surface(web(p).toArray(),[dir*cos,dir*slope*cos,0],targets),last=surface(web(q).toArray(),[-dir*cos,-dir*slope*cos,0],targets);
   if(boltedLink(first,last,'Purlin restraint strap'))result.restraint++;
  }
 }
 group.userData.bracing=result;
 return result;
}

