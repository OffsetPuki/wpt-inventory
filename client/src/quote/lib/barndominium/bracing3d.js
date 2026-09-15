import * as THREE from 'three';

// Typical arrangement only, following Mueller Prefab Manual C-6, C-12–C-17.
// No capacities, cable diameters or restraint spacing are specified by this model.
export function addFrameBracing(s,ctx){
 const {group,material,scale,W,D,H,zs,inset,axisY,rafterBottom,purlins,taperGradient,baseT}=ctx;
 const result={roof:0,wall:0,flange:0,restraint:0,blockedWalls:[]};
 // NBG FBE formed-angle section; connection length still follows this model.
 // https://www.nucorsteelstore.com/pd/Part%20PDF/NBG/FBE__.pdf
 const flangeSection={width:2.5/12,t:.105/12};
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
 // Bent angle ends bear directly on steel. Dimensions/locations remain illustrative.
 group.updateMatrixWorld(true);
 const steel=group.children.filter(o=>o.isMesh&&['column','rafter','cee','zee','girt-web'].includes(o.userData.memberKind));
 const v=a=>new THREE.Vector3(...a);
 function surface(point,normal,targets,range=1){
  const n=v(normal).normalize(),p=v(point),ray=new THREE.Raycaster(p.clone().addScaledVector(n,range),n.clone().negate(),0,range*2);
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
 function bolt(point,normal,grip=.08,length=grip+.1){
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
  for(const [r,h,d,sides,name] of [[.5/24,length,.025-length/2,10,'Brace bolt'],[.047,.012,.022,16,'Brace washer'],[.047,.012,-grip-.012,16,'Brace washer'],[.038,.035,.043,6,'Brace bolt head'],[.038,.035,-grip-.035,6,'Brace nut']]){
   const geo=new THREE.CylinderGeometry(r,r,h,sides);geo.applyQuaternion(q);geo.translate(...point.clone().addScaledVector(normal,d).toArray());geo.userData.part={name:name+' (illustrative)'};
   const mesh=new THREE.Mesh(geo,material);mesh.userData={memberKind:'bracing-hardware',connection:name,engineeringRequired:true};group.add(mesh);
  }
 }
 function attachment(mesh,face){
  mesh.userData.contact=face.p.toArray();mesh.userData.normal=face.n.toArray();mesh.userData.support=face.mesh.uuid;
 }
 function angle(a,b,normal,kind,{width=.125,t=.012}={}){
  const axis=b.clone().sub(a).normalize(),n=normal.clone().addScaledVector(axis,-normal.dot(axis)).normalize(),cross=axis.clone().cross(n).normalize(),length=a.distanceTo(b),mid=a.clone().add(b).multiplyScalar(.5);
  const face=box(mid,axis,cross,[length,width,t],kind);
  box(mid.clone().addScaledVector(cross,(width-t)/2).addScaledVector(n,(width-t)/2),axis,cross,[length,t,width],kind+' return leg');
  face.userData={...face.userData,memberKind:'bracing',a:a.toArray().map(x=>x*scale),b:b.toArray().map(x=>x*scale),bolted:true};
  face.geometry.userData.part.length=length*scale;
  return face;
 }
 function bentEnd(face,inner,normal,kind){
  const {t,width}=flangeSection,along=inner.clone().sub(face.p).projectOnPlane(face.n).normalize(),cross=along.clone().cross(face.n).normalize();
  const center=face.p.clone().addScaledVector(face.n,t/2);
  const end=box(center,along,cross,[.20,width,t],'Bolted brace end');attachment(end,face);
  bolt(face.p.clone().addScaledVector(face.n,t),face.n,t+face.thickness,2/12);
  // A formed end of the brace, not a separate projecting clip or swivel.
  const from=center.clone().addScaledVector(along,.10),axis=inner.clone().sub(from).normalize(),other=axis.clone().cross(normal).normalize();
  if(other.dot(cross)<0)other.negate();
  const points=[from.clone().addScaledVector(cross,-width/2),from.clone().addScaledVector(cross,width/2),inner.clone().addScaledVector(other,width/2),inner.clone().addScaledVector(other,-width/2)];
  const positions=[];for(const sign of [-1,1])for(const i of [0,1,2,0,2,3])positions.push(...points[i].clone().addScaledVector(i<2?face.n:normal,sign*t/2).toArray());
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,material.clone());mesh.material.side=THREE.DoubleSide;mesh.userData={memberKind:'bracing-hardware',connection:kind+' formed end',engineeringRequired:true};group.add(mesh);
 }
 function boltedLink(a,b,kind){
  if(!a||!b)return false;
  const toward=b.p.clone().sub(a.p),along=toward.clone().projectOnPlane(a.n).normalize();
  const start=a.p.clone().addScaledVector(a.n,.08).addScaledVector(along,.30),end=b.p.clone().addScaledVector(b.n,.08).addScaledVector(toward.clone().negate().projectOnPlane(b.n).normalize(),.20);
  const axis=end.clone().sub(start).normalize(),normal=b.n.clone().projectOnPlane(axis).normalize();
  const body=angle(start,end,normal,kind,flangeSection);
  Object.assign(body.geometry.userData.part,{section:[2.5,2.5,.105,.105].map(n=>n*scale),gauge:12,thickness:.105*scale,catalogUrl:'https://www.nucorsteelstore.com/pd/Part%20PDF/NBG/FBE__.pdf'});
  bentEnd(a,start,normal,kind);bentEnd(b,end,normal,kind);
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
  const z=zs[j];
  // Interior rafters brace into both adjacent bays; end rafters face inward.
  for(const direction of [j>0?-1:null,j<zs.length-1?1:null].filter(d=>d!==null)){
  const reach=Math.min(3.4375,Math.abs(zs[j+direction]-z)/3);
  for(const p of purlins){
   const slope=-p.side*s.pitch/12,cos=1/Math.hypot(1,slope),u=v([cos,slope*cos,0]).multiplyScalar(-p.side),web=v([p.x,p.y,z+direction*reach]).addScaledVector(u,-2.5/24);
   const x=web.x-u.x*.20;
   const a=surface([x,rafterBottom(x)+.04,z+direction*.20],[-slope*cos,cos,0],steel.filter(o=>o.userData.memberKind==='rafter'),.15);
   const b=surface(web.toArray(),u.clone().negate().toArray(),steel.filter(o=>o.userData.memberKind==='cee'));
   if(boltedLink(a,b,'Rafter flange brace'))result.flange++;
  }
  }
  const direction=j===zs.length-1?-1:1,reach=Math.min(3.4375,Math.abs(zs[j+direction]-z)/3);
  for(const wall of ['left','right']){
   const side=wall==='left'?1:-1,x=wall==='left'?inset:W-inset;
   const u=wall==='right'?z:D-z,v=wall==='right'?z+direction*reach:D-z-direction*reach;
   if(!clear(wall,Math.min(u,v),Math.max(u,v)))continue;
   const rows=[...new Set(group.children.filter(o=>o.userData.wall===wall&&o.userData.memberKind==='zee').map(o=>o.userData.girt?.y??o.userData.row).filter(Number.isFinite))];
   for(const row of rows){
    const y=row/scale;if(y<1.2||y>axisY(inset)-.5)continue;
    const inner=x+side*(9.73/24+taperGradient*(y-baseT));
    const a=surface([inner-side*.035,y,z+direction*.20],[-side,0,0],steel.filter(o=>o.userData.connection==='primary-column'),.15);
    const b=surface([wall==='left'?0:W,y-.18,z+direction*reach],[side,0,0],steel.filter(o=>o.userData.wall===wall&&['zee','girt-web'].includes(o.userData.memberKind)));
    if(boltedLink(a,b,'Column flange brace'))result.flange++;
   }
  }
 }
 // BE0210 arrangement: a continuous angle bears beneath the lower purlin
 // flanges. Displayed through-bolts are illustrative, not NBG's screw schedule.
 for(const {a,b} of bays)for(const side of [-1,1]){
  const row=purlins.filter(p=>p.side===side);
  const slope=-side*s.pitch/12,cos=1/Math.hypot(1,slope),up=v([-slope*cos,cos,0]),down=up.clone().negate(),targets=steel.filter(o=>o.userData.memberKind==='cee');
  const faces=row.map(p=>surface(v([p.x,p.y,(a+b)/2]).addScaledVector(up,-8/24).toArray(),down.toArray(),targets,.12)).filter(Boolean);
  if(faces.length<2)continue;
  const start=faces[0].p.clone().addScaledVector(down,.006),end=faces.at(-1).p.clone().addScaledVector(down,.006),axis=end.clone().sub(start).normalize();
  const body=angle(start.addScaledVector(axis,-.18),end.addScaledVector(axis,.18),down,'Purlin restraint angle');body.userData.bolted=false;
  for(const face of faces){bolt(face.p.clone().addScaledVector(down,.012),down,.012+face.thickness);const contact=new THREE.Object3D();contact.userData={connection:'Purlin restraint contact'};attachment(contact,face);group.add(contact);}
  result.restraint++;
 }
 group.userData.bracing=result;
 return result;
}

