import {L} from '@/lib/language';
import JobFileUploader from '@/components/JobFileUploader';
import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { Camera, MapPin, Phone, ArrowRight, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { downscaleImage } from '@/lib/uploadPhoto';
import { EmployeeCard, EmployeeError, DraftNote, stamp, dateLabel, employeeButton, employeePrimary, employeeInput, useEmployeeQuery, useEmployeeMutation, useEmployeeDraft } from './shared';
import { JobClockAction, useEmployeeClock } from './clock';
import OfflineJobPack from '@/components/OfflineJobPack';

export function JobList({jobs}:{jobs:any[]}) {
  return <div className="space-y-3">{!jobs.length?<EmployeeCard><p className="font-semibold"><L>{"No jobs assigned yet"}</L></p><p className="mt-2 text-sm text-muted-foreground"><L>{"Ask the owner to assign work. You can still clock in for shop work."}</L></p></EmployeeCard>:jobs.map(j=><EmployeeCard key={j.id}>
    <Link href={`/employee/jobs/${j.id}`} className="flex min-h-12 items-center gap-3"><div className="min-w-0 flex-1"><p className="break-words text-lg font-semibold">{j.name}</p><p className="mt-1 text-sm text-muted-foreground">{j.status==='done'?'Completed':j.status==='on_hold'?'On hold':j.start_date?`Starts ${dateLabel(j.start_date)}`:'Schedule to be confirmed'}</p></div><ArrowRight size={20}/></Link>
    {j.site_address&&<p className="mt-3 break-words text-sm">{j.site_address}</p>}
  </EmployeeCard>)}</div>;
}
export function EmployeeJobs() {
  const {home}=useEmployeeClock(),[search,setSearch]=useState('');
  const jobs=home.data?.jobs.filter((j:any)=>`${j.name} ${j.job_number} ${j.site_address||''}`.toLowerCase().includes(search.toLowerCase()))||[];
  return <div className="space-y-5"><h1 className="text-3xl font-semibold"><L>{"My jobs"}</L></h1>{home.data?.jobs.length>4&&<label className="block text-sm"><L>{"Find a job"}</L><input type="search" className={employeeInput} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Job name or address"/></label>}{home.isError?<EmployeeError error={home.error} retry={()=>home.refetch()}/>:home.data?<>{search&&!jobs.length?<EmployeeCard><L>{"No matching jobs."}</L></EmployeeCard>:<JobList jobs={jobs}/>}</>:<p role="status"><L>{"Loading jobs…"}</L></p>}</div>;
}
export function EmployeeTask({task}:{task:any}) {
  const {user}=useAuth(),save=useEmployeeMutation(`/api/employee/tasks/${task.id}`,'PATCH');
  const mine=task.assignee_id===user?.id;
  return <div className="border-t border-border py-4"><p className="font-medium">{task.title}</p>{task.description&&<p className="mt-2 whitespace-pre-wrap break-words text-sm">{task.description}</p>}<p className="mt-2 text-sm text-muted-foreground">{mine?'Assigned to you':task.assignee_name||'Crew task'}{task.due_date&&` · Due ${dateLabel(task.due_date)}`}</p>
    {mine?<div className="mt-3 flex flex-wrap gap-2"><button aria-label={`${task.status==='done'?'Reopen':'Mark done'}: ${task.title}`} disabled={save.isPending} className={employeeButton} onClick={()=>save.mutate({status:task.status==='done'?'todo':'done',previousStatus:task.status})}>{task.status==='done'?'Done · reopen':'Mark done'}</button><label className="sr-only" htmlFor={`task-${task.id}`}><L>{"Status for"}</L> {task.title}</label><select id={`task-${task.id}`} disabled={save.isPending} value={task.status} className={employeeInput+' !mt-0 !w-auto flex-1'} onChange={e=>save.mutate({status:e.target.value,previousStatus:task.status})}>{[['todo','To do'],['in_progress','Working on it'],['review','Ready for review'],['done','Done']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></div>:<p className="mt-2 text-sm">{task.status==='done'?'Done':task.status==='in_progress'?'In progress':task.status==='review'?'Ready for review':'To do'}</p>}
    {save.isError&&<p role="alert" className="mt-2 text-sm text-destructive">{save.error.message}</p>}
  </div>;
}
async function photoData(file:File) {
  if(file.size>25_000_000)throw new Error('Choose a photo smaller than 25 MB.');
  let photo=file;
  for(const size of [1280,960,640,320]) {photo=await downscaleImage(file,size,0.74);if(photo.size<=650000)break;}
  if(photo.size>650000)throw new Error('This photo is too large. Choose a smaller image.');
  return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read this photo.'));reader.readAsDataURL(photo);});
}
function JobUpdates({jobId,comments}:{jobId:string;comments:any[]}) {
  const {draft,setDraft,reset,persisted}=useEmployeeDraft(`job-update:${jobId}`,{body:'',photo:null as string|null,kind:'progress'});
  const [photoError,setPhotoError]=useState(''),[processing,setProcessing]=useState(false),[sent,setSent]=useState(''),note=useRef<HTMLTextAreaElement>(null);
  const save=useEmployeeMutation(`/api/employee/jobs/${jobId}/updates`,'POST',body=>{setSent(body.kind==='problem'?'Problem sent to the owner. A follow-up task was created.':'Update posted.');reset(body);});
  const busy=save.isPending||processing;
  return <EmployeeCard><h2 className="text-xl font-semibold"><L>{"Job updates"}</L></h2><div className="mt-4 flex flex-wrap gap-2"><button type="button" aria-pressed={draft.kind==='progress'} className={employeeButton+' aria-pressed:bg-muted aria-pressed:border-primary'} disabled={busy} onClick={()=>setDraft({...draft,kind:'progress'})}><L>{"Progress update"}</L></button><button type="button" aria-pressed={draft.kind==='problem'} className={employeeButton} disabled={busy} onClick={()=>{setDraft({...draft,kind:'problem'});setSent('');note.current?.focus();}}><TriangleAlert size={18}/><L>{"Report a problem"}</L></button></div>
    <form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();setSent('');save.mutate(draft);}}>
      <label className="block text-sm font-medium">{draft.kind==='problem'?'What needs attention?':'Post a job update'}<textarea ref={note} disabled={busy} required={draft.kind==='problem'||!draft.photo} minLength={draft.kind==='problem'?3:undefined} maxLength={4000} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} className={employeeInput+' min-h-28'} placeholder={draft.kind==='problem'?'Tell the owner what is blocking the work…':'What did you finish? A short note or photo is enough.'}/></label>
      {draft.photo&&<div><img src={draft.photo} alt="Photo ready to attach" className="max-h-64 w-full rounded-xl object-contain"/><button type="button" disabled={busy} className={employeeButton+' mt-2'} onClick={()=>setDraft({...draft,photo:null})}><L>{"Remove photo"}</L></button></div>}
      <label className={employeeButton+' relative w-full cursor-pointer'}><Camera size={18}/><L>{processing?'Preparing photo…':draft.photo?'Replace photo':'Add progress photo'}</L><input aria-label="Add progress photo" className="absolute inset-0 cursor-pointer opacity-0" type="file" accept="image/jpeg,image/png,image/webp,image/heic" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setPhotoError('');setProcessing(true);try{const photo=await photoData(file);setDraft({...draft,photo});}catch(error:any){setPhotoError((error.message||'Could not prepare this photo.')+' To keep the original HEIC, use Add photos, drawings or files above.');}finally{setProcessing(false);}}}/></label>
      {photoError&&<p role="alert" className="text-sm text-destructive">{photoError}</p>}<DraftNote persisted={persisted}/>
      <button disabled={busy||(!draft.body.trim()&&!draft.photo)} className={employeePrimary+' w-full'}><L>{save.isPending?'Sending…':draft.kind==='problem'?'Send problem to owner':'Post update'}</L></button>
      {save.isError&&<p role="alert" className="text-sm text-destructive">{save.error.message} <L>{"Your draft is still here."}</L></p>}{sent&&<p role="status" className="text-sm">{sent}</p>}
    </form>
    {comments.map(c=><div key={c.id} className="mt-5 border-t pt-4"><p className="text-sm text-muted-foreground">{c.name} · {stamp(c.created_at)}</p><p className="mt-2 whitespace-pre-wrap break-words">{c.body}</p>{(()=>{try{return JSON.parse(c.attachments||'[]').map((url:string)=><a key={url} href={url} target="_blank" rel="noreferrer" className="mt-3 block"><img loading="lazy" src={url} alt="Job update photo" className="max-h-64 w-full rounded-xl object-contain"/></a>);}catch{return null;}})()}</div>)}
  </EmployeeCard>;
}
export function EmployeeJob({jobId}:{jobId:string}) {
  const q=useEmployeeQuery(`job-${jobId}`,`/api/employee/jobs/${jobId}`),{user}=useAuth();
  if(q.isError)return <EmployeeError error={q.error} retry={()=>q.refetch()}/>;
  if(!q.data)return <p role="status"><L>{"Loading your job…"}</L></p>;
  const d=q.data,j=d.job,own=d.tasks.filter((t:any)=>t.assignee_id===user?.id),crew=d.tasks.filter((t:any)=>t.assignee_id!==user?.id);
  return <div className="space-y-5"><Link className="inline-flex min-h-12 items-center underline" href="/employee/jobs"><L>{"← My jobs"}</L></Link><div><p className="text-sm text-muted-foreground">{j.job_number}</p><h1 className="mt-1 break-words text-3xl font-semibold">{j.name}</h1><p className="mt-2 text-sm">{j.start_date?`Starts ${dateLabel(j.start_date)}`:'Schedule to be confirmed'}{j.due_date&&` · Due ${dateLabel(j.due_date)}`}</p></div>
    <JobClockAction job={j}/>
    <OfflineJobPack key={jobId} id={Number(jobId)} employee/><details className="rounded-xl border bg-card p-4"><summary className="min-h-12 cursor-pointer py-3 font-semibold"><L>{"Add photos, drawings or files"}</L></summary><JobFileUploader key={jobId} id={Number(jobId)} employee/></details>
    <EmployeeCard><h2 className="font-semibold"><L>{"Where to go"}</L></h2><p className="mt-2 break-words">{j.site_address||'Ask the owner for the site address.'}</p><div className="mt-4 flex flex-wrap gap-2">{j.site_address&&<a target="_blank" rel="noreferrer" className={employeeButton+' flex-1'} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.site_address)}`}><MapPin size={18}/><L>{"Directions"}</L></a>}{d.customer?.phone&&<a className={employeeButton+' flex-1'} href={`tel:${d.customer.phone}`}><Phone size={18}/><L>{"Call"}</L> {d.customer.name}</a>}</div></EmployeeCard>
    <EmployeeCard><h2 className="text-xl font-semibold"><L>{"Your checklist"}</L></h2>{!own.length&&<p className="mt-3 text-sm"><L>{"No tasks assigned to you yet. Check the crew plan or ask the owner."}</L></p>}{own.map((t:any)=><EmployeeTask key={t.id} task={t}/>)}{crew.length>0&&<details className="mt-3"><summary className="min-h-12 cursor-pointer py-3 font-medium"><L>{"Crew plan ·"}</L> {crew.length} <L>{"tasks"}</L></summary>{crew.map((t:any)=><EmployeeTask key={t.id} task={t}/>)}</details>}</EmployeeCard>
    <JobUpdates key={jobId} jobId={jobId} comments={d.comments}/>
    <EmployeeCard><details><summary className="min-h-12 cursor-pointer py-3 font-semibold"><L>{"Materials & job files"}</L></summary>{!d.materials.length&&!d.files.length&&<p className="mt-2 text-sm"><L>{"No materials or files listed yet."}</L></p>}{d.materials.map((m:any)=><p key={m.id} className="mt-3 border-t pt-3">{m.name} · {m.qty} {m.unit}<span className="mt-1 block text-sm text-muted-foreground">{m.status}</span></p>)}{d.files.map((f:any)=><a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="mt-2 block min-h-12 break-words rounded-xl border px-3 py-4 underline">{f.title}</a>)}</details></EmployeeCard>
  </div>;
}
