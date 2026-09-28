import type {ShopPart,Point} from './types';
import {useId} from 'react';
import {dimension,exactMm,type Unit} from './fractions';

// Separate detail views keep every center and radius dimension clear of the outline.
export function featureCount(part:ShopPart){return part.holes.length+part.radii.length;}
export default function PartFeatureDrawing({part,uid,unit='fraction',start=0,limit=Infinity,originY=800}:{part:ShopPart;uid:string;unit?:Unit;start?:number;limit?:number;originY?:number}){
 const inchFraction=(n:number)=>dimension(n,unit);
 const features=[...part.holes.map((h,i)=>({label:'H'+(i+1),center:h.start,end:h.end,diameter:h.diameter,radius:0,mid:undefined as Point|undefined})),...part.radii.map((r,i)=>({label:'R'+(i+1),center:r.center,end:null,diameter:0,radius:r.radius,mid:r.mid}))];
 return <g>{features.slice(start,start+limit).map((f,i)=>{
  let plane=2;
  if(f.end){const d=f.end.map((n,j)=>Math.abs(n-f.center[j]));plane=d.indexOf(Math.max(...d));}
  else {const nearby=part.edges.filter(([p,q])=>[p,q].every(v=>Math.abs(Math.hypot(...v.map((n,j)=>n-f.center[j]))-f.radius)<Math.max(.05,f.radius*.002)));if(nearby.length){const ranges=[0,1,2].map(a=>Math.max(...nearby.flat().map(p=>p[a]))-Math.min(...nearby.flat().map(p=>p[a])));plane=ranges.indexOf(Math.min(...ranges));}}
  const [a,b]=plane===2?[0,1]:plane===1?[0,2]:[2,1],wa=part.dimensions[a]||1,hb=part.dimensions[b]||1,scale=Math.min(350/wa,190/hb),dw=wa*scale,dh=hb*scale,left=88+(350-dw)/2,top=80+(190-dh)/2;
  const px=(p:Point)=>left+p[a]*scale,py=(p:Point)=>top+dh-p[b]*scale,cx=px(f.center),cy=py(f.center),bottom=top+dh;
  const outline=part.edges.map(([p,q])=>`M${px(p)} ${py(p)}L${px(q)} ${py(q)}`).join('');
  const dim=(x1:number,y1:number,x2:number,y2:number,label:string,vertical=false)=><g><path d={`M${x1} ${y1}L${x2} ${y2}`} stroke="#19858d" strokeWidth=".8" markerStart={`url(#arrow${uid})`} markerEnd={`url(#arrow${uid})`}/><text x={(x1+x2)/2} y={(y1+y2)/2-7} textAnchor="middle" fontSize="12" fill="#126b74" transform={vertical?`rotate(-90 ${(x1+x2)/2} ${(y1+y2)/2})`:undefined}>{label}</text></g>;
  const curvePoint=f.mid||part.edges.flat().filter(p=>Math.abs(p[plane]-f.center[plane])<.1&&Math.abs(Math.hypot(...p.map((n,j)=>n-f.center[j]))-f.radius)<Math.max(.05,f.radius*.002)).sort((p,q)=>p[a]-q[a])[0];
  return <g key={f.label} transform={`translate(${20+(i%2)*510} ${originY+Math.floor(i/2)*370})`} data-feature={f.label}>
   <rect width="490" height="352" rx="4" fill="none" stroke="#c8d3d5"/>
   <text x="16" y="25" fontSize="14" fontWeight="700">{f.label} · {f.radius?'Radius '+inchFraction(f.radius):'Diameter Ø '+inchFraction(f.diameter)}{unit!=='mm'?' · '+exactMm(f.radius||f.diameter):''}</text>
   <text x="16" y="45" fontSize="11" fill="#536970">Center {['X','Y','Z'].map((s,j)=>s+' '+inchFraction(f.center[j])).join(' · ')}</text>
   <path d={outline} stroke="#73888d" strokeWidth=".65" fill="none"/>
   {!f.radius&&<><defs><clipPath id={'feature-stock-'+uid+i}><rect x={left} y={top} width={dw} height={dh}/></clipPath></defs><circle cx={cx} cy={cy} r={f.diameter*scale/2} fill="none" stroke="#126b74" strokeWidth="1.2" clipPath={`url(#feature-stock-${uid}${i})`}/></>}
   <path d={`M${cx-7} ${cy}h14M${cx} ${cy-7}v14`} stroke="#126b74" strokeWidth="1"/>
   <path d={`M${left} ${bottom+4}V${bottom+38}M${cx} ${cy+5}V${bottom+38}M${left-4} ${bottom}H${left-45}M${cx-5} ${cy}H${left-45}`} fill="none" stroke="#91b5ba" strokeWidth=".7" strokeDasharray="3 3"/>
   {Math.abs(f.center[a])>.01?dim(left,bottom+31,cx,bottom+31,inchFraction(f.center[a])):<text x={left} y={bottom+30} fontSize="12">0″</text>}
   {Math.abs(f.center[b])>.01?dim(left-38,bottom,left-38,cy,inchFraction(f.center[b]),true):<text x={left-35} y={bottom-6} fontSize="12">0″</text>}
   {f.radius>0&&curvePoint&&<g><path d={`M${cx} ${cy}L${px(curvePoint)} ${py(curvePoint)}L${left} 64H${left+65}`} stroke="#126b74" fill="none" strokeWidth="1" markerMid={`url(#arrow${uid})`}/><text x={left+70} y="68" fontSize="12" fill="#126b74">R {inchFraction(f.radius)}</text></g>}
   <text x="16" y="338" fontSize="10" fill="#647d82">{['Front','Top','Side'][plane===2?0:plane===1?1:2]} · Center offsets from lower-left datum · {unit==='fraction'?'nearest 1/16″':'exact model values'}</text>
  </g>;
 })}</g>;
}

export function FeaturePage({part,page=0,unit='fraction',revision=''}:{part:ShopPart;page?:number;unit?:Unit;revision?:string}){const uid=useId().replace(/:/g,'');return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 445" role="img" aria-label={part.name+' hole centers and curve dimensions page '+(page+1)} style={{width:'100%',background:'white',fontFamily:'Arial, sans-serif',color:'#173139'}}><defs><marker id={'arrow'+uid} markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M0 0L7 3.5L0 7Z" fill="#52757d"/></marker></defs><text x="20" y="25" fontSize="16" fontWeight="700">{part.id} · Hole centers &amp; curves · {page+1}/{Math.ceil(featureCount(part)/2)}</text><text x="20" y="47" fontSize="11">Revision {revision} · Coordinate datum: lower-left of the projected envelope · NOT TO SCALE</text><PartFeatureDrawing part={part} uid={uid} unit={unit} start={page*2} limit={2} originY={68}/></svg>;}
