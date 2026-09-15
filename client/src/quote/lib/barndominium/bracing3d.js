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
   const webX=p.x+(p.side<0?-1:1)*2.5/24;
   member([p.x,rafterBottom(p.x)+.025,z],[webX,p.y-.10,z+direction*reach],'Rafter flange brace',{width:.11,depth:.07});result.flange++;
  }
  for(const wall of ['left','right']){
   const side=wall==='left'?1:-1,x=wall==='left'?inset:W-inset;
   const u=wall==='right'?z:D-z,v=wall==='right'?z+direction*reach:D-z-direction*reach;
   if(!clear(wall,Math.min(u,v),Math.max(u,v)))continue;
   const rows=[...new Set(group.children.filter(o=>o.userData.wall===wall&&o.userData.memberKind==='zee').map(o=>o.userData.girt?.y??o.userData.row).filter(Number.isFinite))];
   for(const row of rows){
    const y=row/scale;if(y<1.2||y>axisY(inset)-.5)continue;
    const inner=x+side*(9.73/24+taperGradient*(y-.8-baseT));
    member([inner,y-.8,z],[wall==='left'?.33:W-.33,y-.08,z+direction*reach],'Column flange brace',{width:.11,depth:.07});result.flange++;
   }
  }
 }
 // Paired mid-bay straps restrain the CEE webs on each roof slope separately.
 // Final number of restraint lines and their anchorage come from engineering.
 for(const {a,b} of bays)for(const side of [-1,1]){
  const row=purlins.filter(p=>p.side===side);
  for(const offset of [-.25,.25])for(let i=1;i<row.length;i++){
   const p=row[i-1],q=row[i],z=(a+b)/2+offset;
   member([p.x+(side<0?-1:1)*2.5/24,p.y+.25,z],[q.x+(side<0?-1:1)*2.5/24,q.y-.25,z],'Purlin restraint strap',{width:.07});result.restraint++;
  }
 }
 group.userData.bracing=result;
 return result;
}
