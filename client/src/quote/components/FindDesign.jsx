import { useEffect, useState } from 'react';
import { fetchLeads, normalizeRef } from '../lib/leads.js';
import { parseLead } from '../lib/designSpec.js';
import { typeLabel } from '../data/configurators.js';
import Preview from './Preview.jsx';

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function LeadCard({ lead, onStart }) {
  const parsed = parseLead(lead);
  const contactBits = [
    lead.phone, lead.email,
    lead.contact && `prefers ${lead.contact.toLowerCase()}`,
    lead.bestTime && `best time: ${lead.bestTime.toLowerCase()}`,
  ].filter(Boolean);

  return (
    <article className="lead-card">
      <div className="lead-head">
        <div>
          {lead.ref
            ? <span className="lead-ref">{lead.ref}</span>
            : <span className="lead-ref none">No design code</span>}
          <span className="lead-service">{lead.service}{lead.type === 'alert' ? ' · delivery-alert copy' : ''}</span>
        </div>
        <span className="lead-time">{fmtTime(lead.time)}</span>
      </div>

      <div className="lead-body">
        <div className="lead-info">
          <div className="lead-customer">{lead.name || '—'}</div>
          {contactBits.length > 0 && <div className="lead-contact">{contactBits.join(' · ')}</div>}
          {lead.location && <div className="lead-contact">{lead.location}</div>}
          {lead.type === 'alert' && lead.reason && (
            <div className="lead-warn">⚠ The website couldn't email this lead ({lead.reason}) — this row is its backup copy.</div>
          )}
          {lead.designSpec && <pre className="lead-spec">{lead.designSpec}</pre>}
          {lead.notes && (
            <div className="lead-notes"><span>Notes</span>{lead.notes}</div>
          )}
          {parsed && parsed.warnings.length > 0 && (
            <div className="lead-warn">
              {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </div>

        {parsed && parsed.hasSpec && (
          <div className="lead-preview">
            <Preview type={parsed.type} state={parsed.state} />
          </div>
        )}
      </div>

      {parsed ? (
        <button className="btn block" onClick={() => onStart(lead, parsed)}>
          Start {typeLabel(parsed.type).toLowerCase()} quote from this {parsed.hasSpec ? 'design' : 'lead'} <span aria-hidden="true">→</span>
        </button>
      ) : (
        <p className="hint">No configurator design on this lead — start a new quote and copy what you need.</p>
      )}
    </article>
  );
}

/**
 * Find design — look up a customer's design code (from the website configurator,
 * e.g. CJM-F7K2) and spin their exact design into a quote. Reads the suite's
 * own web_designs table — the same rows the website submits leads into.
 */
export default function FindDesign({ onStartQuote }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leads, setLeads] = useState(null); // null = nothing loaded yet
  const [heading, setHeading] = useState('');

  // An 'alert' row is a backup copy of a lead whose email failed — when its
  // lead twin is also in the results, showing both just looks like a duplicate
  // customer. Keep the real lead; keep alerts only when they're the sole record.
  const dedupeAlertTwins = (rows) => {
    const key = (l) => [l.ref, l.name, l.phone, l.designSpec].join('|');
    const leadKeys = new Set(rows.filter((l) => l.type !== 'alert').map(key));
    return rows.filter((l) => l.type !== 'alert' || !leadKeys.has(key(l)));
  };

  const run = async (opts, label) => {
    if (busy) return; // Enter key and buttons share this path — one flight at a time
    setBusy(true);
    setError('');
    try {
      const rows = await fetchLeads(opts);
      setLeads(dedupeAlertTwins(rows));
      setHeading(label);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const search = () => {
    if (busy) return;
    const ref = normalizeRef(query);
    if (!ref) { setError('Type the design code from the customer — e.g. CJM-F7K2.'); return; }
    setQuery(ref);
    run({ ref }, `Results for ${ref}`);
  };

  const showRecent = () => run({ recent: 25 }, 'Latest website leads');

  // The most common visit is "who wrote in?" — load the recent list right away.
  useEffect(() => { showRecent(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <p className="eyebrow">— Find design</p>
          <h1 className="display" style={{ marginTop: 14 }}>Look up a design code</h1>
          <p className="home-lede" style={{ marginTop: 18 }}>
            Every design a customer builds on the website gets a code like <b>CJM-F7K2</b> —
            it's on their confirmation email and they'll read it to you on the phone.
            Punch it in to see exactly what they designed and quote it.
          </p>
        </div>

        <div className="find-bar">
          <input
            className="find-input"
            placeholder="CJM-F7K2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
            spellCheck={false}
            autoFocus
          />
          <button className="btn" onClick={search} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          <button className="btn ghost" onClick={showRecent} disabled={busy}>Latest leads</button>
        </div>

        {error && <p className="find-error">{error}</p>}

        {leads && !error && (
          <>
            <p className="section-title" style={{ marginTop: 40 }}>{heading} — {leads.length} {leads.length === 1 ? 'lead' : 'leads'}</p>
            {leads.length === 0 && (
              <p className="hint">
                Nothing found. Codes are only saved when the customer submits the quote form —
                if they only called or texted, check the text message for the full design.
              </p>
            )}
            <div className="lead-list">
              {leads.map((lead, i) => (
                <LeadCard key={`${lead.ref}-${lead.time}-${i}`} lead={lead} onStart={onStartQuote} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
