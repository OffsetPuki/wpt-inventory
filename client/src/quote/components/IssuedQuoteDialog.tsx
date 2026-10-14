import ConnectedRecords from '@/components/ConnectedRecords';
import { useState } from 'react';
import Modal from '@/components/Modal';
import { apiRequest } from '@/lib/queryClient';
import { formatMoney,formatDateTime } from '@/lib/format';
import { primaryBtn, secondaryBtn } from '@/lib/ui-styles';
import DocumentActivityButton from '@/components/DocumentActivity';

export default function IssuedQuoteDialog({ quote, onClose }: { quote: any; onClose: () => void }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  let customer: { name?: string; company?: string; location?: string } = {};
  try { customer = JSON.parse(quote.payload).customer || {}; } catch { /* The saved record header remains available. */ }
  const preview = async () => {
    setBusy(true); setError('');
    try { const result = await (await apiRequest('POST', `/api/quotes/${quote.id}/share`, { preview: true })).json(); setUrl(result.url); }
    catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  return <Modal open title={quote.number} onClose={onClose}><div className="space-y-5">
    <p className="text-sm text-muted-foreground">Issued quote · {quote.status}. This copy is read-only. Your working draft is kept separately.</p>
    <section className="space-y-2 rounded-xl border p-4 text-sm" aria-label="Quote revision and validity"><p className="font-semibold">Revision {quote.review?.revision||1} of {quote.review?.revisions||1} · Saved version {quote.version}</p><p>{quote.review?.policy?`Issued ${formatDateTime(quote.review.policy.issuedAt)} · ${quote.status==='accepted'?'Original offer deadline':quote.review.expired?'Expired':'Valid until'} ${formatDateTime(quote.review.policy.expiresAt)}`:'Original expiry was not recorded for this older quote.'}</p>{quote.review?.accepted?<p>Accepted revision: <strong>{quote.review.accepted.number}</strong>{quote.review.accepted.deleted_at?' (in Trash)':''} · {formatDateTime(quote.review.accepted.accepted_at)}. Approved work is changed through a job change order.</p>:<p>No revision in this quote’s history has been accepted.</p>}{quote.review?.acceptance&&<p>{quote.review.acceptance.method==='manual'?'Acceptance recorded by staff':'Acceptance recorded by'}: {quote.review.acceptance.by||'Not recorded'}.</p>}</section>
    <div className="rounded-xl border p-4"><h2 className="font-semibold">{customer.name || quote.customerName || 'Customer'}</h2>{customer.company && <p>{customer.company}</p>}{customer.location && <p className="text-sm text-muted-foreground">{customer.location}</p>}<p className="mt-3 text-2xl font-semibold">{formatMoney(quote.totalCents)}</p></div>
    <ConnectedRecords kind="quote" id={quote.id}/>
    <DocumentActivityButton kind="quote" id={quote.id} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {url ? <a className={primaryBtn} href={url} target="_blank" rel="noopener noreferrer">Open complete quote</a> : <button className={primaryBtn} disabled={busy} onClick={preview}>{busy ? 'Preparing copy…' : 'View complete quote'}</button>}
    <button className={secondaryBtn} onClick={onClose}>Back to quotes</button>
  </div></Modal>;
}
