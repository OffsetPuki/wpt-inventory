import { summaryLine, typeLabel } from '../data/configurators.js';
import { fmtMoney } from '../lib/format.js';
import ShareQuote from './ShareQuote.jsx';

export default function QuoteForm({
  type, state, totals, designRef, customer, notes, depositPct, quoteId,
  onChangeCustomer, onChangeNotes, onChangeDeposit, onBack, onPreview, onPersist,
}) {
  const field = (key, label, props = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={customer[key] || ''} onChange={(e) => onChangeCustomer(key, e.target.value)} {...props} />
    </label>
  );

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <button className="back-link" onClick={onBack}>← Edit design</button>
          <p className="eyebrow" style={{ marginTop: 28 }}>— Customer &amp; quote</p>
          <h1 className="display" style={{ marginTop: 14 }}>Quote details</h1>
        </div>

        <div className="cfg">
          <div className="cfg-controls" style={{ position: 'static' }}>
            <div className="fields two">
              {field('name', 'Customer name', { required: true })}
              {field('company', 'Company (optional)')}
              {field('phone', 'Phone', { type: 'tel' })}
              {field('email', 'Email', { type: 'email' })}
            </div>
            <label className="field">
              <span>Project location</span>
              <input value={customer.location || ''} placeholder="Arlington, TX" onChange={(e) => onChangeCustomer('location', e.target.value)} />
            </label>
            <label className="field">
              <span>Notes for the customer (optional)</span>
              <textarea rows="4" value={notes} onChange={(e) => onChangeNotes(e.target.value)} />
            </label>
            <label className="field" style={{ maxWidth: '12rem' }}>
              <span>Deposit %</span>
              <input type="number" min="0" max="100" step="5" value={depositPct} onChange={(e) => onChangeDeposit(e.target.value)} />
            </label>
          </div>

          <div className="cfg-right">
            <div className="estimate">
              <div className="estimate-head"><span className="eyebrow">Quote recap</span></div>
              <div className="lines">
                <div className="line">
                  <div className="line-name">{typeLabel(type)}</div>
                  <div className="line-cost" style={{ fontSize: '0.85rem', fontFamily: 'inherit', color: 'var(--steel)' }} />
                </div>
                <div className="line" style={{ paddingTop: 4 }}>
                  <div className="line-name muted" style={{ fontSize: '0.85rem' }}>{summaryLine(type, state)}</div>
                  <div className="line-cost" />
                </div>
                {designRef && (
                  <div className="line" style={{ paddingTop: 4 }}>
                    <div className="line-name muted" style={{ fontSize: '0.85rem' }}>Design code: {designRef}</div>
                    <div className="line-cost" />
                  </div>
                )}
              </div>
              <div className="totals">
                <div className="totals-row grand"><span className="k">Total</span><span className="v">${fmtMoney(totals.total)}</span></div>
              </div>
            </div>
            <button className="btn block" onClick={onPreview}>
              Preview &amp; download PDF <span aria-hidden="true">→</span>
            </button>
            <p className="hint">The customer PDF shows priced line items, subtotal, tax and total — never your cost basis or markup.</p>
            {/* quoteId exists once the auto-save returns — that's when there's
                a row for the website link to point at. */}
            {quoteId && (
              <div>
                <p className="section-title">Send to customer</p>
                <ShareQuote quoteId={quoteId} customerEmail={customer.email || ''} onBeforeShare={onPersist} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
