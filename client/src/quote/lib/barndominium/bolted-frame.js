import * as THREE from 'three';
import {buildFraming,buildWallFraming} from './framing3d.js';
import {wallPoint} from './drawing.js';
import {framePositions,WALLS} from './model.js';

// Connection shapes are illustrative. These section envelopes reproduce the
// trial viewer; they are NOT a member schedule or an engineering calculation.
// All geometry is in feet. Exterior building dimensions remain the roof datum.
// Schematic endwall support layout, independent of the longitudinal frame bays.
// Actual member spacing/capacity must be determined for the project loads.
export function endwallColumnPositions(s,wall){
 if(!['front','back'].includes(wall)||s.width<12)return [];
 const k=Math.min(1,s.width/8,s.depth/8,s.height/5),edge=2.3*k,margin=.85*k;
 let bays=Math.max(3,Math.ceil(s.width/20));if(bays%2===0)bays++;
 const excluded=s.openings.filter(o=>o.wall===wall).map(o=>[o.x-margin,o.x+o.width+margin]);
 // Keep the cap on one sloping rafter, clear of the apex splice plates.
 excluded.push([s.width/2-.7*k,s.width/2+.7*k]);
 const valid=u=>u>=edge&&u<=s.width-edge&&!excluded.some(([a,b])=>u>a-1e-5&&u<b+1e-5);
 const result=[];
 for(let i=1;i<bays;i++){
  const desired=s.width*i/bays,candidates=[desired,...excluded.flatMap(([a,b])=>[a-.01*k,b+.01*k])].filter(valid).sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired));
  const u=candidates.find(u=>result.every(x=>Math.abs(x-u)>1.5*k));if(u!==undefined)result.push(u);
 }
 return result.sort((a,b)=>a-b);
}
export function buildBoltedFrame(s,materials){
 const group=new THREE.Group(),mats=materials.sections,hardwareMat=materials.hardware;
 const lineMat=new THREE.LineBasicMaterial();
 const scale=Math.min(1,s.width/8,s.depth/8,s.height/5),W=s.width/scale,D=s.depth/scale,H=s.height/scale,m=s.pitch/12;
 const roof=x=>H+Math.min(x,W-x)*m;
 const inset=.65+.02+9.73/24,zInset=.65+.02+7.96/24;
 const zs=framePositions(s).map(z=>Math.max(zInset,Math.min(D-zInset,z/scale)));
 const drop=(12.2/24+8/12+.05)*Math.hypot(1,m),axisY=x=>roof(x)-drop;
 const jointZ=zs.length>2?zs[Math.floor(zs.length/2)]:zs[0];
 const focus={overall:[W/2,H/2,D/2],front:[W/2,H/2,zs[0]],knee:[inset,axisY(inset),jointZ],ridge:[W/2,axisY(W/2),jointZ]};
 const counts={cee:0,zee:0,bases:0,anchors:0,endwallColumns:0,upperZee:0};
 // Exposed base hardware only. Embedded anchor length, footing and plate
 // sizing remain project-specific; these dimensions are display proportions.
 const baseT=.055;
 function columnBase(x,z,k=1,section='ibeam'){
  // Interior four-rod pattern for the I-column, with rods on both sides of
  // the web and between flanges. HSS posts retain exterior corner anchors.
  // Nucor 10.0.38 illustrates this arrangement; no capacity is inferred here.
  const halfX=section==='ibeam'?.525:.6,halfZ=section==='ibeam'?.475:.525;
  const boltX=section==='ibeam'?1/6:.49,boltZ=section==='ibeam'?1/6:.43;
  const shape=new THREE.Shape();shape.moveTo(-halfX,-halfZ);shape.lineTo(halfX,-halfZ);shape.lineTo(halfX,halfZ);shape.lineTo(-halfX,halfZ);shape.closePath();
  for(const dx of [-boltX,boltX])for(const dz of [-boltZ,boltZ]){const hole=new THREE.Path();hole.absarc(dx,dz,.042,0,Math.PI*2,true);shape.holes.push(hole);}
  const geo=new THREE.ExtrudeGeometry(shape,{depth:baseT,bevelEnabled:false,steps:1,curveSegments:12});geo.rotateX(-Math.PI/2);geo.scale(k,k,k);
  geo.userData.part={name:'Column base plate',dimensions:[halfX*2,baseT,halfZ*2].map(n=>n*k*scale*12)};
  const base=solid(group,geo,[x,0,z]);base.userData.connection='column-base';base.userData.section=section;counts.bases++;
  for(const dx of [-boltX,boltX])for(const dz of [-boltZ,boltZ]){
   for(const [radius,height,y,sides,part] of [[.03,.20,.10,12,'anchor-rod'],[.066,.018,baseT+.009,20,'anchor-washer'],[.055,.052,baseT+.044,6,'anchor-nut']]){
    const piece=solid(group,new THREE.CylinderGeometry(radius*k,radius*k,height*k,sides),[x+dx*k,y*k,z+dz*k]);piece.userData.connection=part;piece.geometry.userData.part={name:part.replaceAll('-',' '),diameter:radius*2*k*scale*12,length:height*k*scale};
   }
   counts.anchors++;
  }
  // Fillet-weld illustration around the column footprint. The chosen display
  // leg is not a weld schedule; the final weld is part of the connection design.
  const outline=section==='ibeam'?profile(0).getPoints().slice(0,-1).map(p=>[p.y,p.x]):[[-1/2.4,-1/2.4],[1/2.4,-1/2.4],[1/2.4,1/2.4],[-1/2.4,1/2.4]];
  const area=outline.reduce((sum,a,i)=>{const b=outline[(i+1)%outline.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
  for(let i=0;i<outline.length;i++){
   const a=outline[i],b=outline[(i+1)%outline.length],edge=new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]),length=edge.length();if(length<.001)continue;edge.normalize();
   const outward=new THREE.Vector3(edge.z,0,-edge.x).multiplyScalar(area>0?1:-1),up=new THREE.Vector3(0,1,0);
   let start=a,basis=new THREE.Matrix4().makeBasis(outward,up,edge);
   if(basis.determinant()<0){start=b;edge.negate();basis=new THREE.Matrix4().makeBasis(outward,up,edge);}
   const triangle=new THREE.Shape();triangle.moveTo(0,0);triangle.lineTo(.018,0);triangle.lineTo(0,.018);triangle.closePath();
   const weldGeometry=new THREE.ExtrudeGeometry(triangle,{depth:length,bevelEnabled:false,steps:1});weldGeometry.applyMatrix4(basis);weldGeometry.translate(start[0],baseT,start[1]);weldGeometry.scale(k,k,k);
   const weld=solid(group,weldGeometry,[x,0,z]);weld.userData.connection='column-base-weld';
  }
 }
 function seatPost(geometry){
  geometry.computeBoundingBox();const b=geometry.boundingBox,center=b.getCenter(new THREE.Vector3()),k=Math.max(b.max.x-b.min.x,b.max.z-b.min.z)*1.2;
  columnBase(center.x,center.z,k,'post');
  const p=geometry.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)<baseT*k)p.setY(i,baseT*k);
  geometry.computeBoundingBox();return [center.x,.2*k,center.z];
 }
 if(s.frame==='post'){
  let base;
  for(const member of buildFraming(s)){if(member.kind==='post'){const target=seatPost(member.geometry);base??=target;}group.add(new THREE.Mesh(member.geometry,member.kind==='bolt'?hardwareMat:member.kind==='cee'?mats[2]:member.kind==='zee'?mats[3]:mats[0]));}
  lineMat.dispose();return {group,focus:{overall:[s.width/2,s.height/2,s.depth/2],front:[s.width/2,s.height/2,0],...(base?{base}:{})},counts};
 }
