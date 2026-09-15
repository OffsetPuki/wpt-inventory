import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, ExternalLink, Pencil, Box, MessageSquare, RefreshCw, CircleCheck } from 'lucide-react';
import Header from '@/components/Header';
import PreviewActivity from './preview-activity';
import Modal from '@/components/Modal';
import { apiRequest, getAuthToken } from '@/lib/queryClient';
import { primaryBtn, secondaryBtn, inputCls } from '@/lib/ui-styles';
import { toast } from '@/components/ui/toaster';

type Preview = {id:number;title:string;description:string;customer:string;width:string;height:string;finish:string;note:string;published:boolean;version:number;url:string;updatedAt:number;options:{id:string;label:string;size:number}[];feedback:{id:number;kind:'feedback'|'approval';optionId:string;designVersion:number|null;optionLabel:string;message:string;createdAt:number;emailStatus:'sent'|'queued'|'attention'|'not_requested'}[]};
const blank = {title:'',description:'',customer:'',width:'',height:'',finish:'',note:''};

function PreviewEditor({initial,previews,onClose}:{initial:Preview|null;previews:Preview[];onClose:()=>void}) {
  const query=useQueryClient();
  const [preview,setPreview]=useState(initial);
  const [form,setForm]=useState(initial?{title:initial.title,description:initial.description,customer:initial.customer,width:initial.width,height:initial.height,finish:initial.finish,note:initial.note}:blank);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[label,setLabel]=useState(''),[file,setFile]=useState<File|null>(null);
  const refresh=(p:Preview)=>{setPreview(p);query.invalidateQueries({queryKey:['customer-previews']});};
  const run=async(fn:()=>Promise<void>)=>{setError('');setBusy(true);try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not save this preview.');}finally{setBusy(false);}};
  const save=async()=>{const p=await (await apiRequest(preview?'PATCH':'POST',preview?`/api/customer-previews/${preview.id}`:'/api/customer-previews',{...form,...(preview?{version:preview.version}:{})})).json();refresh(p);setForm({title:p.title,description:p.description,customer:p.customer,width:p.width,height:p.height,finish:p.finish,note:p.note});toast({title:'Design details saved'});};
  // Incoming comments update independently of unsaved design details.
  const feedback=previews.find(p=>p.id===preview?.id)?.feedback||preview?.feedback||[];
  const dirty=Object.entries(form).some(([key,value])=>value!==(preview||blank)[key as keyof typeof blank]);
  const upload=async()=>{
    if(!preview||!file)return;if(!/\.glb$/i.test(file.name))throw new Error('Choose a GLB (.glb) model for the customer preview.');if(file.size>25*1024*1024)throw new Error('Choose a model smaller than 25 MB.');
    const data=new FormData();data.append('model',file);data.append('label',label.trim()||file.name.replace(/\.glb$/i,''));data.append('version',String(preview.version));
    const response=await fetch(`/api/customer-previews/${preview.id}/models`,{method:'POST',headers:{'X-Auth':getAuthToken()||''},body:data});
    const body=await response.json();if(!response.ok)throw new Error(body.message||'Could not upload the model.');
    refresh(body);setFile(null);setLabel('');const input=document.getElementById('preview-model-file') as HTMLInputElement|null;if(input)input.value='';
  };
  const sharing=async()=>{if(!preview)return;refresh(await (await apiRequest('POST',`/api/customer-previews/${preview.id}/sharing`,{published:!preview.published,version:preview.version})).json());};
  const copy=async()=>{if(!preview)return;try{await navigator.clipboard.writeText(preview.url);toast({title:'Customer link copied'});}catch{setError('Copy the customer link from the field below.');}};
  return <Modal open onClose={()=>{if(!busy)onClose();}} title={initial?'Edit customer preview':'New customer preview'} maxWidth="max-w-3xl" preservesDraft={!dirty&&!file&&!label.trim()}>
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Share a design and collect changes before preparing a quote. Customer links contain no prices or payment steps.</p>
      <form onSubmit={e=>{e.preventDefault();run(save);}}><fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Project title<input required maxLength={120} className={inputCls} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
          <label className="space-y-1 text-sm">Customer / job reference <span className="text-muted-foreground">(only in the suite)</span><input maxLength={120} className={inputCls} value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></label>
        </div>
        <label className="block space-y-1 text-sm">Short description<textarea maxLength={600} className={inputCls+' h-20 py-2'} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
        <div className="grid gap-3 sm:grid-cols-3">{(['width','height','finish'] as const).map(key=><label key={key} className="space-y-1 text-sm capitalize">{key}<input maxLength={key==='finish'?60:40} placeholder={key==='width'?'26 ft':key==='height'?'6 ft':'Matte black'} className={inputCls} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div>
        <label className="block space-y-1 text-sm">Details for the customer <span className="text-muted-foreground">(optional)</span><textarea maxLength={1200} className={inputCls+' h-24 py-2'} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
        <button className={primaryBtn} disabled={busy||!form.title.trim()}>{busy?'Saving…':preview?'Save details':'Create preview'}</button>
      </fieldset></form>
      {preview&&<>
        <section className="space-y-3 border-t border-border pt-5"><h3 className="font-semibold">Design options</h3>
          <p className="text-sm text-muted-foreground">Upload GLB models from your design software. Include animations to give the customer an open/close button. Up to six options, 25 MB each.</p>
          {preview.options.map(o=><div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="font-medium">{o.label}</p><p className="text-xs text-muted-foreground">{(o.size/1024/1024).toFixed(1)} MB</p></div><button className="text-sm underline disabled:opacity-50" disabled={busy||(preview.published&&preview.options.length===1)} onClick={()=>run(async()=>refresh(await(await apiRequest('DELETE',`/api/customer-previews/${preview.id}/models/${o.id}`,{version:preview.version})).json()))}>Remove</button></div>)}
          {preview.options.length<6&&<div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Option name<input maxLength={60} className={inputCls} placeholder="For example: 5 horizontal pipes" value={label} onChange={e=>setLabel(e.target.value)}/></label><label className="space-y-1 text-sm">3D model<input id="preview-model-file" className={inputCls+' py-2'} type="file" accept=".glb" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><button className={secondaryBtn} disabled={busy||!file} onClick={()=>run(upload)}>{busy?'Working…':'Add option'}</button></div>}
        </section>
        <section className="space-y-3 border-t border-border pt-5"><h3 className="font-semibold">Customer link</h3><p className="text-sm text-muted-foreground">{preview.published?'Anyone with this link can view the design and send feedback. It is excluded from search engines.':'Enable the link when the design is ready to review.'}</p>
          <div className="flex flex-wrap gap-2"><button className={preview.published?secondaryBtn:primaryBtn} disabled={busy||!!dirty||!preview.options.length} onClick={()=>run(sharing)}>{preview.published?'Disable link':'Enable customer link'}</button>{preview.published&&<><button className={secondaryBtn} onClick={copy}><Copy size={16}/>Copy link</button><a href={preview.url+'?owner=1&v='+preview.version} target="_blank" rel="noopener noreferrer" className={secondaryBtn}><ExternalLink size={16}/>Open preview</a></>}</div>
          {dirty&&<p className="text-sm text-muted-foreground">Save details to update the customer preview before opening or sharing it.</p>}
          {preview.published&&<input aria-label="Customer preview link" className={inputCls+' text-sm'} readOnly value={preview.url} onFocus={e=>e.target.select()}/>}
        </section>
        <section className="space-y-3 border-t border-border pt-5" aria-label="Customer feedback"><h3 className="font-semibold">Customer feedback & design selections</h3>{feedback.length?feedback.map(f=><article key={f.id} className="rounded-lg border border-border p-4">{f.kind==='approval'&&<p className="mb-2 flex items-center gap-2 text-sm font-semibold"><CircleCheck size={16}/>Design accepted for quoting</p>}<p className="text-xs text-muted-foreground">{f.optionLabel} · {new Date(f.createdAt).toLocaleString()}{f.kind==='approval'&&f.designVersion&&<> · Version {f.designVersion}{f.designVersion!==(previews.find(p=>p.id===preview.id)?.version||preview.version)?' (earlier preview version)':''}</>}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{f.message}</p><p className="mt-3 text-xs text-muted-foreground">{f.emailStatus==='sent'?'Email notification sent':f.emailStatus==='queued'?'Email notification queued':f.emailStatus==='attention'?'Email notification delayed. Check System health if it does not arrive.':'Received before email alerts were enabled.'}</p></article>):<p className="text-sm text-muted-foreground">No responses yet. Feedback and design selections appear here while the suite is open.</p>}</section>
      </>}
      {error&&<p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
    </div>
  </Modal>;
}

export default function CustomerPreviewsPage(){
  const [editing,setEditing]=useState<Preview|null|undefined>(undefined);
  const [activity,setActivity]=useState<Preview|null>(null);
  const query=useQuery<Preview[]>({queryKey:['customer-previews'],queryFn:async()=>(await apiRequest('GET','/api/customer-previews')).json()});
  const notifications=useQuery<{enabled:boolean;recipient:string|null}>({queryKey:['preview-email-settings'],queryFn:async()=>(await apiRequest('GET','/api/customer-previews/notifications')).json()});
  const copy=async(p:Preview)=>{try{await navigator.clipboard.writeText(p.url);toast({title:'Customer link copied'});}catch{setEditing(p);}};
  return <div className="mx-auto max-w-6xl p-4 sm:p-6"><Header title="Customer previews" description="Review the design with your customer before creating a quote."><button className={secondaryBtn} disabled={query.isFetching} onClick={()=>query.refetch()}><RefreshCw size={16}/>Refresh</button><button className={primaryBtn} onClick={()=>setEditing(null)}><Plus size={18}/>New preview</button></Header>
    {notifications.data&&<p className="mb-5 rounded-lg border border-border p-3 text-sm">{notifications.data.enabled?<>Feedback and design acceptance emails go to <strong>{notifications.data.recipient}</strong>.</>:<>Email alerts need setup. Customer responses are saved here; check email configuration in System health.</>}</p>}
    {query.isPending?<p className="text-muted-foreground">Loading previews…</p>:query.isError?<div role="alert"><p>Could not load previews.</p><button className={secondaryBtn} onClick={()=>query.refetch()}>Try again</button></div>:!query.data?.length?<div className="rounded-xl border border-dashed border-border p-10 text-center"><Box className="mx-auto mb-3 text-muted-foreground"/><p className="font-medium">Start with a design your customer can explore.</p><p className="mt-2 text-sm text-muted-foreground">Add a 3D model, name the options, and share a CJM Metals link.</p></div>:<div className="grid gap-4 md:grid-cols-2">{query.data.map(p=><article key={p.id} className="rounded-xl border border-border bg-card p-5"><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{p.title}</h2><p className="text-sm text-muted-foreground">{p.customer||'No customer reference'} · {p.options.length} {p.options.length===1?'option':'options'}</p></div><span className="text-xs text-muted-foreground">{p.published?'Link enabled':'Draft'}</span></div>{!!p.feedback.length&&<p className="mt-3 flex items-center gap-2 text-sm"><MessageSquare size={16}/>{p.feedback.length} customer {p.feedback.length===1?'response':'responses'}</p>}{p.feedback[0]?.kind==='approval'&&p.feedback[0].designVersion===p.version&&<p className="mt-3 flex items-center gap-2 text-sm font-semibold"><CircleCheck size={16}/>Ready for a quote · {p.feedback[0].optionLabel}</p>}<div className="mt-4 flex flex-wrap gap-2"><button className={secondaryBtn} onClick={()=>setActivity(p)}>Customer activity</button><button className={secondaryBtn} onClick={()=>setEditing(p)}><Pencil size={16}/>Manage</button>{p.published&&<><button className={secondaryBtn} onClick={()=>copy(p)}><Copy size={16}/>Copy link</button><a className={secondaryBtn} href={p.url+'?owner=1'} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Open preview</a></>}</div></article>)}</div>}
    {activity&&<PreviewActivity preview={query.data?.find(p=>p.id===activity.id)||activity} onClose={()=>setActivity(null)}/>}
    {editing!==undefined&&<PreviewEditor initial={editing} previews={query.data||[]} onClose={()=>setEditing(undefined)}/>}
  </div>;
}
