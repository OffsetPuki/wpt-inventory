import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/useApiMutation';
import { shrinkAndUpload } from '@/lib/uploadPhoto';
import { inputCls, primaryBtn, secondaryBtn } from '@/lib/ui-styles';
import Modal from './Modal';
import type { PortfolioItem } from '@shared/marketing-schema';
import { portfolioServices, portfolioDomains, projectReadiness } from '@shared/portfolio';

export default function PublicWorkEditor({item,project,onClose}: {item?:PortfolioItem;project?:{id:number;name:string;site?:string;status:string};onClose:()=>void}) {
  const [data,setData] = useState({
    title:item?.title||'', photoUrl:item?.photoUrl||'', site:item?.site||project?.site||'metals',
    category:item?.category||'', city:item?.city||'', scope:item?.scope||'', materials:item?.materials||'',
    titleEs:item?.titleEs||'', scopeEs:item?.scopeEs||'', serviceSlug:item?.serviceSlug||'',
    workType:item?.workType||(project?.status==='done'?'completed':'unspecified'), projectPage:item?.projectPage||false,
  });
  const [approved,setApproved]=useState(false), [uploading,setUploading]=useState(false), [error,setError]=useState('');
  const [requestKey]=useState(()=>crypto.randomUUID());
  const files=useQuery<any[]>({queryKey:['suite-files',project?.id],enabled:!!project,queryFn:async()=> (await apiRequest('GET',`/api/suite/jobs/${project!.id}/files`)).json()});
  const set=(key:string,value:string|boolean)=>{setData(d=>({...d,[key]:value}));setApproved(false);};
  const missing=projectReadiness(data);
  const save=useApiMutation<any,boolean>({
    request:publish=>({method:item?'PATCH':'POST',url:item?`/api/marketing/portfolio/${item.id}`:project?`/api/projects/${project.id}/publish-portfolio`:'/api/marketing/portfolio',body:{...data,category:data.category||null,published:publish,draft:!publish,approved:publish&&approved,requestKey}}),
    invalidate:[['marketing','portfolio']],successTitle:row=>row.published?'Approved work published to the selected website':'Project draft saved privately',errorTitle:'Could not save work',onSuccess:onClose,
  });
  const field=(key:'title'|'city'|'materials'|'scope'|'titleEs'|'scopeEs',label:string,multiline=false)=> <label className="block space-y-1"><span className="text-sm font-medium">{label}</span>{multiline?<textarea className={inputCls+' min-h-24 py-2'} value={data[key]} maxLength={key==='materials'?500:2000} onChange={e=>set(key,e.target.value)}/>:<input className={inputCls} value={data[key]} maxLength={key==='city'?100:160} onChange={e=>set(key,e.target.value)}/>}</label>;
  return <Modal open onClose={onClose} title={item?'Review website project':'Prepare website project'}>
    <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(data.title.trim())save.mutate(false);}}>
      <p className="text-sm text-muted-foreground">Save a private draft, then approve the exact photo and details below. Use the city only; leave customer names and street addresses out unless approved for publication.</p>
      <label className="block text-sm">Website<select aria-label="Website" className={inputCls} disabled={!!project} value={data.site} onChange={e=>{setData(d=>({...d,site:e.target.value,serviceSlug:''}));setApproved(false);}}>{Object.keys(portfolioDomains).map(site=><option key={site} value={site}>CJM {site}</option>)}</select></label>
      {field('title','Public project title')}
      <div className="grid sm:grid-cols-2 gap-3">{field('city','City')}<label className="block text-sm">Service<select aria-label="Service" className={inputCls} value={data.serviceSlug} onChange={e=>set('serviceSlug',e.target.value)}><option value="">Choose a service</option>{Object.entries(portfolioServices[data.site]||{}).map(([slug,label])=><option key={slug} value={slug}>{label}</option>)}</select></label></div>
      <label className="block text-sm">Photo shows<select aria-label="Photo shows" className={inputCls} value={data.workType} onChange={e=>set('workType',e.target.value)}><option value="unspecified">Work photo — not classified</option><option value="completed">Completed work</option><option value="process">Work in progress</option><option value="concept">Design concept / simulation</option></select></label>
      {field('scope','What did CJM do?',true)}{field('materials','Materials, finish and useful dimensions',true)}
      <details><summary className="cursor-pointer text-sm">Spanish title and description (optional)</summary><div className="space-y-3 mt-3">{field('titleEs','Título público')}{field('scopeEs','Trabajo realizado',true)}</div></details>
      {!!project && <div><p className="text-sm mb-2">Choose a job photo</p>{files.isError?<button type="button" className={secondaryBtn} onClick={()=>files.refetch()}>Retry photos</button>:<div className="grid grid-cols-3 gap-2">{files.data?.filter(f=>f.kind==='photo').map(f=><button key={f.id} type="button" aria-label={`Choose ${f.title}`} className={'border rounded p-1 '+(data.photoUrl===f.url?'ring-2 ring-primary':'')} onClick={()=>set('photoUrl',f.url)}><img src={f.thumbnail_url||f.url} alt={f.title} className="aspect-square object-cover"/></button>)}</div>}</div>}
      <label className="block text-sm">Upload a photo<input type="file" accept="image/*" disabled={uploading} className="block w-full mt-2" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setUploading(true);setError('');try{set('photoUrl',await shrinkAndUpload(f));}catch(e:any){setError(e.message);}finally{setUploading(false);}}}/></label>
      <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={data.projectPage} onChange={e=>set('projectPage',e.target.checked)}/>Create a project page with a “Request a similar project” button</label>
      {data.projectPage && missing.length>0 && <p className="text-sm text-muted-foreground">Before publishing the page, add: {missing.join(', ')}.</p>}
      <section className="rounded-xl border p-4 space-y-3" aria-label="Public preview"><p className="text-xs text-muted-foreground">Public preview · {portfolioDomains[data.site]}</p>{data.photoUrl && <img src={data.photoUrl} alt={data.title} className="max-h-64 w-full object-contain"/>}<p className="text-xs">{data.city}{data.city?' · ':''}{data.workType==='completed'?'Completed work':data.workType==='process'?'Work in progress':data.workType==='concept'?'Design concept':'Work photo'}</p><h3 className="font-semibold">{data.title||'Add your public title'}</h3><p className="whitespace-pre-line text-sm">{data.scope}</p><p className="whitespace-pre-line text-sm">{data.materials}</p>{data.projectPage && <span className="inline-block rounded bg-primary text-primary-foreground p-2 text-sm">Request a similar project →</span>}</section>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>I have approval to publish this photo and all the public details shown above.</label>
      {project && project.status!=='done' && <p className="text-sm">This job can be saved as a draft. Finish the job before publishing its completed work.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" className={secondaryBtn} disabled={!data.title.trim()||save.isPending||uploading}>{item?.published?'Save as private draft':'Save draft'}</button><button type="button" className={primaryBtn} disabled={!approved||!data.title.trim()||!data.photoUrl||save.isPending||uploading||(data.projectPage&&missing.length>0)||(!!project&&project.status!=='done')} onClick={()=>save.mutate(true)}>Publish approved work</button></div>
    </form>
  </Modal>;
}
