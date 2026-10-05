import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {useAuth} from '@/lib/auth';
import {Download,Maximize,Minimize,Printer,Settings2,Check,RotateCcw} from 'lucide-react';
import {dimensionGroups,format,type Catalog,type Unit,type Variant} from './walnut-dimensions';
import {cuttingItems,cuttingStorageKey,readCutEntries,validCutEntry,cuttingCsv,itemStatus,partMeasures,type CutEntries,type CutItem,type CutEntry} from './walnut-cutting';
import {PartThumbnail} from './WalnutVisualParts';
import PartDrawing from './WalnutPartDrawing';
import './film-studio.css';
import './walnut-studio.css';
import './walnut-shop.css';
const WalnutModel=lazy(()=>import('./WalnutModel'));
const noHidden:string[]=[];

function download(items:CutItem[],entries:CutEntries,top:string,revision:string){
  const url=URL.createObjectURL(new Blob(['\ufeff'+cuttingCsv(items,entries)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`dallas-cutting-${top}in-top-${revision}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function CutPrint({items,entries,top,revision}:{items:CutItem[];entries:CutEntries;top:string;revision:string}){
  return <div className="wt-print"><h2>Dallas table · Cutting checklist</h2><p>132 × 48 × 30 inches · {top}″ walnut top · Model {revision}</p><p>Shop sizes below are user-confirmed. Blank sizes still require detailing. Model references are not released cut lengths. Confirm joints, caps, fit and tolerances before cutting.</p><table><thead><tr><th>Part / stock</th><th>Qty</th><th>Shop size · inches</th><th>End cuts / profile</th><th>Cut</th></tr></thead><tbody>{items.map(item=>{const e=validCutEntry(entries[item.id],item);return <tr key={item.id}><td><strong>{item.name}</strong><br/>{item.stock}</td><td>{item.quantity}</td><td>{e.confirmed?e.size:'NEEDS DETAIL'}</td><td>{e.confirmed?e.ends:item.instruction}</td><td>{e.done} / {item.quantity}</td></tr>;})}</tbody></table><p>Includes 14 tube end caps and 4 foot sole closures. Prepare the 13 bearing strips separately; walnut top is excluded from metal cutting.</p></div>;
}
function ShopWorkspace({data,variant,top,setTop,userId}:{data:Catalog;variant:Variant;top:string;setTop:(v:string)=>void;userId:number}){
  const items=useMemo(()=>cuttingItems(variant),[variant]),key=cuttingStorageKey(userId,data.revision,top);
  const [entries,setEntries]=useState<CutEntries>(()=>{try{return readCutEntries(localStorage.getItem(key),items);}catch{return readCutEntries(null,items);}});
  const [saveError,setSaveError]=useState(false),[selected,setSelected]=useState(''),[piece,setPiece]=useState('');
  const [unit,setUnit]=useState<Unit>('fraction'),[dimensions,setDimensions]=useState(true),[dimensionMode,setDimensionMode]=useState('frame');
  const [showTop,setShowTop]=useState(false),[fullscreen,setFullscreen]=useState(false),[settings,setSettings]=useState(false),[search,setSearch]=useState(''),[pendingOnly,setPendingOnly]=useState(false);
  const current=items.find(item=>item.id===selected),part=variant.parts.find(p=>p.id===piece),entry=current?validCutEntry(entries[current.id],current):null;
  const total=items.reduce((n,item)=>n+item.quantity,0),done=items.reduce((n,item)=>n+validCutEntry(entries[item.id],item).done,0);
  const save=()=>{try{const serialized=JSON.stringify(entries);if(localStorage.getItem(key)!==serialized)localStorage.setItem(key,serialized);setSaveError(false);}catch{setSaveError(true);}};
  useEffect(save,[entries,key]);
  useEffect(()=>{const receive=(e:StorageEvent)=>{if(e.key===key)setEntries(old=>{const next=readCutEntries(e.newValue,items);return JSON.stringify(old)===JSON.stringify(next)?old:next;});};window.addEventListener('storage',receive);return()=>window.removeEventListener('storage',receive);},[key,items]);
  useEffect(()=>{if(!fullscreen)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFullscreen(false);};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=old;window.removeEventListener('keydown',escape);};},[fullscreen]);
  const choose=(item:CutItem,id=item.parts[0].id)=>{setSelected(item.id);setPiece(id);setDimensions(true);};
  const pick=(id:string)=>{const item=items.find(item=>item.kind!=='closure'&&item.parts.some(p=>p.id===id));if(item)choose(item,id);};
  const update=(change:Partial<CutEntry>)=>{if(current)setEntries(old=>({...old,[current.id]:validCutEntry({...validCutEntry(old[current.id],current),...change},current)}));};
  const visible=items.filter(item=>(!pendingOnly||validCutEntry(entries[item.id],item).done<item.quantity)&&`${item.name} ${item.stock} ${item.parts.map(p=>p.id).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={'film-studio wt-workspace wt-shop'+(fullscreen?' is-fullscreen':'')} aria-label="Walnut table parts and dimensions" data-open="true" data-fullscreen={fullscreen}>
    <header className="wt-shop-header"><div><h2>Dallas table</h2><p>{top}″ top · 132 × 48 × 30″ · ⅛″ tube wall</p></div><div className="wt-actions"><button onClick={()=>window.print()}><Printer size={16}/>Print cutting list</button><button aria-expanded={settings} aria-label="Shop settings" onClick={()=>setSettings(v=>!v)}><Settings2 size={16}/>Options</button><button aria-label={fullscreen?'Exit fullscreen':'Fullscreen'} onClick={()=>setFullscreen(v=>!v)}>{fullscreen?<Minimize size={16}/>:<Maximize size={16}/>}</button></div></header>
    {settings&&<div className="wt-shop-settings"><label>Top<select aria-label="Walnut top thickness" value={top} onChange={e=>setTop(e.target.value)}><option value="3">3 inches · 418 lb</option><option value="2">2 inches · 280 lb</option></select></label><label>Display units<select aria-label="Walnut dimension units" value={unit} onChange={e=>setUnit(e.target.value as Unit)}><option value="fraction">Inches · 1/16</option><option value="inch">Decimal inches</option><option value="mm">Millimeters</option></select></label><label>Frame measurements<select aria-label="Measurement group" value={dimensionMode} onChange={e=>{setDimensionMode(e.target.value);setDimensions(true);}}>{dimensionGroups.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label><input type="checkbox" checked={showTop} onChange={e=>setShowTop(e.target.checked)}/>Show walnut top</label><button onClick={()=>download(items,entries,top,data.revision)}><Download size={15}/>Download cutting CSV</button><p>Cut sizes are entered in inches. Each top has its own checklist.</p></div>}
    <div className="wt-shop-grid">
      <div className="wt-shop-model"><div className="wt-shop-modelbar"><button disabled={!selected} onClick={()=>{setSelected('');setPiece('');}}>Full frame</button><label><input type="checkbox" checked={dimensions} onChange={e=>setDimensions(e.target.checked)}/>Dimensions</label><span>{current?current.name:'Click a piece to work on it'}</span></div>
        <Suspense fallback={<p role="status">Opening model…</p>}><WalnutModel parts={variant.parts} selected={piece} isolate={!!piece} showTop={showTop} hiddenParts={noHidden} onSelect={pick} variant={variant} unit={unit} dimensions={dimensions} dimensionMode={dimensionMode}/></Suspense>
        {current&&part&&<details className="wt-shop-drawing"><summary>Part drawing &amp; reference dimensions</summary><p>{current.instruction}</p><p><strong>Model references — not final cut sizes</strong></p><div className="wt-drawing-scroll"><PartDrawing part={part} unit={unit}/></div><dl className="wt-measures">{partMeasures(part,unit).map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl><ul>{part.notes.map(n=><li key={n}>{n}</li>)}</ul></details>}
      </div>
      <aside className="wt-cut-panel" aria-label="Cutting checklist"><header><h3>Cutting list</h3><strong aria-label="Cutting progress">{done} / {total} cut</strong></header><progress value={done} max={total}/>
        <p className="wt-save-state" role="status">{saveError?<>Checklist not saved. <button onClick={save}>Retry save</button></>:'Checklist saved on this device'}</p>
        {current&&entry?<article className="wt-cut-detail" aria-label="Selected cutting part"><div className="wt-cut-title"><h3>{current.name}</h3><b>× {current.quantity}</b></div><p>{current.stock}</p>
          {current.kind==='closure'&&<p>Parent tube shown · closure included in that mesh</p>}
          <div className="wt-cut-reference">{current.reference}</div>
          {!entry.confirmed?<><p className="wt-cut-instruction">{current.instruction}</p><label>Shop cut size · inches<input aria-label="Shop cut size in inches" maxLength={120} value={entry.size} placeholder={current.kind==='straight'?'Final length':'Confirmed blank size / template'} onChange={e=>update({size:e.target.value,confirmed:false})}/></label><label>End cuts / profile<input aria-label="End cuts or profile" maxLength={160} value={entry.ends} placeholder="Angles, reference edge or template" onChange={e=>update({ends:e.target.value,confirmed:false})}/></label><button className="wt-confirm-cut" disabled={!entry.size.trim()||!entry.ends.trim()} onClick={()=>update({confirmed:true})}><Check size={16}/>Confirm shop size</button></>:<><div className="wt-confirmed-size"><strong>{entry.size}</strong><span>inches · {entry.ends}</span></div><div className="wt-count-controls"><button disabled={entry.done===0} aria-label="Undo one cut piece" onClick={()=>update({done:entry.done-1})}><RotateCcw size={14}/></button><span>{entry.done} / {current.quantity} cut</span><button disabled={entry.done===current.quantity} onClick={()=>update({done:entry.done+1})}><Check size={15}/>{entry.done===current.quantity?'Complete':'Mark 1 cut'}</button></div><button className="wt-edit-size" disabled={entry.done>0} onClick={()=>update({confirmed:false})}>Edit shop size</button>{entry.done>0&&<small>Undo cut counts before changing the size.</small>}</>}
          {current.parts.length>1&&<label className="wt-piece-select">Model piece<select aria-label="Selected piece" value={piece} onChange={e=>setPiece(e.target.value)}>{current.parts.map(p=><option key={p.id} value={p.id}>{p.id} · {p.location}</option>)}</select></label>}
        </article>:<p className="wt-cut-intro">Choose a part → confirm its cut size → mark pieces cut.</p>}
        <div className="wt-cut-filter"><input type="search" aria-label="Find cutting part" placeholder="Find a part…" value={search} onChange={e=>setSearch(e.target.value)}/><label><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/>Unfinished</label></div>
        <div className="wt-cut-rows">{visible.map(item=>{const e=validCutEntry(entries[item.id],item);return <button key={item.id} className={'wt-cut-row'+(selected===item.id?' is-selected':'')} aria-label={`Work on ${item.name} ${item.id}`} aria-pressed={selected===item.id} onClick={()=>choose(item)}><PartThumbnail part={item.parts[0]}/><span><strong>{item.name}</strong><small>{item.reference}</small><em className={e.confirmed?'is-ready':''}>{itemStatus(item,e)}</em></span><b>{e.done}/{item.quantity}</b></button>;})}</div>
        {!visible.length&&<p>No matching unfinished parts.</p>}
      </aside>
    </div>
    <details className="wt-shop-notes"><summary>Assembly notes &amp; other materials</summary><p>13 bearing strips and the walnut top are not metal-cutting items. End caps and sole closures are listed separately although they are integrated in the model.</p><p>Fractional model labels round to 1/16″; use decimal inches for precision. Shop sizes are confirmed by you and saved only on this device for this account, model revision and top option.</p><ul>{data.notes.map(n=><li key={n}>{n}</li>)}</ul><dl className="wt-measures">{variant.assemblyDimensions.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{format(m.inches,unit)}</dd></div>)}</dl></details>
    <CutPrint items={items} entries={entries} top={top} revision={data.revision}/>
  </section>;
}
function TableSession({data,userId}:{data:Catalog;userId:number}){
  const choiceKey=`cjm.dallas.top:${userId}`;
  const [top,setCurrentTop]=useState(()=>{try{return localStorage.getItem(choiceKey)==='2'?'2':'3';}catch{return '3';}});
  const setTop=(value:string)=>{try{localStorage.setItem(choiceKey,value);}catch{}setCurrentTop(value);};
  return <ShopWorkspace key={`${userId}:${data.revision}:${top}`} data={data} variant={data.variants[top]} top={top} setTop={setTop} userId={userId}/>;
}
export default function WalnutTableWorkspace(){
  const {user}=useAuth();
  const query=useQuery<Catalog>({queryKey:['walnut-table-parts'],queryFn:async({signal})=>(await apiRequest('GET','/api/design-studio/walnut-table',undefined,{signal})).json(),staleTime:60000});
  if(query.isPending)return <p role="status">Opening Dallas table…</p>;
  if(query.isError)return <p role="alert">Could not open the model. <button onClick={()=>query.refetch()}>Try again</button></p>;
  if(!user)return null;
  return <TableSession key={user.id} data={query.data} userId={user.id}/>;
}
