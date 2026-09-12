// Shared with the suite. Feet throughout; opening offsets are from the left
// when looking at each wall from outside. This is shell geometry, not engineering.
export const WALLS = ['front', 'right', 'back', 'left'];
export const DEFAULT = {version:1,width:40,depth:60,height:12,pitch:4,overhang:1,frame:'ibeam',bay:20,roofSpacing:5,wallSpacing:4,roofPanel:true,wallPanel:true,roofColor:'#555b60',wallColor:'#e3dfd3',trimColor:'#303638',roofInsulation:'none',wallInsulation:'none',openings:[{id:'door-1',kind:'door',wall:'front',x:7,width:3,height:7,sill:0},{id:'window-1',kind:'window',wall:'front',x:23,width:4,height:4,sill:3}],porches:[]};
export const fresh = () => structuredClone(DEFAULT);
export const round = n => Math.round(n*100)/100;
export const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const wallLength = (s,wall) => ['front','back'].includes(wall)?s.width:s.depth;
export const ridgeHeight = s => s.height+s.width*s.pitch/24;
export const framePositions = s => {const n=Math.min(100,Math.ceil(s.depth/s.bay));return Array.from({length:n+1},(_,i)=>i*s.depth/n);};
export function normalize(raw={}) {
 const s=fresh();
 for(const key of ['width','depth','height','pitch','overhang'])if(typeof raw[key]==='number'&&Number.isFinite(raw[key]))s[key]=raw[key];
 s.frame=raw.frame==='post'?'post':'ibeam';
 for(const key of ['roofPanel','wallPanel'])if(typeof raw[key]==='boolean')s[key]=raw[key];
 for(const key of ['roofColor','wallColor','trimColor'])if(/^#[\da-f]{6}$/i.test(raw[key]))s[key]=raw[key];
 for(const key of ['roofInsulation','wallInsulation'])if(['none','fiberglass','spray-foam','mineral-wool'].includes(raw[key]))s[key]=raw[key];
 for(const key of ['openings','porches'])if(Array.isArray(raw[key]))s[key]=raw[key].slice(0,key==='openings'?40:8).map((o,i)=>{
  const item={id:typeof o?.id==='string'?o.id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,45):`${key}-${i}`,wall:WALLS.includes(o?.wall)?o.wall:'front'};
  const keys=key==='openings'?['x','width','height','sill']:['x','width','depth','height','pitch'];
  for(const k of keys)item[k]=typeof o?.[k]==='number'&&Number.isFinite(o[k])?o[k]:0;
  if(key==='openings'){item.kind=['door','overhead','window'].includes(o?.kind)?o.kind:'door';if(item.kind!=='window')item.sill=0;}
  return item;
 });
 return s;
}
export function validate(s) {
 const errors=[];
 for(const [key,min,max] of [['width',2,300],['depth',2,300],['height',2,40],['pitch',1,5],['overhang',0,4],['bay',2,40],['roofSpacing',1,10],['wallSpacing',1,10]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)errors.push({code:'range',key,min,max});
 if(!Number.isInteger(s.pitch))errors.push({code:'range',key:'pitch',min:1,max:5});
 if(errors.length)return errors;
 const ids=new Set();
 for(const o of s.openings){
  if(ids.has(o.id)||!o.id)errors.push({code:'id',id:o.id});ids.add(o.id);
  if(o.width<=0||o.height<=0||o.x<0.25||o.sill<0||o.x+o.width>wallLength(s,o.wall)-0.25||o.sill+o.height>s.height-0.25)errors.push({code:'opening-bounds',id:o.id});
  if(['left','right'].includes(o.wall)&&framePositions(s).some(z=>{const u=o.wall==='right'?z:s.depth-z;return u>o.x-0.25&&u<o.x+o.width+0.25;}))errors.push({code:'column',id:o.id});
 }
 for(let i=0;i<s.openings.length;i++)for(const b of s.openings.slice(i+1)){const a=s.openings[i];if(a.wall===b.wall&&a.x<b.x+b.width+0.25&&a.x+a.width+0.25>b.x&&a.sill<b.sill+b.height+0.25&&a.sill+a.height+0.25>b.sill)errors.push({code:'overlap',id:a.id,other:b.id});}
 for(const p of s.porches){
  if(ids.has(p.id)||!p.id)errors.push({code:'id',id:p.id});ids.add(p.id);
  if(p.x<0||p.width<=0||p.x+p.width>wallLength(s,p.wall)||p.depth<1||p.depth>30||p.pitch<1||p.pitch>5||!Number.isInteger(p.pitch)||p.height>=s.height||p.height-p.depth*p.pitch/12<=0)errors.push({code:'porch-bounds',id:p.id});
  if(s.roofPanel&&['left','right'].includes(p.wall)&&s.pitch>p.pitch&&p.height>=s.height-Math.min(s.overhang,p.depth)*(s.pitch-p.pitch)/12-.25)errors.push({code:'porch-eave',id:p.id});
  for(const o of s.openings)if(o.wall===p.wall&&o.x<p.x+p.width&&o.x+o.width>p.x&&o.sill+o.height>=p.height-0.25)errors.push({code:'porch-opening',id:o.id});
  const k=p.pitch/12,scale=Math.min(1,s.width/4,s.depth/4,s.height/4,p.width/2,p.depth/2,(p.height-p.depth*k)/2);
  const clearHeight=p.height-(.4*k+1.03*Math.hypot(1,k)+.325)*scale-.05;
  for(const o of s.openings)if(o.wall===p.wall&&o.x<p.x+p.width&&o.x+o.width>p.x&&o.sill+o.height< p.height-.25&&o.sill+o.height>=clearHeight)errors.push({code:'porch-clearance',id:o.id});
 }
 for(let i=0;i<s.porches.length;i++)for(const b of s.porches.slice(i+1)){const a=s.porches[i];if(a.wall===b.wall&&a.x<b.x+b.width&&a.x+a.width>b.x)errors.push({code:'porch-overlap',id:a.id});}
 return errors;
}
// When the shell shrinks, keep opening sizes and move them to the nearest
// available position. Never discard a customer's door, window or porch.
export function fitOpeningsToSize(next) {
 const s=structuredClone(next);
 if(validate({...s,openings:[]}).length)return s;
 const placed=[];
 for(const original of s.openings){
  const L=wallLength(s,original.wall),max=L-original.width-.25;
  const sill=original.kind==='window'?Math.max(0,Math.min(original.sill,s.height-original.height-.25)):0;
  const xs=[original.x,.25,max];
  for(const other of placed.filter(o=>o.wall===original.wall))xs.push(other.x-original.width-.25,other.x+other.width+.25);
  if(['left','right'].includes(original.wall))for(const z of framePositions(s)){const u=original.wall==='right'?z:s.depth-z;xs.push(u-original.width-.25,u+.25);}
  xs.sort((a,b)=>Math.abs(a-original.x)-Math.abs(b-original.x));
  const opening=xs.map(x=>({...original,x,sill})).find(o=>!validate({...s,openings:[...placed,o]}).length);
  if(!opening)return structuredClone(next);
  placed.push(opening);
 }
 s.openings=placed;
 return s;
}
export function takeoff(s) {
 const slope=Math.hypot(1,s.pitch/12),run=s.width/2+s.overhang;
 const openingArea=s.openings.reduce((a,o)=>a+o.width*o.height,0);
 const wallGross=2*(s.width+s.depth)*s.height+s.width*(ridgeHeight(s)-s.height);
 const wallNet=Math.max(0,wallGross-openingArea);
 const roof=2*run*slope*(s.depth+2*s.overhang);
 const porchRoof=s.porches.reduce((a,p)=>a+p.width*p.depth*Math.hypot(1,p.pitch/12),0);
 const frames=framePositions(s).length;
 const roofRows=Math.ceil(s.width/2*slope/s.roofSpacing)+1;
 // Exact net horizontal girt runs: subtract only openings intersecting each row.
 let girts=0;const rows=Math.ceil(s.height/s.wallSpacing);
 for(const wall of WALLS)for(let i=1;i<=rows;i++){const y=i*s.height/rows;girts+=wallLength(s,wall)-s.openings.filter(o=>o.wall===wall&&y>o.sill&&y<o.sill+o.height).reduce((a,o)=>a+o.width,0);}
 for(let y=s.height+s.wallSpacing;y<ridgeHeight(s);y+=s.wallSpacing)girts+=2*s.width*(ridgeHeight(s)-y)/(ridgeHeight(s)-s.height);
 const openingTrim=s.openings.reduce((a,o)=>a+2*o.height+o.width*(o.kind==='window'?2:1),0);
 return {floor:round(s.width*s.depth),roof:round(roof),wallGross:round(wallGross),wallNet:round(wallNet),openingArea:round(openingArea),porchRoof:round(porchRoof),frames,columns:2*frames,columnFeet:round(2*frames*s.height),rafterFeet:round(frames*s.width*slope),ceeFeet:round(2*roofRows*s.depth),zeeFeet:round(girts),openingTrim:round(openingTrim),ridge:round(ridgeHeight(s)),porchPosts:s.porches.reduce((a,p)=>a+Math.ceil(p.width/10)+1,0)};
}
export function spec(s,lang='en',{technical=true}={}) {
 const es=lang==='es',t=takeoff(s);
 const wall=w=>({front:es?'Frente':'Front',back:es?'Atrás':'Back',left:es?'Izquierda':'Left',right:es?'Derecha':'Right'}[w]);
 const kind=k=>({door:es?'Puerta':'Door',window:es?'Ventana':'Window',overhead:es?'Portón de garaje':'Overhead door'}[k]);
 return [
 [es?'Edificio':'Building',`${s.width} × ${s.depth} ft · ${t.floor} sq ft`],
 [es?'Alturas':'Heights',`${s.height} ft ${es?'alero':'eave'} · ${t.ridge} ft ${es?'cumbrera':'ridge'}`],
 [es?'Techo':'Roof',`${s.pitch}:12 · ${s.overhang} ft ${es?'voladizo':'overhang'}`],
 ...(technical?[
 [es?'Estructura':'Frame',`${s.frame==='ibeam'?'I-beam':'Steel post'} · ${t.frames} ${es?'marcos':'frames'} · ${round(s.depth/(t.frames-1))} ft ${es?'entre marcos':'bay spacing'}`],
 [es?'Correas':'Secondary framing',`CEE ${es?'techo':'roof'} @ ≤${s.roofSpacing} ft · ZEE ${es?'muros':'walls'} @ ≤${s.wallSpacing} ft`],
 ]:[]),
 [es?'Lámina':'Panels',`${es?'Techo':'Roof'}: ${s.roofPanel?'R-panel':'none'} ${s.roofColor} · ${es?'Muros':'Walls'}: ${s.wallPanel?'R-panel':'none'} ${s.wallColor}`],
 ...(technical?[[es?'Aislamiento':'Insulation',`${es?'Techo':'Roof'}: ${s.roofInsulation} · ${es?'Muros':'Walls'}: ${s.wallInsulation}`]]:[]),
 ...s.openings.map((o,i)=>[`${kind(o.kind)} ${i+1}`,`${wall(o.wall)} · ${o.width} × ${o.height} ft · ${es?'desde izquierda':'from left'} ${o.x} ft · ${es?'antepecho':'sill'} ${o.sill} ft`]),
 ...s.porches.map((p,i)=>[`${es?'Porche':'Porch'} ${i+1}`,`${wall(p.wall)} · ${p.width} × ${p.depth} ft · ${es?'desde izquierda':'from left'} ${p.x} ft · ${p.height} ft ${es?'adosado':'attachment'} · ${p.pitch}:12`]),
 [es?'Alcance':'Scope',es?'Diseño exterior preliminar; sin distribución interior, cimentación ni cálculo estructural.':'Exterior shell concept; interior fit-out, foundation and structural engineering excluded.'],
 ];
}
