import {useMemo,useState} from 'react';
import {format,partGroups,type Part,type Unit} from './walnut-dimensions';

export function PartThumbnail({part}:{part:Part}){
  const path=useMemo(()=>{
    const project=(i:number)=>{const x=part.e[i],y=part.e[i+1],z=part.e[i+2];return [(x-z)*.707,-y*.82+(x+z)*.408];};
    const points=[];for(let i=0;i<part.e.length;i+=3)points.push(project(i));
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY,scale=Math.min(230/Math.max(w,.01),115/Math.max(h,.01));
    const xy=(p:number[])=>`${((p[0]-minX-w/2)*scale+140).toFixed(2)},${((p[1]-minY-h/2)*scale+75).toFixed(2)}`;
    let d='';for(let i=0;i<points.length;i+=2)d+=`M${xy(points[i])}L${xy(points[i+1])}`;return d;
  },[part]);
  return <svg viewBox="0 0 280 150" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/></svg>;
}
export default function WalnutVisualParts({parts,unit,onSelect}:{parts:Part[];unit:Unit;onSelect:(id:string)=>void}){
  const [search,setSearch]=useState(''),[category,setCategory]=useState('All');
  const groups=useMemo(()=>partGroups(parts),[parts]);
  const visible=groups.filter(g=>(category==='All'||g[0].category===category)&&g.some(p=>`${p.name} ${p.stock} ${p.id} ${p.sourceName}`.toLowerCase().includes(search.toLowerCase())));
  return <section className="wt-visual-schedule" aria-label="Visual parts schedule">
    <div className="wt-card-filters"><input type="search" aria-label="Search parts schedule" placeholder="Find a part…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Schedule part category" value={category} onChange={e=>setCategory(e.target.value)}><option>All</option>{[...new Set(parts.map(p=>p.category))].map(c=><option key={c}>{c}</option>)}</select><span>{parts.length} pieces · {groups.length} groups</span></div>
    <div className="wt-part-cards">{visible.map(group=>{const p=group[0];return <button className="wt-part-card" key={p.id} data-quantity={group.reduce((n,p)=>n+p.quantity,0)} onClick={()=>onSelect(p.id)} aria-label={`Inspect ${p.name} ${p.id}`}><div className="wt-card-image"><PartThumbnail part={p}/><span>{group.length} {group.length===1?'piece':'pieces'}</span></div><div className="wt-card-copy"><strong>{p.name}</strong><small>{p.stock}</small><b>{p.bounds.map(v=>format(v,unit)).join(' × ')}</b><span>Outside size · X × Y × Z</span></div></button>;})}</div>
    {!visible.length&&<p>No matching parts.</p>}
  </section>;
}