function profile(kind){
  const d=(kind===0?9.73:kind===1?12.2:8)/12;
  const b=(kind===0?7.96:kind===1?6.49:2.5)/12;
  const tw=(kind===0?.29:kind===1?.23:.075)/12;
  const tf=(kind===0?.435:kind===1?.38:.075)/12;
  const h=d/2,w=b/2,lip=.75/12;
  const p=kind===3?[[-b,-h],[tw/2,-h],[tw/2,h-tw],[b-tw,h-tw],[b-tw,h-lip],[b,h-lip],[b,h],[-tw/2,h],[-tw/2,-h+tw],[-b+tw,-h+tw],[-b+tw,-h+lip],[-b,-h+lip]]:
    kind===2?[[-w,-h],[w,-h],[w,-h+lip],[w-tw,-h+lip],[w-tw,-h+tf],[-w+tw,-h+tf],[-w+tw,h-tf],[w-tw,h-tf],[w-tw,h-lip],[w,h-lip],[w,h],[-w,h]]:
    [[-w,-h],[w,-h],[w,-h+tf],[tw/2,-h+tf],[tw/2,h-tf],[w,h-tf],[w,h],[-w,h],[-w,h-tf],[-tw/2,h-tf],[-tw/2,-h+tf],[-w,-h+tf]];
  const shape=new THREE.Shape();p.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();return shape;
}
function beam(group,a,b,kind,up,cuts={}){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),axis=end.clone().sub(start),length=axis.length();axis.normalize();
  const x=new THREE.Vector3(...up).cross(axis).normalize(),y=axis.clone().cross(x).normalize();
  const geo=new THREE.ExtrudeGeometry(profile(kind),{depth:length,bevelEnabled:false,steps:1});
  const positions=geo.attributes.position;
  const ends=Array.from({length:positions.count},(_,i)=>positions.getZ(i)<length/2?'start':'end');
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(x,y,axis));geo.translate(...a);
  // Project both cap and adjoining side vertices onto their mating planes.
  // Square extrusion ends otherwise leave triangular gaps at sloped joints.
  for(let i=0;i<positions.count;i++){
    const cut=cuts[ends[i]];if(!cut)continue;
    const normal=new THREE.Vector3(...cut.normal),v=new THREE.Vector3().fromBufferAttribute(positions,i);
    v.addScaledVector(axis,(cut.constant-normal.dot(v))/normal.dot(axis));positions.setXYZ(i,v.x,v.y,v.z);
  }
  geo.computeVertexNormals();geo.computeBoundingBox();
  geo.userData.part={name:['I-column','I-rafter','CEE roof purlin','ZEE girt'][kind],section:[kind===0?9.73:kind===1?12.2:8,kind===0?7.96:kind===1?6.49:2.5,kind===0?.29:kind===1?.23:.075,kind===0?.435:kind===1?.38:.075].map(n=>n*scale),length:length*scale,...(kind<2&&scale===1?{designation:kind===0?'W10×33':'W12×26',weightPerFoot:kind===0?33:26,catalogUrl:'https://ami.arcelormittal.com/structural-shapes/product-size-range/'}:{}),...(kind===2&&scale===1?{gauge:14}:{})};
  const mesh=new THREE.Mesh(geo,mats[kind]);mesh.userData.memberKind=['column','rafter','cee','zee'][kind];group.add(mesh);
  return mesh;
}
// All plate thicknesses, bolt counts and spacings here are display geometry.
// They do not specify connection capacity or a fabrication/fastener schedule.
const plateT=.035, columnHalf=9.73/24, rafterHalf=12.2/24, roofCos=1/Math.hypot(1,m);
function solid(group,geo,position){
  const m=new THREE.Mesh(geo,hardwareMat);m.position.set(...position);group.add(m);
  return m;
}
function plate(group,position,size,basis){
  const geo=new THREE.BoxGeometry(...size);geo.userData.part={name:'Steel plate / tab',dimensions:size.map(n=>n*scale*12)};if(basis)geo.applyMatrix4(basis);return solid(group,geo,position);
}
function fastener(group,a,b,r=.025){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),axis=end.clone().sub(start),length=axis.length();axis.normalize();
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis);
  const cylinder=(radius,height,center,sides)=>{
    const g=new THREE.CylinderGeometry(radius,radius,height,sides);g.userData.part={name:'Bolt assembly',diameter:r*2*scale*12,grip:length*scale*12};g.applyQuaternion(q);solid(group,g,center.toArray());
  };
  cylinder(r,length+.075,start.clone().add(end).multiplyScalar(.5),10);
  for(const [p,s] of [[start,-1],[end,1]]){
    cylinder(r*1.7,.009,p.clone().addScaledVector(axis,s*.0045),16);
    cylinder(r*1.42,.027,p.clone().addScaledVector(axis,s*.0225),6);
  }
}
 for(const z of zs){
  for(const side of [-1,1]){
   const x=side<0?inset:W-inset,slope=-side*m,face=x-side*columnHalf;
   columnBase(x,z);
   beam(group,[x,baseT,z],[x,axisY(x),z],0,[1,0,0],{end:{normal:[-slope,1,0],constant:axisY(x)-slope*x+rafterHalf/roofCos}}).userData.connection='primary-column';
   const jointY=axisY(face);
   plate(group,[face-side*plateT/2,jointY,z],[plateT,2*rafterHalf/roofCos+.04,.68]);
   for(const dy of [-.33,.33])for(const dz of [-.21,.21])fastener(group,[face+side*.435/12,jointY+dy,z+dz],[face-side*plateT,jointY+dy,z+dz]);
  }
  const left=inset+columnHalf+plateT,right=W-left,mid=W/2;
  for(const [a,b,slope] of [[left,mid-plateT,m],[mid+plateT,right,-m]]){
   beam(group,[a,axisY(a),z],[b,axisY(b),z],1,[-slope,1,0],{start:{normal:[1,0,0],constant:a},end:{normal:[1,0,0],constant:b}});
  }
  for(const side of [-1,1])plate(group,[mid+side*plateT/2,axisY(mid),z],[plateT,2*rafterHalf/roofCos+.04,.68]);
  for(const dy of [-.33,.33])for(const dz of [-.21,.21])fastener(group,[mid-plateT,axisY(mid)+dy,z+dz],[mid+plateT,axisY(mid)+dy,z+dz]);
 }
 const endwallPositions=Object.fromEntries(['front','back'].map(wall=>[wall,endwallColumnPositions(s,wall).map(u=>u/scale)]));
 for(const wall of ['front','back'])for(const u of endwallPositions[wall]){
  const x=wall==='front'?u:W-u,z=wall==='front'?zs[0]:zs.at(-1),slope=x<W/2?m:-m,capT=.035;
  const underside=axisY(x)-rafterHalf/roofCos,top=underside-capT;
  columnBase(x,z);
  const column=beam(group,[x,baseT,z],[x,top,z],0,[1,0,0],{end:{normal:[-slope,1,0],constant:top-slope*x}});
  column.userData={connection:'endwall-column',wall,along:u*scale};counts.endwallColumns++;
  const capGeometry=new THREE.BoxGeometry(.86,capT,.68),p=capGeometry.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+slope*p.getX(i));capGeometry.computeVertexNormals();
  capGeometry.userData.part={name:'Sloped column cap plate',dimensions:[.86,capT,.68].map(n=>n*scale*12)};
  const cap=solid(group,capGeometry,[x,underside-capT/2,z]);cap.userData={connection:'endwall-rafter-cap',wall,along:u*scale};
  for(const dx of [-.22,.22])for(const dz of [-.16,.16]){
   const y=underside+slope*dx;fastener(group,[x+dx,y-capT,z+dz],[x+dx,y+.38/12/roofCos,z+dz],.019);
  }
 }
 focus.base=[inset,.2,zs[0]];
 function purlinCleat(x,y,z,slope,direction,facing){
  const u=new THREE.Vector3(1,slope,0).normalize().multiplyScalar(facing),v=new THREE.Vector3(-slope,1,0).normalize(),w=new THREE.Vector3(0,0,facing);
  const basis=new THREE.Matrix4().makeBasis(u,v,w),origin=new THREE.Vector3(x,y,z);
  const point=(a,b,c)=>origin.clone().addScaledVector(u,a).addScaledVector(v,b).addScaledVector(w,c).toArray();
  const t=.016,web=-2.5/24,base=-8/24,zc=direction*.14*facing,tabWidth=direction===0?.5:.22;
  const tab=plate(group,point(web-t/2,base+.2,zc),[t,.4,tabWidth],basis);
  tab.userData={connection:'cee-rafter-tab',shared:direction===0};
  plate(group,point(web-.13,base+t/2,zc),[.26,t,tabWidth],basis);
  for(const boltZ of direction===0?[-.14,.14]:[zc])for(const rise of [.15,.31])fastener(group,point(web-t,base+rise,boltZ),point(web+.075/12,base+rise,boltZ),.019);
  // Cleat foot welded to the rafter; the two CEE web bolts remain.
  for(const side of [-1,1]){
   const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(.018,0);shape.lineTo(0,side*.018);shape.closePath();
   const geo=new THREE.ExtrudeGeometry(shape,{depth:.26,bevelEnabled:false,steps:1});geo.applyMatrix4(new THREE.Matrix4().makeBasis(v,w,u));
   const weld=solid(group,geo,point(web-.26,base,zc+side*tabWidth/2));weld.userData.connection='cee-rafter-weld';
  }
  counts.cee++;
 }
 const start=inset+.8,run=W/2-.35-start,rows=Math.max(1,Math.ceil(run*Math.hypot(1,m)/(s.roofSpacing/scale)));
 for(let i=0;i<=rows;i++)for(const side of [-1,1]){
  const distance=start+run*i/rows,x=side<0?distance:W-distance,slope=-side*m;
  const y=roof(x)-(8/24+.05)/roofCos;
  if(side<0&&i===Math.min(1,rows))focus.cee=[x,y,jointZ];
  for(let j=1;j<zs.length;j++){
   const a=[x,y,zs[j-1]+.012],b=[x,y,zs[j]-.012];
   // Mirror the CEE opening and its cleat across the roof ridge.
   beam(group,side<0?a:b,side<0?b:a,2,[-slope,1,0]);
  }
  // One shared cleat at an interior rafter, spanning both adjoining CEE ends.
  zs.forEach((z,j)=>purlinCleat(x,y,z,slope,j===0?1:j===zs.length-1?-1:0,side<0?1:-1));
 }
 // Existing opening-aware jambs, headers and coped ZEE girts stay connected
 // to the actual saved design. Do not span doors/windows with a stock model.
 const detailScale=Math.min(1,s.width/4,s.depth/4,s.height/4);
 for(const wall of WALLS){
  const members=buildWallFraming(s,wall),girtMeshes=[],notches=[];
  const opening=s.openings[0];
  if(opening?.wall===wall){
   const joint=members.find(a=>a.connection==='girt-jamb'&&a.opening===opening.id&&a.girt.y>opening.sill&&a.girt.y<opening.sill+opening.height);
   focus.opening=wallPoint(s,wall,opening.x-.12*detailScale,joint?.girt.y??opening.sill+opening.height,-.325*detailScale).map(n=>n/scale);
  }
  for(const member of members){
   member.geometry.scale(1/scale,1/scale,1/scale);
   const mesh=new THREE.Mesh(member.geometry,['bolt','clip','base','weld'].includes(member.kind)?hardwareMat:['zee','girt-web'].includes(member.kind)?mats[3]:mats[0]);mesh.userData={...member,geometry:undefined,memberKind:member.kind,wall};group.add(mesh);if(['zee','girt-web'].includes(member.kind))girtMeshes.push(mesh);
  }
  // Upper endwall girts attach to the sloping rafter web with a projecting
  // clip welded to the rafter web, with two bolts through the girt.
  if(['front','back'].includes(wall)){
   const rows=[...new Set(members.filter(a=>a.kind==='zee').map(a=>a.girt.y))];
   for(const row of rows){
    const y=row/scale,k=detailScale/scale,seat=.045*k/2,t=.016;
    const min=inset+columnHalf+plateT+.3,max=W/2-plateT-.3;
    if(max<=min)continue;
    const distance=THREE.MathUtils.clamp((y-seat-.2-H+drop)/m,min,max);
    for(const along of [distance,W-distance]){
     const realX=wall==='front'?along:W-along,z=wall==='front'?zs[0]:zs.at(-1);
     const steel=members.find(a=>a.kind==='zee'&&a.girt.y===row&&along*scale>=a.girt.a+.27*scale&&along*scale<=a.girt.b-.27*scale);
     if(!steel)continue;
     const webHalf=(rafterHalf-.38/12)/roofCos;
     // The clip must fit between the rafter flanges across its entire width.
     if([-.25,.25].some(dx=>y-seat>axisY(realX+dx)+webHalf-.015||y-seat-.4<axisY(realX+dx)-webHalf+.015))continue;
     const wp=(u,h,out)=>wallPoint(s,wall,u*scale,h*scale,out*scale).map(n=>n/scale);
     const origin=new THREE.Vector3(...wp(along,y,0)),down=new THREE.Vector3(0,-1,0),outward=new THREE.Vector3(...wp(along,y,1)).sub(origin),across=down.clone().cross(outward);
     const basis=new THREE.Matrix4().makeBasis(down,outward,across),point=(a,b,c)=>origin.clone().addScaledVector(down,a).addScaledVector(outward,b).addScaledVector(across,c).toArray();
     const face=-(zInset-.23/24),reach=-.14*k-face;
     const webClip=plate(group,point(seat+.2,face+t/2,0),[.4,t,.5],basis);
     webClip.userData={connection:'upper-girt-rafter',wall,row,point:point(seat+.2,face,0),normal:outward.toArray(),attachment:'welded'};
     const seatPlate=plate(group,point(seat+t/2,face+reach/2,0),[t,reach,.5],basis);
     seatPlate.userData={connection:'upper-girt-seat',wall,row,boltPoints:[-.13,.13].map(dx=>point(seat,(-.33+dx*.6)*k,dx))};
     for(const side of [-1,1]){
      const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(.018,0);shape.lineTo(0,side*.018);shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:.36,bevelEnabled:false,steps:1});geo.applyMatrix4(new THREE.Matrix4().makeBasis(outward,across,down));
      const weld=solid(group,geo,point(seat+.02,face,side*.25));weld.userData={connection:'upper-girt-weld',wall,row};
     }
     for(const dx of [-.13,.13])fastener(group,point(-seat,(-.33+dx*.6)*k,dx),point(seat+t,(-.33+dx*.6)*k,dx),.019);
     notches.push({a:(along-.27)*scale,b:(along+.27)*scale,y:row});
     counts.zee++;counts.upperZee++;
     if(wall==='front')focus.upperzee=wp(along,y,-.55);
    }
   }
  }
  const endwall=['front','back'].includes(wall);
  const locations=(endwall?[inset,...endwallPositions[wall],W-inset]:zs.map(z=>wall==='right'?z:D-z)).sort((a,b)=>a-b);
  for(const location of locations){
   const along=location*scale;
   for(const member of members.filter(a=>a.kind==='zee'&&a.girt&&along>=a.girt.a&&along<=a.girt.b)){
    const y=member.girt.y/scale,t=.016,face=endwall?-(zInset-.29/24):-.67,seat=.045/2;
    // Sidewall clips meet a flange; endwall clips reach the primary column web.
    // Do not draw a primary-column clip above the actual column.
    const intermediate=endwall&&endwallPositions[wall].includes(location);
    if(endwall&&y>axisY(location)+(intermediate?-rafterHalf/roofCos-.035:rafterHalf/roofCos)-.08)continue;
    const wp=(u,v,d)=>wallPoint(s,wall,u*scale,v*scale,d*scale).map(n=>n/scale);
    const origin=new THREE.Vector3(...wp(along/scale,y,0));
    const u=new THREE.Vector3(0,-1,0),v=new THREE.Vector3(...wp(along/scale,y,1)).sub(origin),w=u.clone().cross(v);
    const basis=new THREE.Matrix4().makeBasis(u,v,w);
    const point=(a,b,c)=>origin.clone().addScaledVector(u,a).addScaledVector(v,b).addScaledVector(w,c).toArray();
    {
     // The tab is welded to the column; the two diagonal ZEE bolts remain.
     const zc=0,tabWidth=.50,boltOffsets=[-.13,.13];
     // The narrowest supported designs use the same proportions at a reduced scale.
     const girtFace=endwall?face:face*detailScale/scale,girtSeat=seat*detailScale/scale,reach=-.14*detailScale/scale-girtFace;
     const webClip=plate(group,point(girtSeat+.2,girtFace+t/2,zc),[.4,t,tabWidth],basis);
     webClip.userData={connection:endwall?'endwall-primary-web':'column-girt-web',attachment:'welded',wall,intermediate,point:point(girtSeat+.2,girtFace,zc),normal:v.toArray()};
     plate(group,point(girtSeat+t/2,girtFace+reach/2,zc),[t,reach,tabWidth],basis);
     // Visible edge fillets are illustrative, not a specified weld size.
     for(const side of [-1,1]){
      const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(.018,0);shape.lineTo(0,side*.018);shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:.36,bevelEnabled:false,steps:1});geo.applyMatrix4(new THREE.Matrix4().makeBasis(v,w,u));
      const weld=solid(group,geo,point(girtSeat+.02,girtFace,side*tabWidth/2));weld.userData={connection:'column-girt-weld',wall};
     }
     for(const offset of boltOffsets)fastener(group,point(-girtSeat,(-.33+offset*.6)*detailScale/scale,zc+offset),point(girtSeat+t,(-.33+offset*.6)*detailScale/scale,zc+offset),.019);
     notches.push({a:along-.27*scale,b:along+.27*scale,y:member.girt.y});
     counts.zee++;
    }
    if(wall==='right'&&(!focus.zee||location===jointZ))focus.zee=wp(along/scale,y,-.4);
    if(wall==='front'&&(!focus.endwall||intermediate))focus.endwall=wp(along/scale,y,-.6);
   }
  }
  if(notches.length){
   for(const mesh of girtMeshes){group.remove(mesh);mesh.geometry.dispose();}
   for(const member of buildWallFraming(s,wall,{notches})){
    if(!['zee','girt-web'].includes(member.kind)){member.geometry.dispose();continue;}
    member.geometry.scale(1/scale,1/scale,1/scale);const mesh=new THREE.Mesh(member.geometry,mats[3]);
    mesh.userData={memberKind:member.kind,wall,row:member.girt.y,notched:!!member.notched};group.add(mesh);
   }
  }
 }
 for(const member of buildFraming(s,{includeMain:false})){
  member.geometry.scale(1/scale,1/scale,1/scale);
  if(member.kind==='post')seatPost(member.geometry);
  group.add(new THREE.Mesh(member.geometry,member.kind==='cee'?mats[2]:mats[0]));
 }
 lineMat.dispose();
 group.scale.setScalar(scale);
 return {group,focus:Object.fromEntries(Object.entries(focus).map(([key,p])=>[key,p.map(v=>v*scale)])),counts};
}
