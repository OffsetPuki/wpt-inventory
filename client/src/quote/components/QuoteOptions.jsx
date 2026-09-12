import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {fmtMoney as formatAmount} from '../lib/format.js';
const fmtMoney=n=>`$${formatAmount(n)}`;

const api=async(path,method='GET',body)=> (await apiRequest(method,path,body)).json();
export default function QuoteOptions({quoteId,onBack,onDone,onShared}) {
 const qc=useQueryClient();
 const current=useQuery({queryKey:['quote',quoteId],queryFn:()=>api(`/api/quotes/${quoteId}`)});
 const existing=useQuery({queryKey:['quote-options',quoteId],queryFn:()=>api(`/api/quotes/${quoteId}/options`)});
 const source=current.data?JSON.parse(current.data.payload):{};
 const list=useQuery({queryKey:['option-quotes',current.data?.customerName],queryFn:()=>api(`/api/quotes?trade=metals&page=1&pageSize=50&q=${encodeURIComponent(current.data?.customerName||'')}`),enabled:!!current.data});
 const [otherId,setOtherId]=useState(''),[titles,setTitles]=useState(['Recommended materials','Alternative materials']),[explanations,setExplanations]=useState(['','']),[recommended,setRecommended]=useState(0),[reviewed,setReviewed]=useState(false),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[requestKey]=useState(()=>crypto.randomUUID());
 const other=Number(otherId||source.alternativeOf||0),ids=source.alternativeOf?[other,quoteId]:[quoteId,other];
 function change(fn){fn();setPreview(null);setReviewed(false);setError('');}
 async function review(){setBusy(true);setError('');try{
  const rows=await Promise.all(ids.map(id=>api(`/api/quotes/${id}`)));
  const body={options:rows.map((r,i)=>({id:r.id,version:r.version,title:titles[i],explanation:explanations[i]})),recommendedId:ids[recommended]};
  const data=await api('/api/quote-options/preview','POST',body);setPreview({...data,body});setReviewed(false);
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 async function share(sendEmail){setBusy(true);setError('');try{
  const data=await api('/api/quote-options/share','POST',{...preview.body,sendEmail,materialReviewed:reviewed,requestKey});setResult({...data,wantedEmail:sendEmail});onShared?.();qc.invalidateQueries({queryKey:['quotes']});qc.invalidateQueries({queryKey:['quote',quoteId]});
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 if(current.isPending||existing.isPending)return <p className="container" role="status">Loading quote options…</p>;
 if(current.error||existing.error)return <div className="container" role="alert">Could not load quote options. <button className="btn" onClick={()=>{current.refetch();existing.refetch();}}>Retry</button><button className="btn ghost" onClick={onBack}>Back</button></div>;
 if(existing.data&&!result)return <section className="container"><h1>Options already sent</h1><a className="btn" href={existing.data.url} target="_blank" rel="noreferrer">Open both customer options</a><button className="btn ghost" onClick={onBack}>Back</button></section>;
 return <section className="container barndo-options"><button className="btn ghost" disabled={busy} onClick={onBack}>← Back to quote</button><h1>Compare &amp; send two options</h1>
  {result?<div role="status"><h2>{result.wantedEmail?(result.emailed?'Both options emailed':'Options issued; email was not delivered'):'Both options issued'}</h2><p>Both quotes are locked. The customer can accept one option.</p><label className="field"><span>Customer options link</span><input readOnly value={result.url} onFocus={e=>e.target.select()}/></label><a className="btn" href={result.url} target="_blank" rel="noreferrer">Open customer comparison</a><button className="btn ghost" onClick={()=>onDone(result)}>Done</button></div>:<>
   <p>Send two separate prices for the same job. Explain the material or scope differences and mark your recommendation.</p>
   <fieldset disabled={busy} className="barndo-options-fields">
    <label className="field"><span>{source.alternativeOf?'Option 1 quote':'Option 2 quote'}</span><select value={other||''} onChange={e=>change(()=>setOtherId(e.target.value))}><option value="">Choose another quote</option>{(list.data?.rows||[]).filter(q=>q.type==='barndominium'&&q.id!==quoteId&&['draft','sent'].includes(q.status)).map(q=><option key={q.id} value={q.id}>{q.number} · {q.customerName} · {fmtMoney(q.totalCents/100)}</option>)}</select></label>
    {list.isError&&<p role="alert">Could not load other quotes. <button onClick={()=>list.refetch()}>Retry</button></p>}
    <div className="barndo-option-grid">{[0,1].map(i=><section key={i}><h2>Option {i+1}</h2><label className="field"><span>Option {i+1} name</span><input maxLength={100} value={titles[i]} onChange={e=>change(()=>setTitles(t=>t.map((v,j)=>i===j?e.target.value:v)))}/></label><label className="field"><span>Option {i+1} explanation for the customer</span><textarea maxLength={600} rows={3} placeholder="Describe the section / gauge difference, what changes, and why." value={explanations[i]} onChange={e=>change(()=>setExplanations(t=>t.map((v,j)=>i===j?e.target.value:v)))}/></label><label className="barndo-check"><input type="radio" name="recommended-option" checked={recommended===i} onChange={()=>change(()=>setRecommended(i))}/> Recommend Option {i+1}</label></section>)}</div>
    <button className="btn" disabled={!other||titles.some(t=>!t.trim())||explanations.some(t=>!t.trim())} onClick={review}>{busy?'Loading…':'Review both quotes'}</button>
   </fieldset>
   {preview&&<><div className="barndo-option-grid">{preview.options.map(o=><article className="barndo-template-card" key={o.id}><h2>Option {o.position}{o.recommended?' · Recommended':''}</h2><h3>{o.title}</h3><p>{o.explanation}</p><div className="barndo-option-drawing" dangerouslySetInnerHTML={{__html:o.svg}}/><strong>{fmtMoney(o.totalCents/100)}</strong><p>{o.number}</p></article>)}</div><p>Option 2 minus Option 1: <strong>{fmtMoney(preview.deltaCents/100)}</strong></p>
    <div className="barndo-comparison-table"><table><thead><tr><th>Detail</th><th>Option 1</th><th>Option 2</th></tr></thead><tbody>{preview.differences.filter(r=>r.changed).map((r,i)=><tr key={i}><th>{r.label}</th><td>{r.a}</td><td>{r.b}</td></tr>)}</tbody></table></div>
    {preview.issues.length>0?<div className="pricing-attention"><strong>Fix before sending</strong><ul>{preview.issues.map((v,i)=><li key={i}>{v}</li>)}</ul></div>:<><label className="barndo-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/> I reviewed both prices, scope and proposed material specifications. The descriptions explain the differences; structural suitability requires the applicable project review.</label><p>Both quotes will be issued and locked. Sent alternatives cannot be edited; create new drafts to change them.</p><div className="btn-row"><button className="btn" disabled={busy||!reviewed||!preview.email} onClick={()=>share(true)}>Send both options by email</button><button className="btn ghost" disabled={busy||!reviewed} onClick={()=>share(false)}>Create customer options link</button></div><p className="hint">{preview.email?`Email to ${preview.email}`:'No customer email available. Create a link instead.'}</p></>}
   </>}
   {error&&<p role="alert" className="field-error">{error}</p>}
  </>}
 </section>;
}
