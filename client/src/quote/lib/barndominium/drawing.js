import {esc,round,wallLength,ridgeHeight,framePositions,WALLS} from './model.js';
const points = a => a.map(p=>p.map(round).join(',')).join(' ');
const poly=(a,fill,extra='')=>`<polygon points="${points(a)}" fill="${fill}" ${/\bstroke=/.test(extra)?'':'stroke="#43494b"'} ${/\bstroke-width=/.test(extra)?'':'stroke-width="1"'} ${extra}/>`;
const line=(a,b,extra='')=>`<line x1="${round(a[0])}" y1="${round(a[1])}" x2="${round(b[0])}" y2="${round(b[1])}" ${/\bstroke=/.test(extra)?'':'stroke="#45545a"'} ${extra}/>`;
const text=(x,y,s,extra='')=>`<text x="${round(x)}" y="${round(y)}" font-family="Arial,sans-serif" font-size="14" fill="#283236" ${extra}>${esc(s)}</text>`;
export function wallPoint(s,wall,u,y,out=0){return wall==='front'?[u,y,-out]:wall==='right'?[s.width+out,y,u]:wall==='back'?[s.width-u,y,s.depth+out]:[-out,y,s.depth-u];}
export function elevationTransform(s,wall){const length=wallLength(s,wall),top=ridgeHeight(s),scale=Math.min(740/length,360/top);return {scale,left:(900-length*scale)/2,base:440};}
function dim(a,b,label){return line(a,b,'stroke-width="0.7"')+line([a[0]-4,a[1]-4],[a[0]+4,a[1]+4])+line([b[0]-4,b[1]-4],[b[0]+4,b[1]+4])+text((a[0]+b[0])/2,(a[1]+b[1])/2+19,label,'text-anchor="middle"');}
export function renderDrawing(s,{view='iso',mode='shell',selected='',lang='en',interactive=false}={}){
 const W=s.width,D=s.depth,H=s.height,R=ridgeHeight(s),es=lang==='es';
 let out='<rect width="900" height="540" fill="#f2f0e9"/>';
 const framed=mode==='frame';
 const wallAttrs=wall=>`data-wall="${wall}" tabindex="0" role="button" aria-label="${esc(({front:es?'Frente':'Front',back:es?'Atrás':'Back',right:es?'Derecha':'Right',left:es?'Izquierda':'Left'})[wall])}" class="bd-wall-target"`;
 if(WALLS.includes(view)){
  const L=wallLength(s,view),{scale:k,left,base}=elevationTransform(s,view),p=(u,y)=>[left+u*k,base-y*k];
  const wall=[p(0,0),p(L,0),p(L,H),...(['front','back'].includes(view)?[p(L/2,R)]:[]),p(0,H)];
  out+=poly(wall,framed?'#f2f0e9':s.wallPanel?(mode==='insulation'&&s.wallInsulation!=='none'?'#ddd0a1':s.wallColor):'#eef0eb');
  if(!framed&&s.wallPanel)for(let u=0;u<=L;u+=1){const top=['front','back'].includes(view)?H+Math.min(u,L-u)*s.pitch/12:H;out+=line(p(u,0),p(u,top),'stroke-opacity=".22"');}
  if(framed){
   const cols=['front','back'].includes(view)?[0,L]:framePositions(s).map(z=>view==='right'?z:D-z);
   for(const u of cols)out+=line(p(u,0),p(u,H),'stroke-width="5"');
   const rows=Math.ceil(H/s.wallSpacing);
   for(let i=1;i<=rows;i++){const y=i*H/rows;let x=0;for(const o of s.openings.filter(o=>o.wall===view&&y>o.sill&&y<o.sill+o.height).sort((a,b)=>a.x-b.x)){out+=line(p(x,y),p(o.x,y),'stroke="#89754c" stroke-width="2"');x=o.x+o.width;}out+=line(p(x,y),p(L,y),'stroke="#89754c" stroke-width="2"');}
   if(['front','back'].includes(view))out+=line(p(0,H),p(L/2,R),'stroke-width="5"')+line(p(L/2,R),p(L,H),'stroke-width="5"');
  }
  for(const porch of s.porches.filter(p=>p.wall===view)){
   const outer=porch.height-porch.depth*porch.pitch/12;
   out+=poly([p(porch.x,porch.height),p(porch.x+porch.width,porch.height),p(porch.x+porch.width,outer),p(porch.x,outer)],s.roofColor,'fill-opacity=".25"');
   out+=line(p(porch.x,0),p(porch.x,outer),'stroke-width="4"')+line(p(porch.x+porch.width,0),p(porch.x+porch.width,outer),'stroke-width="4"');
  }
  for(const o of s.openings.filter(o=>o.wall===view)){
   const a=p(o.x,o.sill+o.height),b=p(o.x+o.width,o.sill),w=b[0]-a[0],h=b[1]-a[1];
   out+=`<g data-opening="${esc(o.id)}" tabindex="0" role="button" aria-label="${esc(o.kind+' '+o.id)}" style="cursor:grab"><rect x="${a[0]}" y="${a[1]}" width="${w}" height="${h}" fill="${o.kind==='window'?'#bed2d9':'#eae7df'}" stroke="${selected===o.id?'#096c8a':s.trimColor}" stroke-width="${selected===o.id?4:3}"/>`;
   if(o.kind==='window')out+=line(p(o.x+o.width/2,o.sill),p(o.x+o.width/2,o.sill+o.height))+line(p(o.x,o.sill+o.height/2),p(o.x+o.width,o.sill+o.height/2));
   else if(o.kind==='overhead')for(let y=1;y<o.height;y++)out+=line(p(o.x,o.sill+y),p(o.x+o.width,o.sill+y),'stroke-opacity=".5"');
   else out+=`<circle cx="${b[0]-Math.min(8,w/4)}" cy="${a[1]+h*.55}" r="2.5" fill="#43494b"/>`;
   out+=text((a[0]+b[0])/2,a[1]-8,`${o.width} × ${o.height} ft`,'text-anchor="middle"')+'</g>';
  }
  out+=dim(p(0,-2),p(L,-2),`${round(L)} ft`)+text(30,45,es?'Vista exterior · arrastra una abertura':'Outside view · drag an opening');
  out+=text(30,72,`${es?'Alero':'Eave'} ${H} ft · ${es?'Cumbrera':'Ridge'} ${round(R)} ft`);
 }else if(view==='plan'){
  const maxPorch=Math.max(0,...s.porches.map(p=>p.depth)),k=Math.min(710/(W+2*maxPorch),380/(D+2*maxPorch)),x=(900-W*k)/2,y=(510-D*k)/2;
  const p=([u,,z])=>[x+u*k,y+z*k];
  out+=poly([[x,y],[x+W*k,y],[x+W*k,y+D*k],[x,y+D*k]],'#e9e5da');
  if(framed)for(const z of framePositions(s))out+=line(p([0,0,z]),p([W,0,z]),'stroke-dasharray="5 5" stroke-opacity=".45"');
  for(const porch of s.porches)out+=poly([p(wallPoint(s,porch.wall,porch.x,0)),p(wallPoint(s,porch.wall,porch.x+porch.width,0)),p(wallPoint(s,porch.wall,porch.x+porch.width,0,porch.depth)),p(wallPoint(s,porch.wall,porch.x,0,porch.depth))],'#d0c5aa');
  for(const o of s.openings)out+=line(p(wallPoint(s,o.wall,o.x,0)),p(wallPoint(s,o.wall,o.x+o.width,0)),`stroke="${o.kind==='window'?'#096c8a':'#b37626'}" stroke-width="6"`);
  if(interactive)for(const wall of WALLS)out+=line(p(wallPoint(s,wall,0,0)),p(wallPoint(s,wall,wallLength(s,wall),0)),`${wallAttrs(wall)} style="stroke:transparent;stroke-width:28;pointer-events:stroke"`);
  out+=dim([x,y+D*k+20],[x+W*k,y+D*k+20],`${W} ft`)+text(x+W*k+12,y+D*k/2,`${D} ft`)+text(x+W*k/2,y-12,es?'Frente':'Front','text-anchor="middle"');
  out+=text(30,30,es?'Planta exterior · sin distribución interior':'Shell plan · no interior layout');
 }else{
  // Orthographic axonometric projection: all components share world coordinates.
  const raw=([x,y,z])=>[(x-W/2)*.84+(z-D/2)*.57,(x-W/2)*.28-(z-D/2)*.38-y];
  const pad=Math.max(s.overhang,...s.porches.map(p=>p.depth),1),corners=[];
  for(const x of [-pad,W+pad])for(const z of [-pad,D+pad])for(const y of [0,R])corners.push(raw([x,y,z]));
  const minX=Math.min(...corners.map(p=>p[0])),maxX=Math.max(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1])),maxY=Math.max(...corners.map(p=>p[1]));
  const k=Math.min(790/(maxX-minX),420/(maxY-minY)),p=v=>{const r=raw(v);return [450+(r[0]-(minX+maxX)/2)*k,267+(r[1]-(minY+maxY)/2)*k];};
  const path=a=>'M'+a.map(v=>p(v).map(round).join(',')).join('L')+'Z';
  out+=poly([p([0,0,0]),p([W,0,0]),p([W,0,D]),p([0,0,D])],'#ded9cc');
  for(const z of framePositions(s)){
   for(const x of [0,W])out+=line(p([x,0,z]),p([x,H,z]),`stroke-width="${s.frame==='ibeam'?5:4}"`);
   out+=line(p([0,H,z]),p([W/2,R,z]),'stroke-width="5"')+line(p([W/2,R,z]),p([W,H,z]),'stroke-width="5"');
  }
  const rows=Math.ceil((W/2)*Math.hypot(1,s.pitch/12)/s.roofSpacing);
  for(let i=0;i<=rows;i++)for(const side of [0,1]){const x=side?W-i*W/2/rows:i*W/2/rows,y=H+Math.min(x,W-x)*s.pitch/12;out+=line(p([x,y,0]),p([x,y,D]),'stroke="#9b783b" stroke-width="2"');}
  // Rear faces are hidden in shell view; in frame view show all girt runs.
  for(const wall of (framed?WALLS:['right','front'])){
   const L=wallLength(s,wall),wp=(u,y)=>wallPoint(s,wall,u,y),shape=[wp(0,0),wp(L,0),wp(L,H),...(['front','back'].includes(wall)?[wp(L/2,R)]:[]),wp(0,H)];
   const holes=s.openings.filter(o=>o.wall===wall);
   if(!framed&&s.wallPanel){
    let d=path(shape);for(const o of holes)d+=path([wp(o.x,o.sill),wp(o.x+o.width,o.sill),wp(o.x+o.width,o.sill+o.height),wp(o.x,o.sill+o.height)]);
    out+=`<path d="${d}" fill="${mode==='insulation'&&s.wallInsulation!=='none'?'#ddd0a1':s.wallColor}" fill-rule="evenodd" stroke="${s.trimColor}"/>`;
    for(let u=1;u<L;u+=1){let bottom=0;const top=['front','back'].includes(wall)?H+Math.min(u,L-u)*s.pitch/12:H;for(const o of holes.filter(o=>u>o.x&&u<o.x+o.width).sort((a,b)=>a.sill-b.sill)){out+=line(p(wp(u,bottom)),p(wp(u,o.sill)),'stroke-opacity=".18"');bottom=o.sill+o.height;}out+=line(p(wp(u,bottom)),p(wp(u,top)),'stroke-opacity=".18"');}
   }
   if(framed||!s.wallPanel){const count=Math.ceil(H/s.wallSpacing);for(let i=1;i<=count;i++){const y=i*H/count;let x=0;for(const o of holes.filter(o=>y>o.sill&&y<o.sill+o.height).sort((a,b)=>a.x-b.x)){out+=line(p(wp(x,y)),p(wp(o.x,y)),'stroke="#89754c" stroke-width="2"');x=o.x+o.width;}out+=line(p(wp(x,y)),p(wp(L,y)),'stroke="#89754c" stroke-width="2"');}}
   for(const o of holes){const coords=[wp(o.x,o.sill),wp(o.x+o.width,o.sill),wp(o.x+o.width,o.sill+o.height),wp(o.x,o.sill+o.height)];out+=poly(coords.map(p),framed?'none':o.kind==='window'?'#aec7d1':'#e8e4da','stroke-width="3"');if(!framed&&o.kind==='window')out+=line(p(wp(o.x+o.width/2,o.sill)),p(wp(o.x+o.width/2,o.sill+o.height)));if(!framed&&o.kind==='overhead')for(let y=1;y<o.height;y++)out+=line(p(wp(o.x,o.sill+y)),p(wp(o.x+o.width,o.sill+y)),'stroke-opacity=".45"');}
   if(interactive&&['front','right'].includes(wall))out+=poly(shape.map(p),'transparent',`${wallAttrs(wall)} style="stroke:transparent;pointer-events:all"`);
  }
  if(!framed&&s.roofPanel){const e=s.overhang,edge=H-e*s.pitch/12;for(const [a,b] of [[W/2,W+e],[-e,W/2]]){const ya=a===W/2?R:edge,yb=b===W/2?R:edge;out+=poly([p([a,ya,-e]),p([b,yb,-e]),p([b,yb,D+e]),p([a,ya,D+e])],mode==='insulation'&&s.roofInsulation!=='none'?'#d6be84':s.roofColor);for(let z=-e;z<=D+e;z+=1)out+=line(p([a,ya,z]),p([b,yb,z]),'stroke="#fff" stroke-opacity=".24"');}}
  for(const porch of s.porches){const outer=porch.height-porch.depth*porch.pitch/12,wp=(u,y,d=0)=>wallPoint(s,porch.wall,u,y,d),n=Math.ceil(porch.width/10);for(let i=0;i<=n;i++){const u=porch.x+i*porch.width/n;out+=line(p(wp(u,0,porch.depth)),p(wp(u,outer,porch.depth)),'stroke-width="4"')+line(p(wp(u,outer,porch.depth)),p(wp(u,porch.height)),'stroke-width="3"');}out+=poly([wp(porch.x,porch.height),wp(porch.x+porch.width,porch.height),wp(porch.x+porch.width,outer,porch.depth),wp(porch.x,outer,porch.depth)].map(p),framed?'none':s.roofColor);}
  out+=dim(p([0,0,-2]),p([W,0,-2]),`${W} ft`)+text(28,34,es?'Vista axonométrica a escala':'Scaled axonometric view')+text(28,59,`${W} × ${D} ft · ${H} ft ${es?'alero':'eave'} · ${s.pitch}:12`);
 }
 out+=text(24,525,es?'Concepto exterior · dimensiones en pies · no es un plano estructural':'Exterior concept · dimensions in feet · not a structural drawing');
 return out;
}
