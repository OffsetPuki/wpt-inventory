import {useEffect,useId,useState,type SelectHTMLAttributes} from 'react';
import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {inputCls} from '@/lib/ui-styles';

/** Bounded search with the selected ID always included, including older records. */
export function RecordSelect({type,value,disabled,...props}:SelectHTMLAttributes<HTMLSelectElement>&{type:'jobs'|'clients'|'invoice-drafts'}) {
 const label=type==='jobs'?'jobs':type==='clients'?'customers':'draft invoices';
 const [search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),id=useId();
 useEffect(()=>{const t=setTimeout(()=>setDebounced(search),200);return()=>clearTimeout(t);},[search]);
 const results=useQuery<any[]>({queryKey:[type==='jobs'?'projects-picker':type==='clients'?'crm-clients-picker':'finance-invoices-picker',debounced,value],queryFn:async()=>(await apiRequest('GET',`/api/suite/pickers/${type}?q=${encodeURIComponent(debounced)}&id=${value||''}`)).json()});
 return <span className="grid gap-2"><input aria-label={`Search ${label}`} aria-controls={id} className={inputCls} disabled={disabled} value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${label}…`}/><select aria-label={`Select ${label}`} {...props} id={id} value={value} disabled={disabled} className={props.className||inputCls}><option value="">{'No '+(type==='jobs'?'job':type==='clients'?'customer':'draft')+' selected'}</option>{value&&!results.data?.some(r=>String(r.id)===String(value))&&<option value={String(value)}>Selected #{value}</option>}{results.data?.map(r=><option key={r.id} value={r.id}>{r.jobNumber?`${r.jobNumber} — `:''}{r.name}</option>)}</select>{results.isError&&<button type="button" className="text-left text-xs text-destructive underline" onClick={()=>results.refetch()}>Couldn’t load choices. Try again.</button>}<span className="text-xs text-muted-foreground">{results.isFetching?'Finding matches…':'Search to find older records.'}</span></span>;
}
