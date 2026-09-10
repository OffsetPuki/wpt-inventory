import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import CustomerFields from './CustomerFields.jsx';
import ShareQuote from './ShareQuote.jsx';
import Attachments from './Attachments.jsx';

export default function QuoteForm({
  customer, notes, depositPct, quoteId, version, features, attachments, saveStatus, warnings, lineState, quoteStatus,
  onChangeCustomer, onChangeNotes, onChangeFeatures, onChangeAttachments, onChangeDeposit, onBack, onPersist, onIssued, onShared,
}) {
  const [customerOpen, setCustomerOpen] = useState(!customer.name?.trim());
  const [sharing, setSharing] = useState(false);
  // Use the actual customer document, including its language and attachments.
  // Preview tokens never issue the draft or start customer follow-up emails.
  const preview = useQuery({
    queryKey: ['quote-preview', quoteId, version],
    queryFn: async () => (await apiRequest('POST', `/api/quotes/${quoteId}/share`, { preview: true, version })).json(),
    enabled: !!quoteId && saveStatus === 'Saved',
    staleTime: Infinity,
  });
  const ready = saveStatus === 'Saved' && !!preview.data;
  const previewUrl = preview.data ? `${preview.data.url}&v=${version}` : null;
  const missing = lineState.items.filter(it => it.unpriced || !(Number(it.rate) > 0));
  const checks = [...warnings.filter(w => w.level === 'warn').map(w => w.msg), ...missing.map(it => `${it.name}: check the missing cost.`)];
  return <div className="page quote-review"><div className="container">
    <div className="page-head">{(!quoteStatus || quoteStatus === 'draft') && <button className="back-link" onClick={onBack}>← Edit design</button>}<h1 className="display">Review &amp; send</h1></div>
    <div className="review-layout">
      <div className="review-settings">
        <fieldset className="review-fields" disabled={sharing || (!!quoteStatus && quoteStatus !== 'draft')}>
        <details className="quote-section" open={customerOpen} onToggle={e => setCustomerOpen(e.currentTarget.open)}><summary>Customer{customer.name ? ` · ${customer.name}` : ''}</summary><CustomerFields customer={customer} onChange={onChangeCustomer} /></details>
        {!customer.name?.trim() && <p className="field-error">Enter a customer name before sending.</p>}
        <details className="quote-section"><summary>Notes, deposit &amp; attachments</summary>
          <label className="field"><span>Notes for the customer (optional)</span><textarea rows="3" value={notes} onChange={e => onChangeNotes(e.target.value)} /></label>
          <label className="field"><span>Deposit %</span><input type="number" min="0" max="100" value={depositPct} onChange={e => onChangeDeposit(Math.max(0, Math.min(100, Number(e.target.value))))} /></label>
          <label className="field"><span>Design features</span><textarea rows="3" value={features || ''} placeholder="One feature per line" onChange={e => onChangeFeatures(e.target.value)} /></label>
          <Attachments items={attachments} onChange={onChangeAttachments} />
        </details>
        </fieldset>
        {checks.length > 0 && <details className="quote-section pricing-attention" open><summary>Check pricing ({checks.length})</summary><ul>{checks.map((text,i) => <li key={i}>{text}</li>)}</ul><button className="back-link" onClick={onBack}>Return to dimensions &amp; pricing</button></details>}
        <div className="review-actions">
          <ShareQuote quoteId={quoteId} customerEmail={customer.email || ''} onBeforeShare={onPersist} onIssued={onIssued} onShared={onShared}
            actionsId="quote-send-actions"
            onBusy={setSharing}
            disabled={!ready || !customer.name?.trim()} />
          {previewUrl && <div className="btn-row"><a className={`btn ghost ${!ready ? 'disabled' : ''}`} aria-disabled={!ready} tabIndex={ready ? undefined : -1} href={`${previewUrl}&print=1`} target="_blank" rel="noopener noreferrer">Print / PDF</a>
            <a className={`back-link ${!ready ? 'disabled' : ''}`} aria-disabled={!ready} tabIndex={ready ? undefined : -1} href={previewUrl} target="_blank" rel="noopener noreferrer">Open full preview ↗</a></div>}
          <p className="hint">Send email and Copy link issue this quote and lock its prices. Preview and Print / PDF keep it as a draft.</p>
        </div>
      </div>
      <section className="customer-preview" aria-label="Customer quote preview">
        <h2>Customer preview</h2>
        {!ready && !preview.error && <p role="status">Saving the latest changes and updating the preview…</p>}
        {preview.error && <div role="alert"><p>{preview.error.message}</p><button className="btn ghost" onClick={() => preview.refetch()}>Retry preview</button></div>}
        {ready && <iframe key={previewUrl} title="Customer quote" src={`${previewUrl}&embed=1`} referrerPolicy="no-referrer" />}
      </section>
    </div>
  </div></div>;
}
