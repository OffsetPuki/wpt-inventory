import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {toast} from '@/components/ui/toaster';
import {fresh} from '../lib/barndominium/model.js';

const starters=[[20,25],[30,40],[40,60]].map(([width,depth])=>({id:`starter-${width}-${depth}`,name:`${width} × ${depth} shell`,state:{...fresh(),width,depth,openings:[],porches:[]}}));

export function BarndominiumQuoteTools({session,onDuplicate,onTemplates,onAlternative,onCompare,busy}){
 const qc=useQueryClient();
 const [naming,setNaming]=useState(false),[name,setName]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 async function save(event){
  event.preventDefault();setSaving(true);setError('');
  try{
   await apiRequest('POST','/api/quotes/barndominium-templates',{name,state:session.state});
   qc.invalidateQueries({queryKey:['barndominium-templates']});setNaming(false);
   toast({title:'Design template saved',description:'Available under Barndominium templates on every suite device.'});
  }catch(e){setError(e.message||'Could not save the template.');}finally{setSaving(false);}
 }
 return <section className="container barndo-quote-tools" aria-label="Barndominium quote copies and templates">
  <div className="barndo-template-actions">
   <button className="btn" disabled={busy} onClick={onDuplicate}>{busy?'Creating copy…':'Duplicate quote'}</button>
   <button className="btn" disabled={busy||(session.quoteStatus&&session.quoteStatus!=='draft')} onClick={onAlternative}>Create alternative for this customer</button>
   <button className="btn" disabled={busy} onClick={onCompare}>Compare &amp; send options</button>
   <button className="btn" onClick={()=>{setName(`${session.state.width} × ${session.state.depth} shell`);setError('');setNaming(true);}}>Save as template</button>
   <button className="btn ghost" onClick={onTemplates}>Barndominium templates</button>
  </div>
  {session.copiedFromNumber&&<p className="hint">Copy of {session.copiedFromNumber}. The original quote is unchanged.</p>}
  {naming&&<form onSubmit={save} className="barndo-template-form">
   <label>Template name<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
   <p className="hint">Saves dimensions, openings, porches, finishes and insulation. Customer details, attachments and quote prices are excluded.</p>
   {error&&<p role="alert">{error}</p>}
   <div className="barndo-template-actions"><button className="btn primary" disabled={saving||!name.trim()}>{saving?'Saving…':'Save template'}</button><button type="button" className="btn ghost" disabled={saving} onClick={()=>setNaming(false)}>Cancel</button></div>
  </form>}
 </section>;
}

export default function BarndominiumTemplates({onUse,onBack}){
 const [busy,setBusy]=useState(false);
 const query=useQuery({queryKey:['barndominium-templates'],queryFn:async()=> (await apiRequest('GET','/api/quotes/barndominium-templates')).json()});
 const useTemplate=async template=>{setBusy(true);try{await onUse(structuredClone(template.state));}finally{setBusy(false);}};
 const cards=rows=><div className="barndo-template-grid">{rows.map(template=><article key={template.id} className="barndo-template-card">
  <h3>{template.name}</h3><p>{template.state.width} × {template.state.depth} ft · {template.state.height} ft walls · {template.state.pitch}:12 roof</p>
  <p className="hint">{template.state.openings.length} doors/windows · {template.state.porches.length} porches</p>
  <button className="btn primary" disabled={busy} onClick={()=>useTemplate(template)}>Use {template.name}</button>
 </article>)}</div>;
 return <section className="container barndo-templates">
  <button className="btn ghost" onClick={onBack}>← New quote</button><h1>Barndominium templates</h1>
  <p>Start a separate quote from a reusable design. Prices use your current price book; review and enter any missing costs.</p>
  <h2>Starter shells</h2>{cards(starters)}
  <h2>Saved designs</h2>
  {query.isPending?<p role="status">Loading templates…</p>:query.isError?<p role="alert">Could not load saved templates. <button className="btn" onClick={()=>query.refetch()}>Retry</button></p>:query.data?.length?cards(query.data):<p>No saved designs yet. Open a barndominium quote and choose Save as template.</p>}
 </section>;
}
