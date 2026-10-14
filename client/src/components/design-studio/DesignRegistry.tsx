import {useState} from 'react';
import {Link} from 'wouter';
import {useSuiteQuery} from '@/lib/suite-query';
import {useApiMutation} from '@/hooks/useApiMutation';
import {useDeepLink} from '@/lib/deep-link';
import {RecordSelect} from '@/components/RecordSelect';
import {RetryBlock} from '@/components/RetryBlock';
import Modal from '@/components/Modal';
import {inputCls,primaryBtn,secondaryBtn} from '@/lib/ui-styles';
import DesignMeasurements from './DesignMeasurements';
const invalidates=[['design-registry'],['suite-files']];
function CreateDesign({jobId,models,onClose}:{jobId?:number;models:any[];onClose:()=>void}){
 const [name,setName]=useState(''),[job,setJob]=useState(jobId?String(jobId):''),[model,setModel]=useState(models.find(m=>m.available)?.key||'');
 const save=useApiMutation({request:()=>({method:'POST',url:'/api/design-studio/registry',body:{name,modelKey:model,jobId:job?Number(job):null}}),invalidate:invalidates,successTitle:'Design saved',errorTitle:'Could not save design',onSuccess:onClose});
 return <Modal open title="New job design" onClose={onClose}><form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
  <label className="grid gap-1">Design name<input autoFocus className={inputCls} name="name" required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
  <label className="grid gap-1">Starting model<select className={inputCls} value={model} onChange={e=>setModel(e.target.value)}>{models.filter(m=>m.available).map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
  <div><p className="mb-2 text-sm font-medium">Job · optional</p><RecordSelect type="jobs" value={job} onChange={e=>setJob(e.target.value)}/></div>
  <p className="text-sm text-muted-foreground">The job’s customer and quote are linked with this model revision. This creates a private team design; customer approval and manufacturing verification are separate.</p>
  <button className={primaryBtn} disabled={save.isPending||!model}>{save.isPending?'Saving…':'Create design'}</button>
 </form></Modal>;
}
export function DesignRegistry({jobId}:{jobId?:number}){
 const [archived,setArchived]=useState(false),[page,setPage]=useState(0),[create,setCreate]=useState(false);
 const q=useSuiteQuery(['design-registry','list',jobId,archived,page],`/api/design-studio/registry?archived=${archived}&page=${page}${jobId?'&jobId='+jobId:''}`);
 if(q.isError)return <RetryBlock query={q}/>;
 return <section aria-label="Job designs" className="my-5 rounded-xl border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Job designs</h2><button className={primaryBtn} disabled={!q.data?.models.some((m:any)=>m.available)} onClick={()=>setCreate(true)}>New design</button></div>
  <div className="my-3 flex flex-wrap gap-2" role="group" aria-label="Design status">{[false,true].map(value=><button key={String(value)} className={secondaryBtn} aria-pressed={archived===value} onClick={()=>{setArchived(value);setPage(0);}}>{value?'Archived':'Active'}</button>)}</div>
  {!q.data?<p role="status">Loading designs…</p>:<><div className="grid gap-3 sm:grid-cols-2">{q.data.rows.map((row:any)=><Link key={row.id} href={row.href} className="min-w-0 rounded-xl border p-4 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><h3 className="break-words font-semibold">{row.name}</h3><p className="break-words text-sm">{row.job_name||'No job linked'}{row.customer_name?' · '+row.customer_name:''}</p><p className="break-words text-xs text-muted-foreground">{row.model.name} · Revision {row.model_revision}</p><p className="mt-2 text-sm">{row.relationshipChanged||row.revisionChanged?'Review changes':row.approved_at?'Layout reviewed':'Needs layout review'} · Open design →</p></Link>)}</div>
   {!q.data.rows.length&&<p className="py-3 text-sm text-muted-foreground">{archived?'No archived designs.':'No designs linked yet. Start with an available model.'}</p>}
   {q.data.total>20&&<div className="mt-3 flex flex-wrap items-center gap-3"><button className={secondaryBtn} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} · {q.data.total} designs</span><button className={secondaryBtn} disabled={(page+1)*20>=q.data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
  </>}
  {create&&<CreateDesign jobId={jobId} models={q.data.models} onClose={()=>setCreate(false)}/>}
 </section>;
}
function ReviewDesign({row,onClose}:{row:any;onClose:()=>void}){
 const [job,setJob]=useState(row.project_id?String(row.project_id):''),[approve,setApprove]=useState(false);
 const save=useApiMutation({request:()=>({method:'PATCH',url:'/api/design-studio/registry/'+row.id,body:{version:row.version,action:'review',jobId:job?Number(job):null,approve}}),invalidate:invalidates,errorTitle:'Could not review design',successTitle:'Design connections saved',onSuccess:onClose});
 return <Modal open title="Review design connections" onClose={onClose}><div className="space-y-4"><RecordSelect type="jobs" value={job} onChange={e=>setJob(e.target.value)}/><p className="text-sm">Save the selected job’s current customer, quote and model revision {row.model.revision}. Previous connections and approvals stay in history.</p><label className="flex min-h-11 items-start gap-3 rounded-lg border p-3"><input className="mt-1" type="checkbox" checked={approve} onChange={e=>setApprove(e.target.checked)}/><span>I reviewed this layout for this job. This does not approve cut sizes or record customer acceptance.</span></label><button className={primaryBtn} disabled={save.isPending||!row.model.available} onClick={()=>save.mutate()}>Save review</button></div></Modal>;
}
function DesignHistory({id}:{id:number}){
 const [page,setPage]=useState(0),q=useSuiteQuery(['design-registry','history',id,page],`/api/design-studio/registry/${id}/history?page=${page}`);
 if(q.isError)return <RetryBlock query={q}/>;
 return <div className="mt-3 space-y-3">{q.data?.rows.map((r:any)=>{const data=JSON.parse(r.snapshot_json),row=data.after||data;return <p key={r.id} className="break-words rounded-lg border p-3 text-sm">{new Date(r.created_at).toLocaleString()} · {r.reviewer}<br/>{row.archived_at?'Archived':row.approved_at?'Layout reviewed':'Saved'} · Revision {row.model_revision}<br/>{row.job_name||'No job linked'}{row.quote_number?' · '+row.quote_number:''}{data.measurement&&<span className="mt-2 block">Measurement: {data.measurement.recorded.part} · {data.measurement.recorded.dimension}<br/>Previous: {data.measurement.previous?data.measurement.previous.value_mm+' mm ± '+data.measurement.previous.tolerance_mm+' mm':'Not recorded'}<br/>Recorded: {data.measurement.recorded.value} ± {data.measurement.recorded.tolerance} {data.measurement.recorded.unit}<br/>Source: {data.measurement.recorded.reference}</span>}</p>;})}<div className="flex gap-2"><button className={secondaryBtn} disabled={!page} onClick={()=>setPage(v=>v-1)}>Previous history</button><button className={secondaryBtn} disabled={!q.data||(page+1)*20>=q.data.total} onClick={()=>setPage(v=>v+1)}>Next history</button></div></div>;
}
export function DesignContext({children,workspace}:{children:(row:any)=>React.ReactNode;workspace:string}){
 const design=useDeepLink('design'),valid=/^[1-9]\d*$/.test(design||''),[review,setReview]=useState(false),[history,setHistory]=useState(false);
 const q=useSuiteQuery(['design-registry','detail',design],'/api/design-studio/registry/'+design,valid);
 const action=useApiMutation<any,'archive'|'restore'>({request:value=>({method:'PATCH',url:'/api/design-studio/registry/'+design,body:{version:q.data.version,action:value}}),invalidate:invalidates,errorTitle:'Could not update design',successTitle:'Design updated'});
 if(!design)return <>{children(null)}</>;
 if(!valid)return <p role="alert">Choose a design from the Design Studio list.</p>;
 if(q.isError)return <RetryBlock query={q}/>;
 if(!q.data)return <p role="status">Opening design connections…</p>;
 const row=q.data;
 if(row.model.workspace!==workspace)return <Link href={row.href}>Open this design’s model →</Link>;
 return <><section className="mb-4 space-y-3 rounded-xl border bg-card p-4" aria-label="Design connections"><h2 className="text-lg font-semibold">{row.name}</h2><div className="flex flex-wrap gap-2">{row.project_id&&<Link className={secondaryBtn} href={'/project/'+row.project_id+'?tab=files'}>{row.job_name||'Linked job'}</Link>}{row.client_id&&<Link className={secondaryBtn} href={'/crm/clients?client='+row.client_id}>{row.customer_name||'Linked customer'}</Link>}{row.quote_id&&<Link className={secondaryBtn} href={'/crm/quotes?quote='+row.quote_id}>{row.quote_number||'Linked quote'}</Link>}</div>
  <p className="text-sm">Saved model revision {row.model_revision} · {row.approved_at?'Layout reviewed':'Layout needs review'}. Manufacturing dimensions require separate verification.</p>
  {row.relationshipChanged&&<p role="alert" className="rounded-lg bg-muted p-3">The job’s customer or quote changed. Review the connections before using this design.</p>}
  {row.revisionChanged&&<p role="alert" className="rounded-lg bg-muted p-3">The model changed since this design was saved. The previous approval stays in history. Review the current model as an unapproved reference before updating this design.</p>}
  <div className="flex flex-wrap gap-2"><button className={secondaryBtn} disabled={!!row.archived_at} onClick={()=>setReview(true)}>Review connections & revision</button><button className={secondaryBtn} disabled={action.isPending} onClick={()=>action.mutate(row.archived_at?'restore':'archive')}>{row.archived_at?'Restore design':'Archive design'}</button><button className={secondaryBtn} aria-expanded={history} onClick={()=>setHistory(v=>!v)}>Revision history</button></div>
  {history&&<DesignHistory id={row.id}/>}{review&&<ReviewDesign row={row} onClose={()=>setReview(false)}/>}
 </section><DesignMeasurements id={row.id}/>{row.archived_at?<p className="p-4">This design is archived. Its connections and history remain available. Restore it to continue working.</p>:children(row)}</>;
}
