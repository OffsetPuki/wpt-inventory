import {MATERIALS,SCOPE,PURCHASE_FIELDS,cleanBarndoQuote,purchasing} from '../lib/barndoQuote.js';

export default function BarndoQuoteDetails({state,value,onChange}) {
 const q=cleanBarndoQuote(value),buy=purchasing(state,q);
 const update=(key,val)=>onChange({...q,[key]:val});
 return <section className="barndo-business-details" aria-label="Building quote details">
  <details className="quote-section"><summary>Material specifications <span>Sections, thicknesses and product descriptions</span></summary>
   <p className="hint">These descriptions appear on the customer quote and option comparison. Enter the actual proposed section, gauge or thickness. Changing a description does not change its cost or verify structural suitability.</p>
   <div className="barndo-detail-grid">{MATERIALS.map(([key,label])=><label className="field" key={key}><span>{label}</span><input maxLength={160} placeholder="Section / gauge / product" value={q.specs[key]} onChange={e=>update('specs',{...q.specs,[key]:e.target.value})}/></label>)}</div>
  </details>
  <details className="quote-section"><summary>Included &amp; excluded <span>What the customer is buying</span></summary>
   <label className="barndo-check"><input type="checkbox" checked={q.scopeEnabled} onChange={e=>update('scopeEnabled',e.target.checked)}/> Include a scope checklist on this quote</label>
   {q.scopeEnabled&&<><p className="hint">Choose Included or Excluded for every item. Enter any charges under Edit pricing; the checklist does not add or remove charges.</p>
   {SCOPE.map(([key,label])=><div className="barndo-scope-row" key={key}><label className="field"><span>{label}</span><select value={q.scope[key].status} onChange={e=>update('scope',{...q.scope,[key]:{...q.scope[key],status:e.target.value}})}><option value="review">Choose…</option><option value="included">Included</option><option value="excluded">Excluded</option></select></label><label className="field"><span>{label} details (optional)</span><input maxLength={240} value={q.scope[key].note} onChange={e=>update('scope',{...q.scope,[key]:{...q.scope[key],note:e.target.value}})}/></label></div>)}</>}
  </details>
  <details className="quote-section"><summary>Purchasing quantities <span>Stock pieces, panels and insulation rolls</span></summary>
   <p className="hint">Enter your supplier’s usable sizes. Counts recalculate with the design and appear in Saved → Buy list. They do not change quote prices. Opening framing, connections, trim and porch framing still need a separate purchasing review.</p>
   <div className="barndo-detail-grid">{PURCHASE_FIELDS.map(([key,label,min,max])=><label className="field" key={key}><span>{label}</span><input type="number" min={min} max={max} step="any" value={q.purchase[key]} onChange={e=>{const val=e.target.value;if(val===''||(Number(val)>=min&&Number(val)<=max))update('purchase',{...q.purchase,[key]:val===''?'':Number(val)});}}/></label>)}</div>
   <p className="hint">Use net panel cover after side laps and net roll coverage after seams. Panels are cut to length, rounded up to the next inch. Wall counts allow full sheets with openings cut on site; gable offcuts are not reused. Confirm order lengths, end laps and splice locations with the supplier and approved plans.</p>
   {buy.issues.length>0&&<details><summary>Purchasing items to review ({buy.issues.length})</summary><ul>{buy.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>}
   <div className="barndo-purchase-list">{buy.rows.map(row=><div key={row.key}><strong>{row.name}: {row.qty} {row.unit}</strong><span>{row.detail}</span></div>)}</div>
  </details>
 </section>;
}
