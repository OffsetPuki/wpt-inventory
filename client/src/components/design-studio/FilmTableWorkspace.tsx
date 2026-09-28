import {lazy,Suspense,useState,useEffect,useCallback} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Box,PencilRuler,ListChecks,Download,Maximize,Minimize} from 'lucide-react';
import {apiRequest} from '@/lib/queryClient';
import type {ShopCatalog,ShopPart} from './types';
import type {Unit} from './fractions';
import PartSheet from './PartSheet';
import {MeasurementContext} from './MeasurementContext';
import {downloadFile} from './manufacturing';
import './film-studio.css';
const FilmModel=lazy(()=>import('./FilmModel'));
const PartExplorer=lazy(()=>import('./PartExplorer'));
const CutList=lazy(()=>import('./CutList'));
function PartDetail({id,revision}:{id:string;revision:string}){
 const query=useQuery<ShopPart>({queryKey:['film-shop-part',revision,id],queryFn:async({signal})=>(await apiRequest('GET','/api/design-studio/film-table/parts/'+id+'?revision='+revision,undefined,{signal})).json(),staleTime:Infinity});
 if(query.isPending)return <p role="status">Opening drawing…</p>;
 if(query.isError)return <div role="alert">Could not open this revision of the drawing. <button onClick={()=>query.refetch()}>Try again</button></div>;
 return <PartSheet part={query.data} revision={revision}/>;
}
export default function FilmTableWorkspace(){
 const [mode,setMode]=useState<'model'|'parts'|'cuts'|null>('model'),[selected,setSelected]=useState(''),[requestedPart,setRequestedPart]=useState(''),[hiddenParts,setHiddenParts]=useState<string[]>([]),[fullscreen,setFullscreen]=useState(false),[tab,setTab]=useState<'3d'|'drawing'>('3d'),[unit,setUnit]=useState<Unit>('fraction'),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[saved,setSaved]=useState(false);
 const catalog=useQuery<ShopCatalog>({queryKey:['film-shop-catalog'],queryFn:async({signal})=>(await apiRequest('GET','/api/design-studio/film-table/parts',undefined,{signal})).json(),enabled:!!mode,staleTime:60000});
 const choose=useCallback((id:string)=>{setSelected(id);setTab('3d');},[]);
 const openPart=(id:string)=>{setRequestedPart(id);setMode('parts');setTab('3d');};
 useEffect(()=>{setSelected('');setRequestedPart('');setHiddenParts([]);setSaved(false);},[catalog.data?.revision]);
 useEffect(()=>{if(!fullscreen)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFullscreen(false);};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',escape);};},[fullscreen]);
 const download=async()=>{setSaving(true);setSaveError('');try{const r=await apiRequest('GET','/api/design-studio/film-table/field-book?revision='+catalog.data?.revision);downloadFile(await r.text(),'film-table-field-book-'+catalog.data?.revision+'.html','text/html');setSaved(true);}catch(e){setSaveError(e instanceof Error?e.message:'Could not save the field book.');}finally{setSaving(false);}};
 return <MeasurementContext.Provider value={unit}><section className={'film-studio'+(fullscreen?' is-fullscreen':'')} aria-label="Film table design workspace" data-fullscreen={fullscreen}>
  <header className="fs-header"><div><span className="fs-eyebrow">Fabrication workspace</span><h2>Film stretching table</h2><p>6 × 6 m · Six staggered rolls · Bolted assembly</p></div><div className="fs-header-actions">{mode&&<><button onClick={()=>setFullscreen(v=>!v)}>{fullscreen?<Minimize size={16}/>:<Maximize size={16}/>} {fullscreen?'Exit fullscreen':'Fullscreen'}</button><button onClick={()=>{setMode(null);setSelected('');setFullscreen(false);}}>Close workspace</button></>}</div></header>
  <div className="fs-toolbar"><nav className="fs-tabs" aria-label="Workspace views"><button aria-pressed={mode==='model'} onClick={()=>{setMode('model');setSelected('');setRequestedPart('');}}><Box size={16}/>View model</button><button aria-pressed={mode==='parts'} onClick={()=>{setMode('parts');setRequestedPart('');}}><PencilRuler size={16}/>View parts</button><button aria-pressed={mode==='cuts'} onClick={()=>{setMode('cuts');setSelected('');}}><ListChecks size={16}/>Cut list</button></nav><div className="fs-actions" style={{margin:0}}><label className="fs-unit-label">Units<select aria-label="Dimension units" value={unit} onChange={e=>setUnit(e.target.value as Unit)}><option value="fraction">Inches · 1/16</option><option value="inch">Decimal inches</option><option value="mm">Millimeters</option></select></label><button disabled={saving||!catalog.data} onClick={download}><Download size={15}/>{saving?'Preparing field book…':'Save offline field book'}</button></div></div>
  <div className="fs-body">{saved&&<p className="fs-notice" role="status">Field book downloaded. Keep the HTML file on your device for drawings and dimensions without internet. Animation stays in the online model.</p>}{saveError&&<p role="alert" className="fs-notice">{saveError}</p>}
  {!mode&&<p className="fs-empty">Open the model to play the full process, inspect a part, or use the cut list for fabrication details.</p>}
  {mode&&catalog.isPending&&<p role="status">Loading workspace…</p>}{mode&&catalog.isError&&<div role="alert">Could not load the drawings. <button onClick={()=>catalog.refetch()}>Try again</button></div>}
  {mode==='model'&&catalog.data&&<div className="fs-viewer-card">{hiddenParts.length>0&&<div className="fs-actions"><button onClick={()=>setHiddenParts([])}>Show all ({hiddenParts.length} hidden)</button></div>}<Suspense fallback={<p role="status">Opening model…</p>}><FilmModel revision={catalog.data.revision} hiddenParts={hiddenParts}/></Suspense></div>}
  {mode==='cuts'&&catalog.data&&<Suspense fallback={<p role="status">Opening cut list…</p>}><CutList catalog={catalog.data} onOpen={openPart}/></Suspense>}
  {mode==='parts'&&catalog.data&&<>{selected&&<div className="fs-mobile-tabs fs-tabs" role="group" aria-label="Selected part view"><button aria-pressed={tab==='3d'} onClick={()=>setTab('3d')}>3D part</button><button aria-pressed={tab==='drawing'} onClick={()=>setTab('drawing')}>Drawing &amp; dimensions</button></div>}<div className={selected?'fs-work-grid':''}>
   <div className={'fs-viewer-card'+(selected&&tab==='drawing'?' fs-mobile-hidden':'')}><Suspense fallback={<p role="status">Opening parts…</p>}><PartExplorer parts={catalog.data.parts} revision={catalog.data.revision} onSelect={choose} hiddenParts={hiddenParts} onHiddenChange={setHiddenParts} requestedPart={requestedPart}/></Suspense></div>
   {selected&&<div className={tab==='3d'?'fs-mobile-hidden':''}><PartDetail key={catalog.data.revision+selected} id={selected} revision={catalog.data.revision}/></div>}
  </div></>}
  {catalog.data&&<p className="fs-muted" style={{marginTop:16}}>Revision {catalog.data.revision} · Model geometry; confirm fits and material before cutting · {catalog.data.parts.length} part drawings</p>}
  </div>
 </section></MeasurementContext.Provider>;
}
