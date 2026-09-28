import {useId,memo} from 'react';
import type {ShopPart} from './types';
import {dimension,type Unit} from './fractions';
import PartFeatureDrawing,{featureCount} from './PartFeatureDrawing';

function PartDrawing({part,points=false,unit='fraction',features=true,revision=''}:{part:ShopPart;points?:boolean;unit?:Unit;features?:boolean;revision?:string}) {
  const inchFraction=(n:number)=>dimension(n,unit);
  const uid=useId().replace(/:/g,'');
  const count=features?featureCount(part):0,height=770+(count?45+Math.ceil(count/2)*370:0);
  const views=[{name:'Front · X / Y',axes:[0,1],x:30,y:95,w:650,h:305},{name:'Top · X / Z',axes:[0,2],x:30,y:475,w:650,h:180},{name:'Side · Z / Y',axes:[2,1],x:735,y:95,w:270,h:305}];
  return <svg id="shop-part-drawing" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 1040 ${height}`} role="img" aria-label={`${part.name} dimensioned front, top and side drawing`} style={{width:'100%',background:'white',color:'#173139',fontFamily:'Arial, sans-serif'}}>
    <title>{`${part.id} · ${part.name} — ${unit==='fraction'?'dimensions rounded to nearest 1/16 inch':unit==='mm'?'dimensions in millimeters':'dimensions in decimal inches'}`}</title>
    <defs><marker id={'arrow'+uid} markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M0 0L7 3.5L0 7Z" fill="#52757d"/></marker></defs>
    <rect x="10" y="10" width="1020" height={height-20} fill="none" stroke="#bbc7c9"/>
    <text x="30" y="38" fontSize="16" fontWeight="700">{part.id} · {part.name}{part.variant?' · '+part.variant:''}</text>
    <text x="30" y="61" fontSize="12" fill="#536970">QUANTITY {part.quantity} · {unit==='fraction'?'INCHES, NEAREST 1/16':unit==='mm'?'MILLIMETERS':'DECIMAL INCHES'} · REV {revision||'MODEL'} · NOT TO SCALE</text>
    {views.map(({name,axes:[a,b],x,y,w,h},vi)=>{
      const wa=part.dimensions[a]||1,hb=part.dimensions[b]||1,scale=Math.min((w-95)/wa,(h-75)/hb);
      const dw=wa*scale,dh=hb*scale,left=x+42+(w-90-dw)/2,top=y+28+(h-72-dh)/2;
      const px=(p:number[])=>left+p[a]/wa*dw,py=(p:number[])=>top+dh-p[b]/hb*dh;
      const plane=3-a-b;
      const cleanOutline=vi===0&&part.vertices.length>=3&&!part.radii.length&&!part.notches.length&&part.vertices.every(p=>Math.abs(p[plane]-part.vertices[0][plane])<.01);
      const contour=cleanOutline?part.vertices.map((p,i)=>`${i?'L':'M'}${px(p)} ${py(p)}`).join('')+'Z':'';
      const holeMarks=new Map<string,{cx:number;cy:number;labels:string[]}>();
      part.holes.forEach((hole,i)=>{const delta=hole.end.map((v,j)=>Math.abs(v-hole.start[j]));if(delta[plane]<Math.max(...delta)-.01)return;const cx=px(hole.start),cy=py(hole.start),key=`${cx.toFixed(2)},${cy.toFixed(2)}`;const mark=holeMarks.get(key)||{cx,cy,labels:[]};mark.labels.push(`H${i+1}`);holeMarks.set(key,mark);});
      const projected=new Set<string>(),paths:string[]=[];
      for(const [p,q] of part.edges){const coords=[px(p),py(p),px(q),py(q)].map(n=>Math.round(n*100)/100);if(Math.hypot(coords[0]-coords[2],coords[1]-coords[3])<.12)continue;const key=[coords.slice(0,2).join(','),coords.slice(2).join(',')].sort().join('/');if(!projected.has(key)){projected.add(key);paths.push(`M${coords[0]} ${coords[1]}L${coords[2]} ${coords[3]}`);}}
      const dim=(x1:number,y1:number,x2:number,y2:number,label:string,vertical=false)=><g stroke="#52757d" strokeWidth=".8"><path d={`M${x1} ${y1}L${x2} ${y2}`} markerStart={`url(#arrow${uid})`} markerEnd={`url(#arrow${uid})`}/><text x={(x1+x2)/2} y={(y1+y2)/2-7} textAnchor="middle" fill="#173139" stroke="none" fontSize="13" transform={vertical?`rotate(-90 ${(x1+x2)/2} ${(y1+y2)/2})`:undefined}>{label}</text></g>;
      return <g key={name}>
        <text x={x} y={y} fontSize="12" fontWeight="700" fill="#536970">{name}</text>
        {cleanOutline?<><defs><clipPath id={'outline'+uid+vi}><path d={contour}/></clipPath></defs><path d={contour} stroke="#29434b" strokeWidth=".8" fill="none"/><g clipPath={`url(#outline${uid}${vi})`} stroke="#29434b" strokeWidth=".8" fill="none">{part.holes.map((hole,i)=>Math.abs(hole.end[plane]-hole.start[plane])>.01?<circle key={i} cx={px(hole.start)} cy={py(hole.start)} r={hole.diameter*scale/2}/>:null)}</g></>:<path d={paths.join('')} stroke="#29434b" strokeWidth=".8" fill="none"/>}
        <path d={`M${left} ${top+dh+4}V${top+dh+28}M${left+dw} ${top+dh+4}V${top+dh+28}M${left-4} ${top}H${left-30}M${left-4} ${top+dh}H${left-30}`} stroke="#8a9fa4" strokeWidth=".7" fill="none"/>
        {dim(left,top+dh+23,left+dw,top+dh+23,inchFraction(wa))}
        {dim(left-25,top,left-25,top+dh,inchFraction(hb),true)}
        {[...holeMarks.entries()].map(([key,{cx,cy,labels}])=><g key={key} stroke="#19858d" strokeWidth=".7"><path d={`M${cx-5} ${cy}h10M${cx} ${cy-5}v10`}/><text x={cx+6} y={cy-6} fontSize="9" fill="#126b74" stroke="none">{labels.join('/')}</text></g>)}
        {points&&vi===0&&part.vertices.map((p,i)=><g key={i}><circle cx={px(p)} cy={py(p)} r="1.8" fill="#bd633b"/><text x={px(p)+3} y={py(p)-4} fontSize="8" fill="#98461d">P{i+1}</text></g>)}
        <text x={left} y={top+dh+44} fontSize="9" fill="#647d82">0,0 datum: lower-left corner of the drawing envelope</text>
      </g>;
    })}
    <path d="M10 697H1030" stroke="#bbc7c9"/><text x="30" y="719" fontSize="12">W {inchFraction(part.dimensions[0])} × H {inchFraction(part.dimensions[1])} × D {inchFraction(part.dimensions[2])} · {part.holes.length} modeled bores</text>
    <text x="30" y="741" fontSize="10" fill="#647d82">Use the accompanying exact dimensions for holes and fits. Tolerances and material grade require shop confirmation.</text>
    {count>0&&<><text x="30" y="784" fontSize="14" fontWeight="700">Hole centers & curve dimensions</text><PartFeatureDrawing part={part} uid={uid} unit={unit}/></>}
  </svg>;
}

export default memo(PartDrawing);
