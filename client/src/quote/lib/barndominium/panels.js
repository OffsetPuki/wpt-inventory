import * as THREE from 'three';

// Common R/PBR profile: 12 in centers, 1-1/4 in major ribs. The two shallow
// stiffening beads and folded trim are visual details, not fabrication tooling.
// https://www.mbci.com/products/pbr/ — all coordinates below are in feet.
export const R_PANEL = Object.freeze({pitch:1, height:1.25/12});
const H=R_PANEL.height, bead=.125/12;
const profile=[
 [0,H],[.5/12,H],[1.5/12,0],
 [3.625/12,0],[3.875/12,bead],[4.125/12,bead],[4.375/12,0],
 [7.625/12,0],[7.875/12,bead],[8.125/12,bead],[8.375/12,0],
 [10.5/12,0],[11.5/12,H],[1,H],
];
export function rPanelHeight(x){
 const u=((x%1)+1)%1;
 for(let i=1;i<profile.length;i++){const [a,y]=profile[i-1],[b,z]=profile[i];if(u<=b)return y+(z-y)*(u-a)/(b-a);}
 return H;
}

// World-aligned profile offsets keep ribs continuous across strips cut around
// openings and where gable panels meet the wall. Faceted normals retain the
// crisp breaks of a folded panel instead of smoothing them into sine waves.
export function rPanelGeometry(width,height,{offset=0,top=(_x)=>height,breaks=[]}={}){
 const xs=[0,width,...breaks.filter(x=>x>0&&x<width)];
 for(let n=Math.floor(offset)-1;n<=Math.ceil(offset+width);n++)for(const [u] of profile){const x=n+u-offset;if(x>0&&x<width)xs.push(x);}
 const sorted=[...new Set(xs.map(x=>Math.round(x*1e9)/1e9))].sort((a,b)=>a-b),positions=[],uv=[];
 const vertex=(x,y,z)=>{positions.push(x-width/2,y-height/2,z);uv.push(x/width,y/height);};
 for(let i=1;i<sorted.length;i++){
  const a=sorted[i-1],b=sorted[i],za=rPanelHeight(a+offset),zb=rPanelHeight(b+offset),ya=Math.max(0,top(a)),yb=Math.max(0,top(b));
  vertex(a,0,za);vertex(b,0,zb);vertex(a,ya,za);
  vertex(b,0,zb);vertex(b,yb,zb);vertex(a,ya,za);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geometry.computeVertexNormals();
 return geometry;
}

// Extrude a folded sheet along Z. Small thickness, crisp edges, no per-fastener
// meshes or high-resolution texture downloads.
export function foldedTrim(points,length,thickness=.012){
 const shape=new THREE.Shape();
 points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));
 const normals=points.slice(1).map(([x,y],i)=>new THREE.Vector2(-(y-points[i][1]),x-points[i][0]).normalize());
 const inner=points.map(([x,y],i)=>{
  const before=normals[Math.max(0,i-1)],after=normals[Math.min(i,normals.length-1)];
  const normal=before.clone().add(after).normalize();
  const miter=thickness/Math.max(.25,normal.dot(after));
  return [x+normal.x*miter,y+normal.y*miter];
 });
 for(const [x,y] of inner.reverse())shape.lineTo(x,y);
 shape.closePath();
 const g=new THREE.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,steps:1});
 return g;
}

// Three connected fascia pieces around a porch: two sloped sides and the
// outside edge. Local axes are U across the porch, Y up, D away from the wall.
// The face extends below the complete CEE profile, not just the roof sheet.
export function porchFascia(s,p){
 const k=p.pitch/12,n=Math.hypot(1,k),outer=p.height-p.depth*k;
 const scale=Math.min(1,s.width/4,s.depth/4,s.height/4,p.width/2,p.depth/2,outer/2);
 const drop=.76*scale*n,lip=Math.min(.24,p.width/4),edge=.06,parts=[];
 for(const side of [0,1]){
  const g=foldedTrim([[lip,.14],[0,.14],[0,-drop],[Math.min(.1,lip),-drop]],p.depth+edge),a=g.attributes.position;
  for(let i=0;i<a.count;i++){
   const x=a.getX(i),d=a.getZ(i),y=p.height-d*k+a.getY(i);
   a.setXYZ(i,side?p.width+edge-x:x-edge,y,d);
  }
  g.computeVertexNormals();parts.push(g);
 }
 const front=foldedTrim([[-.24,.14],[0,.14],[0,-drop],[-.1,-drop]],p.width+2*edge),a=front.attributes.position;
 for(let i=0;i<a.count;i++)a.setXYZ(i,a.getZ(i)-edge,outer+a.getY(i),p.depth+edge+a.getX(i));
 front.computeVertexNormals();parts.push(front);
 return parts;
}
