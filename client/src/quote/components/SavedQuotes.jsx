import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/components/ui/toaster';
import { typeLabel } from '../data/configurators.js';
import { fmtMoney } from '../lib/format.js';
import ShareQuote from './ShareQuote.jsx';

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Share lifecycle: draft (never shared) → sent (link created) → accepted
// (customer clicked accept on the website).
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted' };

/**
 * Saved quotes — every quote that reached the details step is stored in the
 * suite's database. Open one to keep working on it (edits save back to the
 * same number) or delete the ones that went nowhere.
 */
export default function SavedQuotes({ onOpen }) {
  const qc = useQueryClient();
  // Which row has its send-to-customer panel open (one at a time).
  const [shareId, setShareId] = useState(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['quotes'],
    queryFn: async () => (await apiRequest('GET', '/api/quotes')).json(),
  });

  const openQuote = useMutation({
    mutationFn: async (id) => (await apiRequest('GET', `/api/quotes/${id}`)).json(),
    onSuccess: (row) => {
      let payload = null;
      try { payload = JSON.parse(row.payload); } catch { /* handled below */ }
      if (!payload || !payload.type) {
        toast({ variant: 'destructive', title: 'Could not open quote', description: 'This quote\'s saved data is unreadable.' });
        return;
      }
      onOpen({ ...payload, quoteId: row.id, number: row.number });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not open quote', description: e?.message }),
  });

  const deleteQuote = useMutation({
    mutationFn: async (id) => apiRequest('DELETE', `/api/quotes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      toast({ variant: 'success', title: 'Quote deleted' });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not delete quote', description: e?.message }),
  });

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <p className="eyebrow">— Saved quotes</p>
          <h1 className="display" style={{ marginTop: 14 }}>Every quote, one place</h1>
          <p className="home-lede" style={{ marginTop: 18 }}>
            Quotes save here automatically once you fill in the customer details —
            from any device signed in to the suite. Open one to pick up where you left off.
          </p>
        </div>

        {isLoading && <p className="hint">Loading saved quotes…</p>}
        {error && <p className="find-error">{error.message || 'Could not load saved quotes.'}</p>}

        {!isLoading && !error && rows.length === 0 && (
          <p className="hint">
            Nothing saved yet. Start a new quote — it lands here on its own when you
            reach the customer-details step.
          </p>
        )}

        {rows.length > 0 && (
          <div className="estimate">
            <div className="estimate-head">
              <span className="eyebrow">{rows.length} {rows.length === 1 ? 'quote' : 'quotes'}</span>
            </div>
            <div className="lines">
              {rows.map((q) => (
                <div className="line" key={q.id}>
                  <div className="line-name">
                    <span className="sq-number">{q.number}</span>
                    <span className={`sq-status ${q.status || 'draft'}`}>{STATUS_LABEL[q.status] || 'Draft'}</span>
                    <span className="sq-meta">
                      {typeLabel(q.type)}{q.customerName ? ` · ${q.customerName}` : ''}{q.designRef ? ` · ${q.designRef}` : ''}
                    </span>
                    <span className="sq-date">{fmtDate(q.createdAt)}</span>
                  </div>
                  <div className="line-cost">${fmtMoney((q.totalCents || 0) / 100)}</div>
                  <div className="line-controls">
                    <button className="btn ghost sq-btn" onClick={() => openQuote.mutate(q.id)} disabled={openQuote.isPending}>
                      Open
                    </button>
                    <button className="btn ghost sq-btn" onClick={() => setShareId(shareId === q.id ? null : q.id)}>
                      {shareId === q.id ? 'Close' : 'Send'}
                    </button>
                    <button
                      className="btn ghost sq-btn"
                      onClick={() => { if (window.confirm(`Delete quote ${q.number}?`)) deleteQuote.mutate(q.id); }}
                      disabled={deleteQuote.isPending}
                    >
                      Delete
                    </button>
                  </div>
                  {shareId === q.id && <ShareQuote quoteId={q.id} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
