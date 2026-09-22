import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {inputCls} from '@/lib/ui-styles';
type Links={clientId?:number|null;projectId?:number|null;quoteId?:number|null;customer:string};
export default function PreviewConnections({value,onChange}:{value:Links;onChange:(patch:Partial<Links>)=>void}) {
 const [search,setSearch]=useState(''),[query,setQuery]=useState('');
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer);},[search]);
 const result=useQuery<{clients:{id:number;name:string}[];jobs:{id:number;name:string;clientId:number|null}[];quotes:{id:number;number:string;customerName:string}[]}>({queryKey:['preview-connections',query,value.clientId],queryFn:async()=>(await apiRequest('GET',`/api/customer-previews/connections?q=${encodeURIComponent(query)}&clientId=${value.clientId||''}`)).json()});
 return <section className="space-y-2" aria-label="Linked customer and job">
  <label className="block text-sm">Find customer, job or quote<input className={inputCls} type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, phone, email or quote number"/></label>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="text-sm">Linked customer<select className={inputCls} value={value.clientId||''} onChange={e=>{const c=result.data?.clients.find(c=>c.id===Number(e.target.value));onChange({clientId:c?.id||null,projectId:null,quoteId:null,...(c?{customer:c.name}:{})});}}><option value="">Not linked</option>{value.clientId&&!result.data?.clients.some(c=>c.id===value.clientId)&&<option value={value.clientId}>{value.customer||`Customer #${value.clientId}`}</option>}{result.data?.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="text-sm">Linked job (optional)<select className={inputCls} value={value.projectId||''} onChange={e=>{const j=result.data?.jobs.find(j=>j.id===Number(e.target.value));onChange({projectId:j?.id||null,...(j?.clientId?{clientId:j.clientId}:{})});}}><option value="">No job yet</option>{value.projectId&&!result.data?.jobs.some(j=>j.id===value.projectId)&&<option value={value.projectId}>Job #{value.projectId}</option>}{result.data?.jobs.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
  </div>
  <label className="block text-sm">Linked quote (optional)<select className={inputCls} value={value.quoteId||''} onChange={e=>onChange({quoteId:Number(e.target.value)||null})}><option value="">No quote linked</option>{value.quoteId&&!result.data?.quotes?.some(q=>q.id===value.quoteId)&&<option value={value.quoteId}>Quote #{value.quoteId}</option>}{result.data?.quotes?.map(q=><option key={q.id} value={q.id}>{q.number} · {q.customerName||'No customer name'}</option>)}</select><span className="block text-xs text-muted-foreground">Enable the preview's customer link to show a preview button on this quote.</span></label>
  {result.isError&&<p role="alert">Connections could not load. <button type="button" onClick={()=>result.refetch()}>Retry</button></p>}
  {value.quoteId&&<a className="text-sm underline" href={`/#/crm/quotes?quote=${value.quoteId}`}>Open source quote</a>}
 </section>;
}
