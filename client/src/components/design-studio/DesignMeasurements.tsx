import {useState} from 'react';
import {useSuiteQuery} from '@/lib/suite-query';
import {useApiMutation} from '@/hooks/useApiMutation';
import {apiRequest} from '@/lib/queryClient';
import {todayYmd} from '@/lib/format';
import {inputCls,primaryBtn,secondaryBtn} from '@/lib/ui-styles';
import {RetryBlock} from '@/components/RetryBlock';
import Modal from '@/components/Modal';
import {downloadFile} from './manufacturing';
function MeasurementForm({design,onClose}:{design:any;onClose:()=>void}){
 const [part,setPart]=useState(''),[dimension,setDimension]=useState(''),[value,setValue]=useState(''),[tolerance,setTolerance]=useState(''),[unit,setUnit]=useState('mm');
 const [datum,setDatum]=useState(''),[source,setSource]=useState('field-measurement'),[reference,setReference]=useState(''),[date,setDate]=useState(todayYmd()),[confirmed,setConfirmed]=useState(false);
 const save=useApiMutation({request:()=>({method:'POST',url:`/api/design-studio/registry/${design.id}/measurements`,body:{version:design.version,part,dimension,value:Number(value),tolerance:Number(tolerance),unit,datum,source,reference,measuredDate:date,fileId:null,confirmed}}),invalidate:[['design-registry']],successTitle:'Measurement recorded with its source',errorTitle:'Could not record measurement',onSuccess:onClose});
 return <Modal open title="Record a verified measurement" onClose={onClose}><form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
  <p className="text-sm text-muted-foreground">Revision {design.model_revision}. Use measured or approved source values. Saving a value does not change the preview geometry or release a cut list.</p>
  <label className="grid gap-1">Part name or drawing reference<input className={inputCls} name="part" required maxLength={120} value={part} onChange={e=>setPart(e.target.value)}/></label>
  <label className="grid gap-1">Dimension<input className={inputCls} name="dimension" required maxLength={120} placeholder="For example: hole 1 center from left edge" value={dimension} onChange={e=>setDimension(e.target.value)}/></label>
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="grid gap-1">Value<input className={inputCls} name="value" type="number" inputMode="decimal" required step="any" value={value} onChange={e=>setValue(e.target.value)}/></label><label className="grid gap-1">Tolerance ±<input className={inputCls} name="tolerance" type="number" inputMode="decimal" required min="0" step="any" value={tolerance} onChange={e=>setTolerance(e.target.value)}/></label><label className="grid gap-1">Units<select className={inputCls} value={unit} onChange={e=>setUnit(e.target.value)}><option value="mm">Millimetres</option><option value="in">Inches · decimal</option></select></label></div>
  <label className="grid gap-1">Measurement origin and direction<input className={inputCls} name="datum" required minLength={3} maxLength={240} placeholder="For example: finished left edge, viewed from front" value={datum} onChange={e=>setDatum(e.target.value)}/></label>
  <label className="grid gap-1">Source<select className={inputCls} value={source} onChange={e=>setSource(e.target.value)}><option value="field-measurement">Measured in the plant</option><option value="approved-drawing">Approved drawing</option><option value="supplier-specification">Supplier specification</option></select></label>
  <label className="grid gap-1">Source details<input className={inputCls} name="reference" required minLength={3} maxLength={500} placeholder="Drawing number / revision or who measured it and how" value={reference} onChange={e=>setReference(e.target.value)}/></label>
  <label className="grid gap-1">Date measured or source reviewed<input className={inputCls} name="measuredDate" type="date" required max={todayYmd()} value={date} onChange={e=>setDate(e.target.value)}/></label>
  <label className="flex min-h-11 items-start gap-3 rounded-lg border p-3"><input className="mt-1" type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I checked this value, its origin and tolerance against the stated source.</span></label>
  <p className="text-xs text-muted-foreground">Recording the same part and dimension updates that entry; its previous value stays in revision history.</p>
  <button className={primaryBtn} disabled={save.isPending||!confirmed}>{save.isPending?'Saving…':'Record measurement'}</button>
 </form></Modal>;
}
export default function DesignMeasurements({id}:{id:number}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(0),[previous,setPrevious]=useState(false),[add,setAdd]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const q=useSuiteQuery(['design-registry','measurements',id,page,previous],`/api/design-studio/registry/${id}/measurements?page=${page}&previous=${previous}`,open);
 const download=async()=>{setBusy(true);setError('');try{const r=await apiRequest('GET',`/api/design-studio/registry/${id}/measurements.csv`);downloadFile(await r.text(),`design-${id}-measurements.csv`,'text/csv;charset=utf-8');}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}};
 return <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Verified measurement log"><button className="min-h-11 text-left font-semibold" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>Measurements & source records {open?'▴':'▾'}</button>
  {open&&<div className="space-y-3"><p className="rounded-lg bg-muted p-3 text-sm">Manufacturing pack incomplete. Unmeasured dimensions and tolerances still need approval. This log keeps verified values separate from approximate model dimensions.</p>
   {q.isError?<RetryBlock query={q}/>:!q.data?<p role="status">Loading measurements…</p>:<><div className="flex flex-wrap gap-2"><button className={primaryBtn} disabled={q.data.design.archived_at||q.data.design.revisionChanged||q.data.design.relationshipChanged} onClick={()=>setAdd(true)}>Record measurement</button><button className={secondaryBtn} disabled={busy} onClick={download}>Download current log</button><button className={secondaryBtn} aria-pressed={previous} onClick={()=>{setPrevious(v=>!v);setPage(0);}}>{previous?'Show current revision':'Earlier revisions'}</button></div>
    {q.data.rows.map((m:any)=><article key={m.id} className="min-w-0 space-y-2 rounded-lg border p-3"><h3 className="break-words font-semibold">{m.part} · {m.dimension}</h3><p>{Number(m.value_mm.toFixed(4))} mm ± {Number(m.tolerance_mm.toFixed(4))} mm</p><p className="break-words text-sm">Origin: {m.datum}</p><p className="break-words text-sm">{m.source.replaceAll('-',' ')} · {m.reference}</p><p className="text-xs text-muted-foreground">Reviewed {m.measured_date} · Recorded by {m.verified_by} · Model {m.model_revision}</p></article>)}
    {!q.data.rows.length&&<p className="text-sm">No measurements recorded for {previous?'earlier revisions':'this revision'}.</p>}
    {q.data.total>20&&<div className="flex flex-wrap items-center gap-2"><button className={secondaryBtn} disabled={!q.data.page} onClick={()=>setPage(q.data.page-1)}>Previous measurements</button><span>Page {q.data.page+1}</span><button className={secondaryBtn} disabled={(q.data.page+1)*20>=q.data.total} onClick={()=>setPage(q.data.page+1)}>Next measurements</button></div>}
    {add&&<MeasurementForm design={q.data.design} onClose={()=>setAdd(false)}/>}
   </>}{error&&<p role="alert">{error}</p>}
  </div>}
 </section>;
}
