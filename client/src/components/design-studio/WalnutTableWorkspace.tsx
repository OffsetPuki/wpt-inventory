import {lazy,Suspense,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {Box,Download,Maximize,Minimize,PencilRuler,Printer} from 'lucide-react';
import './film-studio.css';
import './walnut-studio.css';

const WalnutModel=lazy(()=>import('./WalnutModel'));
import {format,dimensionGroups,partFamily,type Unit,type Measure,type Part,type Variant,type Catalog} from './walnut-dimensions';
import WalnutVisualParts from './WalnutVisualParts';
function saveCsv(variant:Variant,revision:string){
  const rows=[['Part ID','Part','Quantity','Category','Material / stock','X envelope (in)','Y envelope (in)','Z envelope (in)','Measurements (in)','Notes']];
  for(const p of variant.parts)rows.push([p.id,p.sourceName,String(p.quantity),p.category,p.stock,...p.bounds.map(v=>v.toFixed(6)),p.measurements.map(m=>`${m.label}: ${m.inches.toFixed(6)}`).join('; '),p.notes.join(' ')]);
  for(const detail of variant.integratedDetails)rows.push(['Included detail',detail.name,String(detail.quantity),'Integrated closure','Steel plate',...detail.profile.map(String),'Nominal profile; included in parent meshes',detail.note]);
  const csv=rows.map(row=>row.map(s=>'"'+s.replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`walnut-parts-${variant.topThickness}in-top-${revision}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function PartDrawing({part,unit}:{part:Part;unit:Unit}){
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
function Measurements({values,unit}:{values:Measure[];unit:Unit}){return <dl className="wt-measures">{values.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{format(m.inches,unit)}</dd></div>)}</dl>;}
function Schedule({variant,unit,onSelect}:{variant:Variant;unit:Unit;onSelect:(id:string)=>void}){
  return <div className="wt-table-scroll"><table><caption>All modeled components — dimensions along assembly axes, not a final cut list</caption><thead><tr><th>Part</th><th>Qty</th><th>Material / stock</th><th>X × Y × Z envelope</th><th>Key measurements</th></tr></thead><tbody>{variant.parts.map(p=><tr key={p.id}><td><button onClick={()=>onSelect(p.id)}>{p.id} · {p.sourceName}</button></td><td>{p.quantity}</td><td>{p.stock}</td><td>{p.bounds.map(v=>format(v,unit)).join(' × ')}</td><td>{p.measurements.filter(m=>!m.label.startsWith('Tube outside')).map(m=><div key={m.label}>{m.label}: {format(m.inches,unit)}</div>)}</td></tr>)}</tbody></table></div>;
}
function IntegratedDetails({variant,unit,notes}:{variant:Variant;unit:Unit;notes:string[]}){return <><p>These closures are included in the tube meshes. They are listed here so the parts schedule does not omit them.</p><table><thead><tr><th>Included detail</th><th>Qty</th><th>Nominal profile × thickness</th><th>Notes</th></tr></thead><tbody>{variant.integratedDetails.map(d=><tr key={d.name}><td>{d.name}</td><td>{d.quantity}</td><td>{d.profile.map(v=>format(v,unit)).join(' × ')}</td><td>{d.note}</td></tr>)}</tbody></table><ul>{notes.map(n=><li key={n}>{n}</li>)}</ul></>;}
export default function WalnutTableWorkspace(){
  const [top,setTop]=useState('3'),[unit,setUnit]=useState<Unit>('fraction');
  const [mode,setMode]=useState('model'),[selected,setSelected]=useState('');
  const [finder,setFinder]=useState(false),[filter,setFilter]=useState(''),[category,setCategory]=useState('All');
  const [hiddenParts,setHiddenParts]=useState<string[]>([]),[showTop,setShowTop]=useState(false);
  const [fullscreen,setFullscreen]=useState(false),[enlarge,setEnlarge]=useState(false),[dimensions,setDimensions]=useState(true),[dimensionMode,setDimensionMode]=useState('table');
  const query=useQuery<Catalog>({queryKey:['walnut-table-parts'],queryFn:async({signal})=>(await apiRequest('GET','/api/design-studio/walnut-table',undefined,{signal})).json(),staleTime:60000});
  const data=query.data,variant=data?.variants[top],part=variant?.parts.find(p=>p.id===selected);
  const choose=(id:string)=>{setSelected(id);setHiddenParts(v=>v.filter(p=>p!==id));setMode('parts');setDimensions(true);setFinder(false);setEnlarge(false);};
  const allParts=()=>{setSelected('');};
  useEffect(()=>{if(!fullscreen)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFullscreen(false);};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=old;window.removeEventListener('keydown',escape);};},[fullscreen]);
  return <section className={'film-studio wt-workspace'+(fullscreen?' is-fullscreen':'')} aria-label="Walnut table parts and dimensions" data-fullscreen={fullscreen} data-open="true">
    <header className="fs-header"><div><span className="fs-eyebrow">Parts &amp; dimensions · Internal workspace</span><h2>Dallas table</h2><p>11′ × 48″ walnut dining table · Bridge frame · 10 seats</p></div><div className="fs-header-actions"><button onClick={()=>setFullscreen(v=>!v)}>{fullscreen?<Minimize size={16}/>:<Maximize size={16}/>} {fullscreen?'Exit fullscreen':'Fullscreen'}</button></div></header>
    <div className="fs-toolbar"><nav className="fs-tabs" aria-label="Walnut workspace views">
      <button aria-pressed={mode==='model'} onClick={()=>{setMode('model');allParts();setFinder(false);}}><Box size={16}/>View model</button>
      <button aria-pressed={mode==='parts'} onClick={()=>setMode('parts')}><PencilRuler size={16}/>View parts</button>
      <button aria-pressed={mode==='schedule'} onClick={()=>setMode('schedule')}>Parts schedule</button>
      <button aria-pressed={mode==='dimensions'} onClick={()=>{setMode('dimensions');setDimensions(true);}}>Overall dimensions</button>
    </nav></div>
    <div className="fs-body wt-body">
      {query.isPending&&<p role="status">Loading current Dallas model…</p>}
      {query.isError&&<div role="alert">Could not load the parts. <button onClick={()=>query.refetch()}>Try again</button></div>}
      {data&&variant&&<>
        <div className="wt-toolbar"><label>Walnut top<select aria-label="Walnut top thickness" value={top} onChange={e=>setTop(e.target.value)}><option value="3">3 inches · 418 lb top</option><option value="2">2 inches · 280 lb top</option></select></label><label>Dimensions<select aria-label="Walnut dimension units" value={unit} onChange={e=>setUnit(e.target.value as Unit)}><option value="fraction">Inches · nearest 1/16</option><option value="inch">Decimal inches</option><option value="mm">Millimeters</option></select></label><div className="wt-actions"><button onClick={()=>saveCsv(variant,data.revision)}><Download size={15}/>Download parts CSV</button><button onClick={()=>window.print()}><Printer size={15}/>Print parts &amp; dimensions</button></div></div>
        <p className="wt-brief">Model dimensions · Design review</p>
        {(mode==='model'||mode==='parts'||mode==='dimensions')&&<>
          <div className="wt-visual-inspector">
            <div className="fs-viewer-card">
              {mode==='parts'&&part&&<div className="wt-selected-summary"><h3>{part.name}</h3><span>{part.stock}</span><select aria-label="Selected piece" value={selected} onChange={e=>choose(e.target.value)}>{variant.parts.filter(p=>partFamily(p)===partFamily(part)).map(p=><option key={p.id} value={p.id}>{p.id} · {p.location}</option>)}</select></div>}
              <div className="fs-actions">
                {mode==='parts'&&<><button aria-expanded={finder} onClick={()=>setFinder(v=>!v)}>Find a part</button>{part&&<><button onClick={allParts}>Back to all parts</button><button onClick={()=>{setHiddenParts(v=>[...new Set([...v,selected])]);allParts();}}>Hide this piece</button></>}</>}
                {hiddenParts.length>0&&<button onClick={()=>setHiddenParts([])}>Show all ({hiddenParts.length} hidden)</button>}
                {(mode!=='parts'||!part)&&<label><input type="checkbox" checked={showTop} onChange={e=>setShowTop(e.target.checked)}/> Show walnut top</label>}
              </div>
              {mode==='parts'&&finder&&<aside className="wt-part-list wt-finder"><label>Search parts<input type="search" aria-label="Search walnut parts" placeholder="Leg, rail, foot, tab…" value={filter} onChange={e=>setFilter(e.target.value)}/></label><label>Part type<select aria-label="Walnut part category" value={category} onChange={e=>setCategory(e.target.value)}><option>All</option>{Array.from(new Set(variant.parts.map(p=>p.category))).map(c=><option key={c}>{c}</option>)}</select></label><div className="wt-list" aria-label="Walnut components">{variant.parts.filter(p=>(category==='All'||p.category===category)&&`${p.id} ${p.name} ${p.sourceName} ${p.stock}`.toLowerCase().includes(filter.toLowerCase())).map(p=><button key={p.id} aria-current={selected===p.id?'true':undefined} onClick={()=>choose(p.id)}><strong>{p.id} · {p.name}</strong><span>{p.location} · Qty {p.quantity}{hiddenParts.includes(p.id)?' · Hidden':''}</span><small>{p.sourceName}</small></button>)}</div></aside>}
              <div className="wt-dimension-controls"><label><input type="checkbox" checked={dimensions} onChange={e=>setDimensions(e.target.checked)}/> Dimensions on model</label>{!(mode==='parts'&&part)&&<select aria-label="Measurement group" value={dimensionMode} onChange={e=>{setDimensionMode(e.target.value);setShowTop(false);setDimensions(true);}}>{dimensionGroups.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</div>
              <Suspense fallback={<p role="status">Opening 3D view…</p>}><WalnutModel parts={variant.parts} selected={mode==='parts'?selected:''} isolate={mode==='parts'&&!!part} showTop={showTop} hiddenParts={mode==='dimensions'?[]:hiddenParts} onSelect={choose} variant={variant} unit={unit} dimensions={dimensions} dimensionMode={dimensionMode}/></Suspense>
              {mode==='parts'&&part&&<div className="wt-part-facts">{part.measurements.filter(m=>!m.label.startsWith('Tube outside')).slice(0,3).map(m=><div key={m.label}><strong>{format(m.inches,unit)}</strong><span>{m.label}</span></div>)}</div>}
            </div>
            {mode==='parts'&&part&&<article className="fs-sheet wt-part-detail" aria-label="Walnut selected part">
              <details><summary>Drawing &amp; full measurements</summary><h3>{part.name}</h3><p>{part.id} · {part.stock}</p><Measurements values={part.measurements} unit={unit}/>
              <div className="fs-actions"><button onClick={()=>setEnlarge(v=>!v)}>{enlarge?'Fit drawing':'Enlarge drawing'}</button></div><div className={'wt-drawing-scroll'+(enlarge?' is-enlarged':'')}><PartDrawing part={part} unit={unit}/></div>
              <h4>Position and outside dimensions</h4><Measurements values={part.bounds.map((v,i)=>({label:`${['X · table length','Y · across table','Z · vertical'][i]} envelope`,inches:v}))} unit={unit}/><p className="wt-hint">X: {format(part.min[0],unit)} to {format(part.max[0],unit)} · Y: {format(part.min[1],unit)} to {format(part.max[1],unit)} · Z: {format(part.min[2],unit)} to {format(part.max[2],unit)}</p><ul>{part.notes.map(note=><li key={note}>{note}</li>)}</ul></details>
            </article>}
          </div>
        </>}
        {mode==='schedule'&&<WalnutVisualParts parts={variant.parts} unit={unit} onSelect={choose}/>}
        {mode==='dimensions'&&<details className="wt-overall wt-detail-drawer"><summary>All measurement values</summary><Measurements values={variant.assemblyDimensions} unit={unit}/></details>}
        <details className="wt-integrated"><summary>Notes &amp; included closures</summary><p>Confirm joints, tolerances and cut allowances before fabrication. Fractions round to 1/16″; decimal inches preserve model precision.</p><IntegratedDetails variant={variant} unit={unit} notes={data.notes}/></details>
        <p className="wt-revision"><span>{variant.parts.length} modeled components</span> · Revision {data.revision}</p>
        <div className="wt-print"><h2>Dallas table — parts &amp; dimensions</h2><p>{top}″ top · 30″ finished height · Revision {data.revision}</p><p>Model measurements only. Not a released cutting schedule. X = table length; Y = width; Z = height.</p><Measurements values={variant.assemblyDimensions} unit={unit}/><Schedule variant={variant} unit={unit} onSelect={choose}/><h3>End caps, sole closures &amp; drawing notes</h3><IntegratedDetails variant={variant} unit={unit} notes={data.notes}/>{part&&<><h3>{part.id} · {part.name}</h3><PartDrawing part={part} unit={unit}/><Measurements values={part.measurements} unit={unit}/>{part.notes.map(n=><p key={n}>{n}</p>)}</>}</div>
      </>}
    </div>
  </section>;
}
