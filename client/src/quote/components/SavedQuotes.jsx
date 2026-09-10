import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/components/ui/toaster';
import { typeLabel } from '../data/configurators.js';
import { fmtMoney } from '../lib/format.js';
import ShareQuote from './ShareQuote.jsx';
import { WIN_LOSS_REASON_LABELS } from '@shared/crm-schema';

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Share lifecycle: draft (never shared) → sent (link created) → accepted /
// declined (customer clicked one or the other on the website).
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };

/**
 * Combined buy list across the checked quotes: one supplier order — total ft
 * of each tubing, bags, hardware sets — with waste already included. Each
 * quote is priced against its own snapshot book server-side.
 */
function BuyList({ ids, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['quote-buy-list', [...ids].sort().join(',')],
    queryFn: async () => (await apiRequest('GET', `/api/quotes/buy-list?ids=${[...ids].join(',')}`)).json(),
  });

  // Buy list → a draft PO in Finance (#17). Lines carry materialKey so marking
  // the PO received stocks the mapped inventory items in. Vendor and prices are
  // the owner's to fill — the PO lands at $0.
  const [poNumber, setPoNumber] = useState(null);
  const createPo = useMutation({
    mutationFn: async () => {
      const items = data.combined
        .filter((m) => (Number(m.qty) || 0) > 0)
        .map((m) => ({
          description: m.name,
          qty: m.qty,
          unitPriceCents: 0,
          unit: m.unit || undefined,
          materialKey: m.id,
        }));
      const numbers = data.quotes.map((q) => q.number).join(', ');
      return (await apiRequest('POST', '/api/finance/purchase-orders', {
        vendor: '',
        items,
        notes: `Buy list from quote${data.quotes.length === 1 ? '' : 's'} ${numbers}. Set the vendor and prices, then mark received to book the expense and stock in.`,
      })).json();
    },
    onSuccess: (po) => {
      setPoNumber(po.number);
      toast({ variant: 'success', title: `Purchase order ${po.number} created`, description: 'Fill in the vendor and prices in Finance → Purchase orders.' });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not create purchase order', description: e?.message }),
  });

  const copy = async () => {
    const lines = [
      `CJM Metals — buy list (${data.quotes.map((q) => q.number).join(', ')})`,
      ...data.combined.map((m) => `- ${m.name}: ${m.qty} ${m.unit}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast({ variant: 'success', title: 'Buy list copied', description: 'Paste it into a text or email to your supplier.' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not copy', description: 'Select and copy the list manually.' });
    }
  };

  return (
    <div className="estimate" style={{ marginBottom: 18 }}>
      <div className="estimate-head">
        <span className="eyebrow">Buy list — {ids.size} {ids.size === 1 ? 'quote' : 'quotes'} combined (incl. waste)</span>
        <span>
          {data && data.combined.length > 0 && !poNumber && (
            <button className="estimate-reset" onClick={() => createPo.mutate()} disabled={createPo.isPending} style={{ marginRight: 8 }}>
              {createPo.isPending ? 'Creating…' : 'Create purchase order'}
            </button>
          )}
          {data && data.combined.length > 0 && (
            <button className="estimate-reset" onClick={copy} style={{ marginRight: 8 }}>Copy for supplier</button>
          )}
          <button className="estimate-reset" onClick={onClose}>Close</button>
        </span>
      </div>
      {poNumber && (
        <p className="hint">
          Purchase order <strong>{poNumber}</strong> created — <a href="/#/finance/purchase-orders">open it in Finance</a> to set the vendor and prices.
        </p>
      )}
      {isLoading && <p className="hint">Adding up materials…</p>}
      {error && <p className="find-error">{error.message || 'Could not build the buy list.'}</p>}
      {data && data.combined.length === 0 && (
        <p className="hint">No material lines found in the selected quotes.</p>
      )}
      {data && data.combined.length > 0 && (
        <div className="lines">
          {data.combined.map((m) => (
            <div key={m.id} className="line">
              <div className="line-name"><span className="dot" />{m.name}</div>
              <div className="line-cost">{m.qty} {m.unit}</div>
            </div>
          ))}
        </div>
      )}
      {data && data.quotes.length > 1 && (
        <p className="hint" style={{ marginTop: 8 }}>
          From: {data.quotes.map((q) => `${q.number} (${typeLabel(q.type)}${q.customerName ? ` — ${q.customerName}` : ''})`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * Saved quotes — every quote that reached the details step is stored in the
 * suite's database. Open one to keep working on it (edits save back to the
 * same number), check several to build a combined material buy list, or
 * delete the ones that went nowhere.
 */
export default function SavedQuotes({ onOpen, onDuplicate }) {
  const qc = useQueryClient();
  // Which row has its send-to-customer panel open (one at a time).
  const [shareId, setShareId] = useState(null);
  // Checked quote ids for the combined buy list.
  const [checked, setChecked] = useState(() => new Set());
  const [showBuyList, setShowBuyList] = useState(false);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({q:'',trade:'',status:'',page:1});
  useEffect(() => { const timer = setTimeout(() => setFilters(f => ({...f,q:search.trim(),page:1})), 300); return () => clearTimeout(timer); }, [search]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['quotes', filters],
    queryFn: async () => (await apiRequest('GET', '/api/quotes?' + new URLSearchParams({...filters,pageSize:20}))).json(),
  });
  const rows = data?.rows || [];
  const setFilter = (key, value) => { setShareId(null); setFilters(f => ({...f,[key]:value,page:1})); };

  const toggleChecked = (id) => {
    setShowBuyList(false);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else if (next.size < 50) next.add(id);
      return next;
    });
  };

  // One fetch, two destinations: open the quote itself, or start a copy of it.
  const openQuote = useMutation({
    mutationFn: async ({ id }) => (await apiRequest('GET', `/api/quotes/${id}`)).json(),
    onSuccess: (row, { duplicate }) => {
      let payload = null;
      try { payload = JSON.parse(row.payload); } catch { /* handled below */ }
      if (!payload || !payload.type) {
        toast({ variant: 'destructive', title: 'Could not open quote', description: 'This quote\'s saved data is unreadable.' });
        return;
      }
      // A copy deliberately gets NEITHER id nor number — duplicateSession drops
      // them anyway, but not handing them over makes that impossible to undo by
      // accident later.
      if (duplicate) onDuplicate(payload);
      else onOpen({ ...payload, quoteId: row.id, number: row.number, version: row.version, leadId: row.leadId, quoteStatus: row.status });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not open quote', description: e?.message }),
  });

  const viewQuote = useMutation({
    mutationFn: async (id) => (await apiRequest('POST', `/api/quotes/${id}/share`, { preview: true })).json(),
    onSuccess: (row) => window.open(row.url, '_blank', 'noopener'),
    onError: (e) => toast({ variant: 'destructive', title: 'Could not open quote', description: e?.message }),
  });
  const reviseQuote = useMutation({
    mutationFn: async (id) => (await apiRequest('POST', `/api/quotes/${id}/revision`)).json(),
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['quotes'] }); openQuote.mutate({ id: row.id }); },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not create revision', description: e?.message }),
  });
  const deleteQuote = useMutation({
    mutationFn: async (id) => apiRequest('DELETE', `/api/quotes/${id}`),
    onSuccess: (_result, id) => {
      setChecked(prev => { const next = new Set(prev); next.delete(id); return next; });
      qc.invalidateQueries({ queryKey: ['quotes'] });
      toast({ variant: 'success', title: 'Quote deleted' });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Could not delete quote', description: e?.message }),
  });

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <h1 className="display">Saved quotes</h1>
        </div>
        <div className="quote-filters">
          <label className="field"><span>Search quotes</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, company, quote or design code" /></label>
          <label className="field"><span>Trade</span><select aria-label="Trade" value={filters.trade} onChange={e => setFilter('trade', e.target.value)}><option value="">All trades</option><option value="metals">Metals</option><option value="concrete">Concrete</option><option value="insulation">Insulation</option></select></label>
          <label className="field"><span>Status</span><select aria-label="Status" value={filters.status} onChange={e => setFilter('status', e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        {checked.size > 0 && <div className="quote-selection"><span>{checked.size} selected across pages (up to 50)</span><button className="btn ghost sq-btn" onClick={() => setShowBuyList(true)}>Buy list ({checked.size})</button><button className="back-link" onClick={() => { setChecked(new Set()); setShowBuyList(false); }}>Clear selection</button></div>}
        {isLoading && <p className="hint">Loading saved quotes…</p>}
        {error && <p className="find-error">{error.message || 'Could not load saved quotes.'} <button className="back-link" onClick={() => refetch()}>Retry</button></p>}

        {!isLoading && !error && rows.length === 0 && (
          <p className="hint">
            No quotes match. Clear the filters or start a new quote; drafts save automatically.
          </p>
        )}

        {showBuyList && checked.size > 0 && (
          <BuyList ids={checked} onClose={() => setShowBuyList(false)} />
        )}

        {rows.length > 0 && (
          <div className="estimate">
            <div className="estimate-head">
              <span className="eyebrow">{data?.total || 0} quotes</span>
            </div>
            <div className="lines">
              {rows.map((q) => (
                <div className="line" key={q.id}>
                  <div className="line-name">
                    <input
                      type="checkbox"
                      checked={checked.has(q.id)}
                      onChange={() => toggleChecked(q.id)}
                      aria-label={`Select ${q.number} for buy list`}
                      disabled={!checked.has(q.id) && checked.size >= 50}
                      title="Add to the combined buy list"
                      style={{ marginRight: 8 }}
                    />
                    <span className="sq-number">{q.number}</span>
                    <span className={`sq-status ${q.status || 'draft'}`}>{STATUS_LABEL[q.status] || 'Draft'}</span>
                    {/* Did they open the link? Stamped by the website's quote page. */}
                    {q.status !== 'draft' && (
                      <span className="sq-meta" title={q.viewedAt ? `First opened ${fmtDate(q.viewedAt)}` : 'The customer has not opened the link yet'}>
                        {q.viewedAt
                          ? `Opened ${fmtDate(q.lastViewedAt || q.viewedAt)}${q.viewCount > 1 ? ` · ${q.viewCount}×` : ''}`
                          : 'Not opened yet'}
                      </span>
                    )}
                    {/* Why the customer said no — their note, if any, on hover. */}
                    {q.status === 'declined' && q.declineReason && (
                      <span className="sq-meta" title={q.declineNote || undefined}>
                        {WIN_LOSS_REASON_LABELS[q.declineReason] || q.declineReason}{q.declineNote ? ' · “' + q.declineNote + '”' : ''}
                      </span>
                    )}
                    {/* Automated follow-up ladder state (Phase F) — the hourly
                        sweep emails sent quotes at 2 and 7 days unless the
                        customer unsubscribed. */}
                    {(q.optedOut || q.fu2SentAt || q.fu1SentAt) && (
                      <span className="sq-meta" title="Automated follow-up emails">
                        {q.optedOut ? 'Opted out of emails' : q.fu2SentAt ? 'FU 2 sent' : 'FU 1 sent'}
                      </span>
                    )}
                    <span className="sq-meta">
                      {typeLabel(q.type)}{q.customerName ? ` · ${q.customerName}` : ''}{q.designRef ? ` · ${q.designRef}` : ''}
                    </span>
                    <span className="sq-date">{fmtDate(q.createdAt)}</span>
                  </div>
                  <div className="line-cost">${fmtMoney((q.totalCents || 0) / 100)}</div>
                  <div className="line-controls">
                    <button className="btn ghost sq-btn" onClick={() => q.status === 'draft' ? openQuote.mutate({ id: q.id }) : viewQuote.mutate(q.id)} disabled={openQuote.isPending || viewQuote.isPending}>
                      {q.status === 'draft' ? 'Edit draft' : 'View issued quote'}
                    </button>
                    {['sent', 'declined'].includes(q.status) && <button className="btn ghost sq-btn" disabled={reviseQuote.isPending} onClick={() => { if (window.confirm('Create a revised draft? The old offer will close and its issued copy will stay unchanged.')) reviseQuote.mutate(q.id); }}>Revise</button>}
                    {q.leadId && <a className="btn ghost sq-btn" href={`/#/crm/leads?lead=${q.leadId}`}>Open job</a>}
                    {onDuplicate && (
                      <button
                        className="btn ghost sq-btn"
                        title="Start a new quote from this one — same lines and rates, blank customer"
                        onClick={() => openQuote.mutate({ id: q.id, duplicate: true })}
                        disabled={openQuote.isPending}
                      >
                        Duplicate
                      </button>
                    )}
                    <button className="btn ghost sq-btn" onClick={() => setShareId(shareId === q.id ? null : q.id)}>
                      {shareId === q.id ? 'Close' : 'Send'}
                    </button>
                    {q.status === 'draft' && <button
                      className="btn ghost sq-btn"
                      onClick={() => { if (window.confirm(`Delete quote ${q.number}?`)) deleteQuote.mutate(q.id); }}
                      disabled={deleteQuote.isPending}
                    >
                      Delete
                    </button>}
                  </div>
                  {shareId === q.id && <ShareQuote quoteId={q.id} />}
                </div>
              ))}
            </div>
          </div>
        )}
        {data && data.total > 0 && <nav className="quote-pagination" aria-label="Quote pages"><button className="btn ghost sq-btn" disabled={data.page <= 1} onClick={() => setFilters(f => ({...f,page:data.page-1}))}>Previous</button><span>Page {data.page} of {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><button className="btn ghost sq-btn" disabled={data.page * data.pageSize >= data.total} onClick={() => setFilters(f => ({...f,page:data.page+1}))}>Next</button></nav>}
      </div>
    </div>
  );
}
