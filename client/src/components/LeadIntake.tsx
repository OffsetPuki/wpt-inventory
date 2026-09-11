import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {Link} from 'wouter';
import {RetryBlock} from './RetryBlock';
type Intake={context:{contact?:string;bestTime?:string;page?:string;consent?:string;qualification?:Record<string,string>};first_contact_at?:number;qualified_at?:number;survey_at?:number};
export function LeadIntake({id}:{id:number}){
 const query=useQuery<Intake>({queryKey:['crm-lead-intake',id],queryFn:async()=>(await apiRequest('GET',`/api/crm/leads/${id}/intake`)).json()});
 const client=useQueryClient();const [error,setError]=useState(''),[pending,setPending]=useState(false),[pendingQualified,setPendingQualified]=useState<boolean|undefined>();
 const save=async(body:object)=>{setPending(true);setError('');try{await apiRequest('PATCH',`/api/crm/leads/${id}/intake`,body);await client.invalidateQueries({queryKey:['crm-lead-intake',id]});await client.invalidateQueries({queryKey:['crm-lead-funnel']});}catch(e){setError((e as Error).message);}finally{setPending(false);}};
 if(query.isError)return <RetryBlock query={query}/>;
 if(!query.data)return <p role="status">Loading request details…</p>;
 const {context,qualified_at,survey_at}=query.data;
 const labels:Record<string,string>={projectKind:'Work type',removal:'Concrete removal',dimensions:'Approximate size',budget:'Budget',facilityCompany:'Company / facility',deadline:'Project deadline'};
 return <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">Customer request</h3>
  <dl className="grid grid-cols-2 gap-2 text-sm">{Object.entries({Contact:context.contact,'Requested time':context.bestTime,'Entry page':context.page,'Call/text consent':context.consent==='yes'?'Agreed':'Not provided',...Object.fromEntries(Object.entries(context.qualification||{}).filter(([,v])=>v).map(([k,v])=>[labels[k]||k,v]))}).filter(([,v])=>v).map(([k,v])=><div key={k} className="min-w-0"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
  <p className="text-xs text-muted-foreground">Requested times need confirmation. Use the activity log below after speaking with the customer.</p>
  <label className="flex items-center gap-2"><input type="checkbox" checked={pendingQualified ?? !!qualified_at} disabled={pending} onChange={e=>{const qualified=e.target.checked;setPendingQualified(qualified);void save({qualified}).finally(()=>setPendingQualified(undefined));}}/> Qualified project</label>
  <label className="block text-sm">Confirmed site visit<input key={survey_at||'none'} type="datetime-local" className="block border rounded p-2 mt-1 bg-background" disabled={pending} defaultValue={survey_at?new Date(survey_at-new Date(survey_at).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onBlur={e=>{const value=e.target.value?new Date(e.target.value).getTime():null;if(value!==(survey_at||null))void save({surveyAt:value});}}/></label>
  {error&&<p role="alert" className="text-destructive">{error}</p>}
 </section>;
}
type Funnel={days:number;queue:{id:number;name:string;site:string;createdAt:number;service:string;assignedTo:number|null}[];report:{site:string;leads:number;qualified:number;surveys:number;quoted:number;won:number;wonValueCents:number;responseSample:number;averageResponseMinutes:number|null}[];bySource:{site:string;source:string;campaign:string;leads:number;qualified:number;quotes:number;won:number;averageResponseMinutes:number|null}[]};
export function LeadQueue(){
 const query=useQuery<Funnel>({queryKey:['crm-lead-funnel'],queryFn:async()=>(await apiRequest('GET','/api/crm/lead-funnel')).json()});
 if(query.isError)return <RetryBlock query={query}/>;
 if(!query.data)return <p role="status">Loading new requests…</p>;
 return <section className="border rounded-xl bg-card p-5"><h2 className="font-semibold">Requests waiting for contact ({query.data.queue.length})</h2>
  {!query.data.queue.length&&<p className="mt-2 text-sm">No new requests waiting.</p>}
  <ul className="divide-y mt-3">{query.data.queue.slice(0,8).map(lead=><li key={lead.id} className="py-3"><Link className="underline font-medium" href={`/crm/leads?lead=${lead.id}`}>{lead.name}</Link><span className="text-sm ml-2">{lead.site} · {lead.service||'Project enquiry'} · {Math.max(0,Math.floor((Date.now()-lead.createdAt)/3600000))}h waiting{!lead.assignedTo?' · Unassigned':''}</span></li>)}</ul>
  {query.data.queue.length>8&&<Link className="underline" href="/crm/leads">View all leads</Link>}
  <details className="border-t pt-3 mt-3"><summary className="cursor-pointer py-2">Lead results · last {query.data.days} days</summary>
   <p className="text-xs text-muted-foreground my-3">Grouped by the date the lead arrived. Response time uses logged human calls, emails or meetings. Won value is recorded business value, not collected cash.</p>
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Trade','Leads','Qualified','Visits','Quoted*','Won','Avg response'].map(h=><th className="text-left p-2" key={h}>{h}</th>)}</tr></thead><tbody>{query.data.report.map(r=><tr key={r.site}>{[r.site,r.leads,r.qualified,r.surveys,r.quoted,r.won,r.averageResponseMinutes===null?'No logged contact':`${r.averageResponseMinutes} min (${r.responseSample})`].map((v,i)=><td className="p-2 border-t" key={i}>{v}</td>)}</tr>)}</tbody></table></div>
   <p className="text-xs mt-2">*Leads currently at quote sent, follow-up or won. Qualification and visit counts require staff confirmation.</p>
   <h3 className="font-medium mt-5">Sources and campaigns</h3>
   <div className="overflow-x-auto mt-2"><table className="text-sm w-full"><thead><tr>{['Source / campaign','Trade','Leads','Qualified','Quoted*','Won','Response'].map(h=><th className="text-left p-2" key={h}>{h}</th>)}</tr></thead><tbody>{query.data.bySource.map((r,i)=><tr key={i}>{[[r.source,r.campaign].filter(Boolean).join(' / '),r.site,r.leads,r.qualified,r.quotes,r.won,r.averageResponseMinutes===null?'—':`${r.averageResponseMinutes} min`].map((v,n)=><td className="p-2 border-t" key={n}>{v}</td>)}</tr>)}</tbody></table></div>
  </details>
 </section>;
}
