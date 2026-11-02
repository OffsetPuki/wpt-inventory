import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'wouter';
import {Globe,ExternalLink,Eye,RefreshCw,CheckCircle2,Clock,ShieldCheck,ArrowLeft} from 'lucide-react';
import Header from '@/components/Header';
import {apiRequest} from '@/lib/queryClient';
import {formatDateTime} from '@/lib/format';

type Check={path:string;ok:boolean;status:number|null;message:string};
type Verification={confirmed:boolean;checkedAt:number;checks:Check[];durable:boolean;syncHealthy:boolean;revision:number|null};
type Site={id:string;name:string;url:string;active:boolean;promoted:boolean;version:number;updatedAt:number;history:{actor:string;action:string;createdAt:number}[];verification:Verification|null;preflight:Verification|null};
const key=['website-control-center'];
const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:border-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
const date=(value:number)=>value?formatDateTime(value):'No changes yet';

function SiteCard({site}:{site:Site}){
 const cache=useQueryClient(),[checking,setChecking]=useState(false),[previewing,setPreviewing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=()=>cache.invalidateQueries({queryKey:key});
 const save=useMutation({mutationFn:async(change:{active?:boolean;promoted?:boolean})=>(await apiRequest('PUT','/api/settings/website/'+site.id,{active:site.active,promoted:site.promoted,version:site.version,...change})).json(),onSuccess:async()=>{setError('');setNotice('Saved. Checking what visitors see…');await refresh();void verify(false,true);},onError:async(e:Error)=>{setError(e.message);await refresh();}});
 async function verify(preview=false,retry=false){
  setChecking(true);setError('');
  try{let result=await (await apiRequest('POST','/api/settings/websites/'+site.id+'/check',{preview})).json();
   if(retry&&!result.confirmed){await new Promise(resolve=>setTimeout(resolve,11000));result=await(await apiRequest('POST','/api/settings/websites/'+site.id+'/check',{preview})).json();}
   setNotice(result.confirmed?(preview?'Preview checks passed. This website is ready to activate.':'Live website status confirmed.'):'The setting is saved, but the live website has not confirmed it. Check the details below.');await refresh();
  }catch(e:any){setError(e.message);}finally{setChecking(false);}
 }
 async function preview(){
  // Open synchronously so mobile browsers do not block the new tab.
  const target='cjm-private-preview-'+site.id;const win=window.open('about:blank',target);
  if(!win){setError('Allow pop-ups for the Business Suite, then open the preview again.');return;}
  setPreviewing(true);setError('');
  try{const data=await(await apiRequest('POST','/api/settings/websites/'+site.id+'/preview',{})).json();
   const form=document.createElement('form');form.method='POST';form.action=data.url;form.target=target;
   const token=document.createElement('input');token.type='hidden';token.name='token';token.value=data.token;form.append(token);document.body.append(form);form.submit();form.remove();
  }catch(e:any){win.close();setError(e.message);}finally{setPreviewing(false);}
 }
 const verified=site.verification?.confirmed;
 return <article className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6" aria-label={site.name}>
  <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{site.name}</h2><a href={site.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-sm text-muted-foreground">{new URL(site.url).hostname}<ExternalLink className="h-3 w-3 shrink-0"/></a></div><Globe className="mt-1 h-6 w-6 shrink-0 text-muted-foreground"/></div>
  <div className="my-5 flex items-center justify-between gap-4 rounded-xl bg-muted/60 p-4"><div><p className="font-semibold">{site.active?'Website active':'Website inactive'}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">{verified?<CheckCircle2 className="h-4 w-4"/>:<Clock className="h-4 w-4"/>}{verified?'Confirmed '+(site.active?'online':'offline'):'Awaiting live verification'}</p></div><button type="button" role="switch" aria-label={'Activate '+site.name+' website'} aria-checked={site.active} disabled={save.isPending||checking} onClick={()=>save.mutate({active:!site.active})} className={'inline-flex h-11 w-20 shrink-0 items-center rounded-full border-2 p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50 '+(site.active?'border-primary bg-primary':'border-border bg-background')}><span className={'h-8 w-8 rounded-full bg-white shadow transition-transform '+(site.active?'translate-x-8':'translate-x-0')}/></button></div>
  <div className="flex flex-wrap gap-2"><button className={button} disabled={previewing||save.isPending} onClick={preview}><Eye className="h-4 w-4"/>{previewing?'Opening…':'Private preview'}</button><button className={button} disabled={checking||save.isPending} onClick={()=>verify()}><RefreshCw className={'h-4 w-4 '+(checking?'animate-spin':'')}/>{checking?'Checking…':'Check live status'}</button>{!site.active&&<button className={button} disabled={checking||save.isPending} onClick={()=>verify(true)}><ShieldCheck className="h-4 w-4"/>Check before activating</button>}</div>
  {save.isPending&&<p role="status" className="mt-3 text-sm">Saving and checking the website…</p>}
  {notice&&<p role="status" className="mt-3 text-sm">{notice}</p>}{error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  <div className="mt-5 border-t pt-4"><h3 className="text-sm font-semibold">Shared trade catalogue</h3>{site.id==='insulation'?<p className="mt-2 text-sm text-muted-foreground">Always excluded from the other CJM websites, even when this website is active.</p>:site.id==='trades'?<p className="mt-2 text-sm text-muted-foreground">The family website follows the Metals and Concrete choices on this page.</p>:<label className="mt-3 flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={site.promoted} disabled={save.isPending||checking} onChange={e=>save.mutate({promoted:e.target.checked})}/><span>Show this trade in family links, shared forms and planners.<span className="mt-1 block text-xs text-muted-foreground">An inactive website is automatically hidden from these places.</span></span></label>}</div>
  {site.verification&&<p className="mt-4 text-xs text-muted-foreground">Checked {date(site.verification.checkedAt)} · {site.verification.durable?'Saved on the website for outages':'Persistent copy not confirmed'}{!site.verification.syncHealthy?' · Suite connection needs attention':''}</p>}
  {(site.verification||site.preflight)&&<details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Website check details</summary>{[site.verification,site.preflight].filter(Boolean).map((v,i)=><div key={i} className="mb-3"><p className="font-medium">{i===0?'Live status':'Private preview'} · {date(v!.checkedAt)}</p><ul className="mt-2 space-y-1">{v!.checks.map((c,j)=><li key={j} className={'break-words '+(!c.ok?'text-destructive':'text-muted-foreground')}>{c.ok?'✓':'!'} {c.path} — {c.message}</li>)}</ul></div>)}</details>}
  <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Change history</summary>{site.history.length?<ul className="space-y-3">{site.history.map((h,i)=><li key={i}><p>{h.action} · {h.actor}</p><p className="text-xs text-muted-foreground">{date(h.createdAt)}</p></li>)}</ul>:<p className="text-muted-foreground">No changes recorded since this dashboard was added.</p>}<p className="mt-3 text-xs text-muted-foreground">Saved setting last updated: {date(site.updatedAt)}</p></details>
 </article>;
}

const tasks=[
 {id:'google-removal',title:'Google search results',href:'https://search.google.com/search-console/removals?resource_id=sc-domain%3Acjminsulation.com',text:'Request temporary removal for the Insulation domain. The inactive website continues to return removal signals.'},
 {id:'bing-removal',title:'Bing search results',href:'https://www.bing.com/webmasters/',text:'Check the Insulation property and its URL removal tools.'},
 {id:'business-profile',title:'Business listing',href:'https://business.google.com/locations',text:'Review the Insulation listing and mark the business closed if appropriate. Keep the other CJM businesses open.'},
 {id:'social-directory-links',title:'Social profiles and directories',href:'https://www.google.com/search?q=%22CJM+Insulation%22',text:'Review old website links in profiles and directories. External listings can remain after the website is off.'},
];
function SearchCleanup(){
 const cache=useQueryClient(),query=useQuery<{tasks:{id:string;done:number;note:string}[]}>({queryKey:['website-search-cleanup'],queryFn:async()=>(await apiRequest('GET','/api/settings/websites/search-cleanup')).json()});
 const save=useMutation({mutationFn:async(task:{id:string;done:boolean;note:string})=>apiRequest('PUT','/api/settings/websites/search-cleanup/'+task.id,task),onSuccess:()=>cache.invalidateQueries({queryKey:['website-search-cleanup']})});
 return <section className="mt-8 rounded-2xl border bg-card p-5 sm:p-6"><h2 className="text-xl font-semibold">Insulation search cleanup</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Website availability, search engines and outside listings update separately. Track the account steps here. Mark a step complete only after verifying it in that service.</p>{query.isError&&<p role="alert" className="mt-3 text-destructive">Could not load the checklist.</p>}{save.error&&<p role="alert" className="mt-3 text-destructive">{save.error.message}</p>}<div className="mt-5 grid gap-5 md:grid-cols-2">{tasks.map(task=>{const saved=query.data?.tasks.find(t=>t.id===task.id);return <div key={task.id} className="rounded-xl border p-4"><div className="flex items-start gap-3"><input type="checkbox" aria-label={'Completed: '+task.title} className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={!!saved?.done} disabled={!saved||save.isPending} onChange={e=>save.mutate({id:task.id,done:e.target.checked,note:saved?.note||''})}/><div><h3 className="font-medium">{task.title}</h3><p className="mt-1 text-sm text-muted-foreground">{task.text}</p><a href={task.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline">Open account tool<ExternalLink className="h-4 w-4"/></a></div></div>{saved?.note&&<p className="mt-2 text-sm text-muted-foreground">{saved.note}</p>}</div>})}</div></section>;
}

export default function WebsitesPage(){
 const query=useQuery<{sites:Site[];revision:number}>({queryKey:key,queryFn:async()=>(await apiRequest('GET','/api/settings/websites')).json(),refetchOnWindowFocus:true});
 const sites=query.data?.sites||[];
 useEffect(()=>{document.title='Websites · CJM Business Suite';},[]);
 return <div className="mx-auto max-w-6xl"><Link href="/settings" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4"/>Settings</Link><Header title="Websites" description="Manage what customers see, preview changes privately, and confirm every website’s live status."/><div className="mb-6 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">Website controls never delete your customers, jobs, quotes or trade tools. Changes normally reach each website within 15 seconds. Turning a website back on runs private checks first.</div>{query.isLoading&&<p role="status">Loading your websites…</p>}{query.isError&&<div role="alert"><p>Could not load website controls.</p><button className={button+' mt-3'} onClick={()=>query.refetch()}>Try again</button></div>}<div className="grid items-start gap-5 lg:grid-cols-2">{sites.map(site=><SiteCard site={site} key={site.id}/>)}</div><SearchCleanup/></div>;
}

