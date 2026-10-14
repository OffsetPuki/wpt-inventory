import {L} from '@/lib/language';
import {useEffect,useRef,useState} from 'react';
import {getAuthToken} from '@/lib/queryClient';
import {downscaleImage} from '@/lib/uploadPhoto';
import {queueRefreshKeys} from '@/lib/suite-sync';
import {JOB_FILE_ACCEPT,JOB_FILE_MAX_BYTES,isJobImage} from '@shared/job-files';
type Entry={key:string;file:File;prepared?:File;uploadKind?:string;progress:number;status:'waiting'|'uploading'|'done'|'failed';error?:string};
// Files remain only in this tab's memory, never in browser storage. Preserve
// pending work across SPA navigation, and clear it at an account change.
const pendingJobs=new Map<number,Entry[]>();
if(typeof window!=='undefined'){
 window.addEventListener('suite-auth-changed',()=>pendingJobs.clear());
 window.addEventListener('beforeunload',event=>{if(getAuthToken()&&[...pendingJobs.values()].some(rows=>rows.some(f=>f.status!=='done'))){event.preventDefault();event.returnValue='';}});
}
export default function JobFileUploader({id,employee=false}:{id:number;employee?:boolean}){
 const [files,renderFiles]=useState<Entry[]>(()=>pendingJobs.get(id)||[]),[kind,setKind]=useState('photo'),busy=useRef(false),mounted=useRef(true),xhr=useRef<XMLHttpRequest|null>(null),entries=useRef(files),session=useRef(getAuthToken());
 const setFiles=(change:Entry[]|((rows:Entry[])=>Entry[]))=>{if(!mounted.current||session.current!==getAuthToken())return;const next=typeof change==='function'?change(entries.current):change;entries.current=next;pendingJobs.set(id,next);renderFiles(next);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;xhr.current?.abort();if(session.current===getAuthToken())pendingJobs.set(id,entries.current.filter(f=>f.status!=='done').map(f=>f.status==='uploading'?{...f,status:'failed',error:'Upload stopped while leaving this page. Retry to confirm it was saved.'}:f));};},[id]);
 const update=(key:string,patch:Partial<Entry>)=>setFiles(rows=>rows.map(r=>r.key===key?{...r,...patch}:r));
 const add=(selected:FileList|null)=>{if(!selected)return;setFiles(rows=>[...rows,...Array.from(selected).map(file=>({key:crypto.randomUUID(),file,progress:0,status:'waiting' as const}))]);};
 const run=async()=>{
  if(busy.current)return;busy.current=true;
  try{for(const entry of files.filter(f=>f.status==='waiting'||f.status==='failed')){
   if(!mounted.current)break;
   update(entry.key,{status:'uploading',error:undefined,progress:0});
   try{
    if(entry.file.size>JOB_FILE_MAX_BYTES)throw new Error('This file exceeds 25 MB. Choose a smaller copy.');
    let file=entry.prepared||entry.file;
    if(!entry.prepared&&isJobImage(file.name)){try{file=await downscaleImage(file);}catch{/* Keep HEIC originals as downloadable files. */}}
    if(!mounted.current)break;
    const uploadKind=entry.uploadKind||(isJobImage(file.name)?kind:kind==='photo'?'other':kind);
    update(entry.key,{prepared:file,uploadKind});
    const body=new FormData();body.append('requestKey',entry.key);body.append('title',entry.file.name.slice(0,200));body.append('kind',uploadKind);body.append('file',file);
    await new Promise<void>((resolve,reject)=>{const request=new XMLHttpRequest();xhr.current=request;request.open('POST',`/api/${employee?'employee':'suite'}/jobs/${id}/attachments`);const token=getAuthToken();if(token)request.setRequestHeader('X-Auth',token);request.timeout=120000;request.upload.onprogress=e=>{if(e.lengthComputable)update(entry.key,{progress:Math.round(e.loaded/e.total*100)});};request.onload=()=>{let result:any;try{result=JSON.parse(request.responseText);}catch{}if(request.status>=200&&request.status<300)resolve();else reject(new Error(result?.message||'Upload was not confirmed. Retry this file.'));};request.onerror=()=>reject(new Error('Connection interrupted. Reconnect and retry this file.'));request.ontimeout=()=>reject(new Error('The upload took too long. Retry when your connection improves.'));request.onabort=()=>reject(new Error('Upload stopped.'));request.send(body);});
    update(entry.key,{status:'done',progress:100});queueRefreshKeys([['suite-files',id],['employee','job-'+id]]);
   }catch(e:any){update(entry.key,{status:'failed',error:e.message});}
  }}finally{busy.current=false;xhr.current=null;}
 };
 const running=files.some(f=>f.status==='uploading');
 return <section className="mb-5 space-y-3 rounded-xl border bg-muted/20 p-4" aria-label="Upload files to job"><h3 className="font-semibold"><L>{"Add files to this job"}</L></h3><p className="text-sm text-muted-foreground"><L>{"Choose several files, then upload. Each successful upload is attached automatically and stays private to your team. Pending files stay ready when you browse within this tab; keep the tab open until they are saved."}</L></p><label className="block text-sm"><L>{"Type"}</L><select aria-label="Upload file type" disabled={running} value={kind} onChange={e=>setKind(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3">{['photo','drawing','measurement','receipt','other'].map(k=><option key={k} value={k}><L>{k}</L></option>)}</select></label><div className="flex flex-wrap gap-2"><label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-primary"><L>{"Choose files"}</L><input aria-label="Choose job files" className="sr-only" type="file" multiple accept={JOB_FILE_ACCEPT} disabled={running} onChange={e=>{add(e.target.files);e.target.value='';}}/></label><label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-primary"><L>{"Take photo"}</L><input aria-label="Take job photo" className="sr-only" type="file" accept="image/*" capture="environment" disabled={running} onChange={e=>{add(e.target.files);e.target.value='';}}/></label></div><p className="text-xs text-muted-foreground"><L>{"Photos, PDF, Office, CAD and ZIP · 25 MB each. HEIC is converted when your phone supports it; otherwise the original is kept for download."}</L></p><ul className="divide-y" aria-live="polite">{files.map(f=><li key={f.key} className="py-3"><p className="break-words text-sm font-medium">{f.file.name}</p><p className="text-xs">{f.status==='done'?'Saved to job':f.status==='uploading'?`${f.progress}% · ${f.progress===100?'Attaching file…':'Uploading…'}`:f.status==='failed'?'Needs retry':'Ready to upload'}</p>{f.status==='uploading'&&<progress className="mt-2 w-full" max={100} value={f.progress} aria-label={`Uploading ${f.file.name}`}/>} {f.error&&<p role="alert" className="mt-1 text-sm text-destructive">{f.error}</p>}{!running&&f.status!=='done'&&<button type="button" className="min-h-11 text-sm underline" onClick={()=>setFiles(rows=>rows.filter(r=>r.key!==f.key))}><L>{"Remove from upload list"}</L></button>}</li>)}</ul>{files.some(f=>f.status!=='done')&&<button type="button" disabled={running} className="min-h-11 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground sm:w-auto" onClick={run}><L>{running?'Uploading…':'Upload / retry remaining files'}</L></button>}{!!files.length&&!running&&files.every(f=>f.status==='done')&&<button type="button" className="min-h-11 text-sm underline" onClick={()=>setFiles([])}><L>{"Clear completed list"}</L></button>}</section>;
}
