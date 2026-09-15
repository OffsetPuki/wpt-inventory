import * as THREE from 'three';
import {wallFramingLayout} from './wall-framing.js';

// Illustrative weathering layers. Final laps, sealant, anchors and rough opening
// must follow the selected door/window and building manufacturer's details.
// All geometry is wall-local (X along wall, Y up, Z outside).
export function openingDetails(s,o){
 const f=wallFramingLayout(s,o.wall).frames.find(f=>f.opening.id===o.id),parts=[];
 if(!f)return parts;
 const k=Math.min(1,o.width/2,o.height/2),sheet=.02/12*k;
 const add=(geometry,name,material='steel',dimensions)=>{
  geometry.userData.part={name,material:material==='seal'?'Weather seal · product not selected':material==='aluminum'?'Aluminum · alloy not selected':'Sheet steel · coating not selected',...(dimensions?{dimensions:dimensions.map(n=>n*12)}:{thickness:sheet*12})};
  parts.push({geometry,material});
 };
 const box=(x,y,z,w,h,d,name,material='steel')=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);add(g,name,material,[w,h,d]);};
 const fold=(points,length,start,map,name)=>{
  for(let i=1;i<points.length;i++){
   const [a,b]=[points[i-1],points[i]],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),nx=-dy/len*sheet/2,ny=dx/len*sheet/2;
   const shape=new THREE.Shape();[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]].forEach(([u,v],j)=>j?shape.lineTo(u,v):shape.moveTo(u,v));shape.closePath();
   const g=new THREE.ExtrudeGeometry(shape,{depth:length,steps:1,bevelEnabled:false}),p=g.attributes.position;
   for(let j=0;j<p.count;j++)p.setXYZ(j,...map(p.getX(j),p.getY(j),p.getZ(j)+start));g.computeVertexNormals();add(g,name);
  }
 };
 const x=o.x,w=o.width,bottom=o.sill,top=bottom+o.height,cap=top+Math.min(.125,o.width/4,o.height/4)+.02*k,side=.12*k;
 // Seat the drip on the visible casing, not at the top of the concealed structural header.
 // Upstand behind the panel, outward sloping cap, downturned drip and hem.
 fold([[-.025,cap+.15*k],[-.025,cap],[.30*k,cap-.025*k],[.30*k,cap-.10*k],[.27*k,cap-.11*k]],w+side*2,x-side,(out,y,u)=>[u,y,out],'Head flashing / drip edge');
 for(const [edge,sign] of [[x,-1],[x+w,1]])fold([[edge+sign*side,.008],[edge,.008],[edge,.26*k]],o.height,bottom,(u,out,y)=>[u,y,out],'Jamb cover trim');
 if(o.kind==='window'){
  // Pan drains outward; raised end dams close the sides below the window unit.
  fold([[-.26*k,bottom+.04*k],[-.26*k,bottom-.025*k],[.30*k,bottom-.06*k],[.30*k,bottom-.14*k],[.27*k,bottom-.15*k]],w,x,(out,y,u)=>[u,y,out],'Window sill pan / drip');
  for(const edge of [x,x+w])box(edge,bottom-.005*k,.02*k,sheet,.11*k,.56*k,'Window sill-pan end dam');
 }
 if(o.kind==='door'&&o.doorPackage==='preassembled'){
  box(x+w/2,.025*k,.03*k,w,.05*k,.45*k,'Door package threshold','aluminum');
  box(x+w/2,.055*k,.15*k,Math.max(.1,w-.15*k),.045*k,.03*k,'Door bottom sweep','seal');
  for(const edge of [x+.06*k,x+w-.06*k])box(edge,top/2,.14*k,.035*k,Math.max(.1,o.height-.06*k),.025*k,'Door jamb weather seal','seal');
  box(x+w/2,top-.04*k,.14*k,Math.max(.1,w-.1*k),.035*k,.025*k,'Door head weather seal','seal');
  for(const y of [.6,o.height/2,o.height-.6])if(y>0&&y<o.height)box(x+.09*k,y,.16*k,.07*k,.23*k,.07*k,'Door package hinge');
 }
 return parts;
}
