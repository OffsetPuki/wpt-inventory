import {wallLength} from './model.js';

// Layout dimensions are schematic preview sections, not a member/bolt schedule.
// Typical assembly reference: GWB framed opening details SD94/96/98 and its
// erection manual section 3.14. The ZEE connects to a structural jamb, not trim.
export function wallFramingLayout(s,wall){
 const scale=Math.min(1,s.width/4,s.depth/4,s.height/4),depth=.65*scale,t=.025*scale,gap=.012*scale;
 const length=wallLength(s,wall),inset=.4*scale,holes=s.openings.filter(o=>o.wall===wall),count=Math.ceil(s.height/s.wallSpacing);
 const rows=Array.from({length:count},(_,i)=>({y:(i+1)*s.height/count-.365*scale,a:inset,b:length-inset}));
 if(['front','back'].includes(wall))for(let y=s.height+s.wallSpacing;y<s.height+s.width*s.pitch/24;y+=s.wallSpacing){const edge=(y-s.height)/(s.pitch/12)+inset;rows.push({y:y-.365*scale,a:edge,b:length-edge});}
 const frames=holes.map(o=>{
  const top=o.sill+o.height;
  let leftWidth=Math.min(.25*scale,o.x*.8),rightWidth=Math.min(.25*scale,(length-o.x-o.width)*.8);
  for(const other of holes)if(other!==o){
   const leftGap=o.x-other.x-other.width,rightGap=other.x-o.x-o.width;
   if(leftGap>=0)leftWidth=Math.min(leftWidth,leftGap*.45);
   if(rightGap>=0)rightWidth=Math.min(rightWidth,rightGap*.45);
  }
  const headWidth=Math.min(.25*scale,(s.height-top-.02)*.8),sillWidth=o.kind==='window'?Math.min(.25*scale,o.sill*.8):0;
  const below=rows.filter(r=>r.y+.3*scale<o.sill-sillWidth).at(-1),above=rows.find(r=>r.y-.3*scale>top+headWidth);
  let lower=o.kind==='window'&&below?Math.max(0,below.y-.32*scale):0;
  let upper=above?Math.min(s.height-.02,above.y+.32*scale):s.height-.02;
  // Keep extensions out of other openings in vertically stacked layouts.
  for(const other of holes)if(other!==o&&other.x<o.x+o.width+rightWidth&&other.x+other.width>o.x-leftWidth){
   if(other.sill>=top)upper=Math.min(upper,other.sill-.02);
   if(other.sill+other.height<=o.sill)lower=Math.max(lower,other.sill+other.height+.02);
  }
  const jambs=[{web:o.x-leftWidth,sign:1,width:leftWidth},{web:o.x+o.width+rightWidth,sign:-1,width:rightWidth}]
   .map(j=>({...j,lower,upper,lo:j.web+Math.min(0,j.sign*t),hi:j.web+Math.max(0,j.sign*t),opening:o.id}));
  return {opening:o,top,headWidth,sillWidth,lower,upper,jambs};
 });
 const girts=[];
 for(const row of rows){
  const cuts=[];
  for(const f of frames){
   if(row.y+.298*scale<f.lower||row.y-.298*scale>f.upper)continue;
   for(const j of f.jambs)cuts.push([j.lo-gap,j.hi+gap]);
   if(row.y+.298*scale>f.opening.sill-f.sillWidth&&row.y-.298*scale<f.top+f.headWidth)
    cuts.push([f.jambs[0].lo-gap,f.jambs[1].hi+gap]);
  }
  let from=row.a;
  const segment=(a,b)=>{
   if(b-a<.001)return;
   const joints=[];
   for(const f of frames)for(const j of f.jambs)if(row.y>=j.lower&&row.y<=j.upper){
    if(Math.abs(b-(j.lo-gap))<1e-6)joints.push({end:'end',face:j.lo,dir:-1,jamb:j});
    if(Math.abs(a-(j.hi+gap))<1e-6)joints.push({end:'start',face:j.hi,dir:1,jamb:j});
   }
   const cope=end=>Math.max(0,...joints.filter(j=>j.end===end&&j.dir===j.jamb.sign).map(j=>j.jamb.width-t+gap));
   girts.push({a,b,y:row.y,joints,copeStart:cope('start'),copeEnd:cope('end')});
  };
  for(const [a,b] of cuts.sort((a,b)=>a[0]-b[0])){if(b<=from||a>=row.b)continue;segment(from,Math.min(a,row.b));from=Math.max(from,b);}
  segment(from,row.b);
 }
 return {scale,depth,t,gap,frames,girts};
}
