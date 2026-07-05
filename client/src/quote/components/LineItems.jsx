import { fmtMoney, round2 } from '../lib/format.js';
import { lineCost } from '../lib/estimate.js';

// Field labels per generic item kind.
const KIND_FIELDS = {
  area:   { qty: 'Area', qtyUnit: 'sq ft', rate: 'Rate', rateUnit: '$/sq ft' },
  unit:   { qty: 'Qty', qtyUnit: '', rate: 'Unit', rateUnit: '$/ea' },
  length: { qty: 'Length', qtyUnit: 'ft', rate: 'Rate', rateUnit: '$/ft' },
  flat:   null,
};

function Num({ value, onChange, ...rest }) {
  return (
    <input
      type="number"
      className="cell"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}

function ItemRow({ item, onEdit }) {
  const fields = KIND_FIELDS[item.kind];
  const flags = [item.edited && 'edited', item.unpriced && 'unpriced'].filter(Boolean).join(' ');
  return (
    <div className={`line${flags ? ' ' + flags : ''}`}>
      <div className="line-name">
        <span className="dot" />{item.name}
        {item.unpriced && <span className="line-warn" title="A rate driving this line isn't set in the Price Book — open it and fill in the missing rate.">⚠ unset rate</span>}
      </div>
      <div className="line-cost">${fmtMoney(lineCost(item))}</div>
      <div className="line-controls">
        {item.kind === 'flat' ? (
          <span className="line-field">
            <label>Amount $</label>
            <Num value={item.rate} min="0" step="1" onChange={(v) => onEdit(item.key, 'rate', v)} />
          </span>
        ) : (
          <>
            <span className="line-field">
              <label>{fields.qty}{fields.qtyUnit ? ` (${fields.qtyUnit})` : ''}</label>
              <Num value={item.qty} min="0" step="0.1" onChange={(v) => onEdit(item.key, 'qty', v)} />
            </span>
            <span className="line-field">
              <label>{fields.rate} ({fields.rateUnit})</label>
              <Num value={item.rate} min="0" step="0.1" onChange={(v) => onEdit(item.key, 'rate', v)} />
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function LineItems({
  lineState, totals, materialMarkupPct, laborMarkupPct, taxPct, deliveryMiles, deliveryRate,
  onEditItem, onEditLabor, onReset,
  onChangeMaterialMarkup, onChangeLaborMarkup, onChangeTax,
  onChangeDeliveryMiles, onChangeDeliveryRate,
}) {
  const { items, labor } = lineState;
  const edited = items.some((it) => it.edited) || labor.edited;
  const unpricedCount = items.filter((it) => it.unpriced).length;
  const laborCost = (Number(labor.hours) || 0) * (Number(labor.rate) || 0);
  const deliveryCost = (Number(deliveryMiles) || 0) * (Number(deliveryRate) || 0);
  const rawCost = round2(totals.subtotal - totals.totalMarkup);

  return (
    <div className="estimate">
      <div className="estimate-head">
        <span className="eyebrow">Estimate — itemized</span>
        <button className="estimate-reset" onClick={onReset} disabled={!edited}>
          Reset to price book
        </button>
      </div>

      {unpricedCount > 0 && (
        <div className="estimate-warn">
          ⚠ {unpricedCount === 1 ? '1 line has' : `${unpricedCount} lines have`} a rate that isn't set in the Price Book —
          {' '}some options aren't moving the price yet.
        </div>
      )}

      <div className="lines">
        {items.map((item) => (
          <ItemRow key={item.key} item={item} onEdit={onEditItem} />
        ))}

        {/* Labor & fabrication */}
        <div className={`line${labor.edited ? ' edited' : ''}`}>
          <div className="line-name"><span className="dot" />Labor &amp; fabrication</div>
          <div className="line-cost">${fmtMoney(laborCost)}</div>
          <div className="line-controls">
            <span className="line-field">
              <label>Hours</label>
              <Num value={labor.hours} min="0" step="0.5" onChange={(v) => onEditLabor('hours', v)} />
            </span>
            <span className="line-field">
              <label>Rate ($/hr)</label>
              <Num value={labor.rate} min="0" step="1" onChange={(v) => onEditLabor('rate', v)} />
            </span>
          </div>
        </div>

        {/* Delivery — billed at cost (no markup) */}
        <div className="line">
          <div className="line-name"><span className="dot" />Delivery</div>
          <div className="line-cost">${fmtMoney(deliveryCost)}</div>
          <div className="line-controls">
            <span className="line-field">
              <label>Miles</label>
              <Num value={deliveryMiles} min="0" step="1" onChange={(v) => onChangeDeliveryMiles(v)} />
            </span>
            <span className="line-field">
              <label>Rate ($/mi)</label>
              <Num value={deliveryRate} min="0" step="0.5" onChange={(v) => onChangeDeliveryRate(v)} />
            </span>
          </div>
        </div>
      </div>

      <div className="markup-tax">
        <span className="mt-field">
          <label>Material markup %</label>
          <Num value={materialMarkupPct} min="0" step="1" onChange={(v) => onChangeMaterialMarkup(v)} />
        </span>
        <span className="mt-field">
          <label>Labor markup %</label>
          <Num value={laborMarkupPct} min="0" step="1" onChange={(v) => onChangeLaborMarkup(v)} />
        </span>
        <span className="mt-field">
          <label>Sales tax %</label>
          <Num value={taxPct} min="0" step="0.01" onChange={(v) => onChangeTax(v)} />
        </span>
      </div>

      <div className="totals">
        <div className="totals-row"><span className="k">Cost basis</span><span className="v">${fmtMoney(rawCost)}</span></div>
        <div className="totals-row"><span className="k">Markup</span><span className="v">${fmtMoney(totals.totalMarkup)}</span></div>
        <div className="totals-row sub"><span className="k">Subtotal</span><span className="v">${fmtMoney(totals.subtotal)}</span></div>
        <div className="totals-row"><span className="k">Tax ({taxPct || 0}%)</span><span className="v">${fmtMoney(totals.tax)}</span></div>
        <div className="totals-row grand"><span className="k">Total</span><span className="v">${fmtMoney(totals.total)}</span></div>
      </div>
    </div>
  );
}
