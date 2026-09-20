export function BarndominiumQuoteTools({session,onDuplicate,onAlternative,onCompare,busy}){
 return <><details className="container barndo-quote-tools" aria-label="Quote options"><summary>More quote options</summary>
  <div className="barndo-template-actions">
   <button className="btn ghost" disabled={busy} onClick={onDuplicate}>{busy?'Creating copy…':'Duplicate quote'}</button>
   <button className="btn ghost" disabled={busy||(session.quoteStatus&&session.quoteStatus!=='draft')} onClick={onAlternative}>Create alternative for this customer</button>
   <button className="btn ghost" disabled={busy} onClick={onCompare}>Compare &amp; send options</button>
  </div>
 </details>
  {session.copiedFromNumber&&<p className="hint">Copy of {session.copiedFromNumber}. The original quote is unchanged.</p>}
 </>;
}
