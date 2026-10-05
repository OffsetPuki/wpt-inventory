import {format,type Part,type Unit} from './walnut-dimensions';
export default function PartDrawing({part,unit}:{part:Part;unit:Unit}){
  const projections:[string,number,number,string,string][]=[['End / width × height',1,2,'Y','Z'],['Top / length × width',0,1,'X','Y'],['Side / length × height',0,2,'X','Z']];
  return <svg className="wt-drawing" viewBox="0 0 900 250" role="img" aria-label={`${part.name}: front, top and side dimensions`}>
    {projections.map(([label,a,b,al,bl],index)=>{
      const dx=part.bounds[a],dy=part.bounds[b],scale=Math.min(212/Math.max(dx,.001),150/Math.max(dy,.001));
      const left=150-dx*scale/2,base=120+dy*scale/2;
      const points=(j:number)=>[part.e[j]+66,-part.e[j+2],part.e[j+1]];
      const seen=new Set<string>(),lines=[];
      for(let j=0;j<part.e.length;j+=6){const p=points(j),q=points(j+3);const vals=[left+(p[a]-part.min[a])*scale,base-(p[b]-part.min[b])*scale,left+(q[a]-part.min[a])*scale,base-(q[b]-part.min[b])*scale];
        const key=vals.map(v=>v.toFixed(2)).join(',');if(seen.has(key))continue;seen.add(key);lines.push(<line key={j} x1={vals[0]} y1={vals[1]} x2={vals[2]} y2={vals[3]} stroke="#344941" strokeWidth="1"/>);}
      return <g key={label} transform={`translate(${index*300},0)`}><text x="150" y="20" textAnchor="middle" fontSize="11" fill="#344941">{label}</text>{lines}<line x1={left} x2={left+dx*scale} y1="207" y2="207" stroke="#a96d2d"/><path d={`M${left},203v8 M${left+dx*scale},203v8`} stroke="#a96d2d"/><text x="150" y="224" textAnchor="middle" fontSize="11">{al}: {format(dx,unit)}</text><text x="150" y="242" textAnchor="middle" fontSize="11">{bl}: {format(dy,unit)}</text></g>;
    })}
  </svg>;
}
