export function BarndominiumQuoteTools({session,onDuplicate,onAlternative,onCompare,busy}){
 return <section className="container barndo-quote-tools" aria-label="Barndominium quote actions">
  <div className="barndo-template-actions">
   <button className="btn ghost" disabled={busy} onClick={onDuplicate}>{busy?'Creating copy…':'Duplicate quote'}</button>
   <button className="btn ghost" disabled={busy||(session.quoteStatus&&session.quoteStatus!=='draft')} onClick={onAlternative}>Create alternative for this customer</button>
   <button className="btn ghost" disabled={busy} onClick={onCompare}>Compare &amp; send options</button>
  </div>
  {session.copiedFromNumber&&<p className="hint">Copy of {session.copiedFromNumber}. The original quote is unchanged.</p>}
 </section>;
}
