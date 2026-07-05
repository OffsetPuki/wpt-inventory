import { fmtMoney, round2 } from '../lib/format.js';
import { distributeToTotal } from '../lib/calc.js';
import { lineCost } from '../lib/estimate.js';
import { specRows, summaryLine, typeLabel } from '../data/configurators.js';

/**
 * Customer-facing quote — print / save as PDF. Shows only what the customer pays:
 * shop info, their details, the design, priced line items, and totals. Never the
 * cost basis, markup %, or labor rate.
 */
export default function PrintQuote({ shop, type, state, designRef, customer, notes, depositPct, number, createdAt, lineState, totals }) {
  const items = lineState.items || [];

  // Blend material markup into each line so the parts sum EXACTLY to the material total.
  const weights = items.map((it) => lineCost(it));
  const prices = distributeToTotal(weights, totals.lines.material.total);
  const materialRows = items
    .map((it, i) => ({ name: it.name, price: prices[i] }))
    .filter((r) => r.price > 0);

  const serviceRows = [];
  if (totals.lines.labor.total > 0) serviceRows.push({ name: 'Labor & fabrication', price: totals.lines.labor.total });
  if (totals.lines.delivery.total > 0) serviceRows.push({ name: 'Delivery', price: totals.lines.delivery.total });

  const specs = specRows(type, state);
  const dateStr = new Date(createdAt || Date.now()).toLocaleDateString();
  const pct = Number(depositPct) || 0;
  const depositAmt = pct > 0 ? round2((totals.total * pct) / 100) : 0;
  const balanceAmt = round2(totals.total - depositAmt);

  return (
    <div className="print-view">
      <div className="pq-head">
        <div>
          <div className="pq-shop-name">{shop.name || 'CJM Metalworks'}</div>
          {shop.location && <div className="pq-shop-line">{shop.location}</div>}
          <div className="pq-shop-line">{[shop.phone, shop.email].filter(Boolean).join('  ·  ')}</div>
        </div>
        <div className="pq-titleblock">
          <div className="pq-title">Quote</div>
          <div className="pq-meta">No. {number}</div>
          <div className="pq-meta">{dateStr}</div>
          {designRef && <div className="pq-meta">Design {designRef}</div>}
        </div>
      </div>

      <div className="pq-parties">
        <div>
          <div className="pq-label">Prepared for</div>
          <div className="pq-strong">{customer.name || customer.company || '—'}</div>
          {customer.company && customer.name && <div>{customer.company}</div>}
          {customer.location && <div>{customer.location}</div>}
          {customer.phone && <div>{customer.phone}</div>}
          {customer.email && <div>{customer.email}</div>}
        </div>
        <div>
          <div className="pq-label">Project</div>
          <div className="pq-strong">{typeLabel(type)}</div>
          <div>{summaryLine(type, state)}</div>
          {notes && notes.trim() && <div className="pq-desc">{notes}</div>}
        </div>
      </div>

      {specs.length > 0 && (
        <div className="pq-specs">
          {specs.map((sp, i) => (
            <span key={i} className="pq-spec"><b>{sp.label}:</b> {sp.value}</span>
          ))}
        </div>
      )}

      <table className="pq-items">
        <thead>
          <tr><th>Description</th><th className="amount">Amount</th></tr>
        </thead>
        <tbody>
          {materialRows.length > 0 && <tr className="pq-group"><td colSpan={2}>Materials</td></tr>}
          {materialRows.map((r, i) => (
            <tr key={'m' + i}><td>{r.name}</td><td className="amount">${fmtMoney(r.price)}</td></tr>
          ))}
          {serviceRows.length > 0 && <tr className="pq-group"><td colSpan={2}>Fabrication &amp; install</td></tr>}
          {serviceRows.map((r, i) => (
            <tr key={'s' + i}><td>{r.name}</td><td className="amount">${fmtMoney(r.price)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="pq-tot-label">Subtotal</td><td className="amount">${fmtMoney(totals.subtotal)}</td></tr>
          <tr><td className="pq-tot-label">Tax ({totals.taxPct || 0}%)</td><td className="amount">${fmtMoney(totals.tax)}</td></tr>
          <tr className="total-row"><td>Total</td><td className="amount">${fmtMoney(totals.total)}</td></tr>
          {pct > 0 && (
            <>
              <tr><td className="pq-tot-label">Deposit due ({pct}%)</td><td className="amount">${fmtMoney(depositAmt)}</td></tr>
              <tr><td className="pq-tot-label">Balance on completion</td><td className="amount">${fmtMoney(balanceAmt)}</td></tr>
            </>
          )}
        </tfoot>
      </table>

      <div className="pq-footer">
        <div className="pq-terms">
          <div>Quote valid for 30 days. Final price confirmed after an on-site measure.</div>
          <div>Permit, engineering and HOA approval by others unless itemized above.</div>
        </div>
        <div className="pq-thanks">Thank you for the opportunity to quote your project.</div>
      </div>
    </div>
  );
}
