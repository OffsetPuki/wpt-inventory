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

function ItemRow({ item, onEdit, onRemove }) {
  const fields = KIND_FIELDS[item.kind];
  const flags = [item.edited && 'edited', item.unpriced && 'unpriced'].filter(Boolean).join(' ');
  return (
    <div className={`line${flags ? ' ' + flags : ''}`}>
      <div className="line-name">
        <span className="dot" />{item.name}
        {item.unpriced && <span className="line-warn" title="A rate driving this line isn't set in the Price Book — open it and fill in the missing rate.">⚠ unset rate</span>}
        {item.custom && onRemove && (
          <button
            type="button"
            className="estimate-reset"
            style={{ marginLeft: 8 }}
            title="Remove this custom line"
            onClick={() => onRemove(item.key)}
          >
            ✕
          </button>
        )}
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

/** Hours × rate row shared by shop labor and installation. */
function HoursRow({ title, data, onEdit }) {
  const cost = (Number(data.hours) || 0) * (Number(data.rate) || 0);
  return (
    <div className={`line${data.edited ? ' edited' : ''}`}>
      <div className="line-name"><span className="dot" />{title}</div>
      <div className="line-cost">${fmtMoney(cost)}</div>
      <div className="line-controls">
        <span className="line-field">
          <label>Hours</label>
          <Num value={data.hours} min="0" step="0.5" onChange={(v) => onEdit('hours', v)} />
        </span>
        <span className="line-field">
          <label>Rate ($/hr)</label>
          <Num value={data.rate} min="0" step="1" onChange={(v) => onEdit('rate', v)} />
        </span>
      </div>
    </div>
  );
}

export default function LineItems({
  lineState, totals, warnings, materialsSummary, priceLockAt,
  materialMarkupPct, laborMarkupPct, taxPct, discountPct, deliveryMiles, deliveryRate,
  onEditItem, onEditLabor, onEditInstall, onAddCustomLine, onRemoveCustomLine,
  onUnlockPrices, onReset,
  onChangeMaterialMarkup, onChangeLaborMarkup, onChangeTax, onChangeDiscount,
  onChangeDeliveryMiles, onChangeDeliveryRate,
}) {
  const { items, labor, install } = lineState;
  const edited = items.some((it) => it.edited) || labor.edited || (install && install.edited);
  const unpricedCount = items.filter((it) => it.unpriced).length;
  const deliveryCost = (Number(deliveryMiles) || 0) * (Number(deliveryRate) || 0);
  const rawCost = round2(totals.subtotal - totals.totalMarkup);
  const warnList = warnings || [];

  const addCustom = () => {
    const name = window.prompt('Name for the custom line (e.g. "Core drilling — 4 holes"):');
    if (name && name.trim()) onAddCustomLine(name.trim());
  };

  return (
    <div className="estimate">
      <div className="estimate-head">
        <span className="eyebrow">Estimate — itemized</span>
        <span>
          <button className="estimate-reset" onClick={addCustom} style={{ marginRight: 8 }}>
            + Add line
          </button>
          <button className="estimate-reset" onClick={onReset} disabled={!edited}>
            Reset to price book
          </button>
        </span>
      </div>

      {priceLockAt && (
        <div className="estimate-warn" style={{ background: 'rgba(90,130,255,0.08)' }}>
          🔒 Prices locked to the rate book from {new Date(priceLockAt).toLocaleDateString()} —
          rate changes don't move this quote.
          {' '}
          <button className="estimate-reset" onClick={onUnlockPrices}>Use today's rates</button>
        </div>
      )}

      {unpricedCount > 0 && (
        <div className="estimate-warn">
          ⚠ {unpricedCount === 1 ? '1 line has' : `${unpricedCount} lines have`} a rate that isn't set in the Price Book —
          {' '}some options aren't moving the price yet.
        </div>
      )}

      <div className="lines">
        {items.map((item) => (
          <ItemRow key={item.key} item={item} onEdit={onEditItem} onRemove={onRemoveCustomLine} />
        ))}

        {/* Shop fabrication */}
        <HoursRow title="Shop labor & fabrication" data={labor} onEdit={onEditLabor} />

        {/* On-site installation */}
        {install && <HoursRow title="Installation (on-site)" data={install} onEdit={onEditInstall} />}

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

      {/* Shop materials summary — what to actually buy, per shared material. */}
      {materialsSummary && materialsSummary.length > 0 && (
        <div className="lines" style={{ marginTop: 10 }}>
          <div className="estimate-head"><span className="eyebrow">Materials to buy (incl. waste)</span></div>
          {materialsSummary.map((m) => (
            <div key={m.id} className="line">
              <div className="line-name"><span className="dot" />{m.name}</div>
              <div className="line-cost">{m.qty} {m.unit}</div>
            </div>
          ))}
        </div>
      )}

      {/* Did-you-forget checklist */}
      {warnList.length > 0 && (
        <div className="lines" style={{ marginTop: 10 }}>
          <div className="estimate-head"><span className="eyebrow">Did you forget?</span></div>
          {warnList.map((w, i) => (
            <div key={i} className={w.level === 'warn' ? 'estimate-warn' : 'estimate-warn'}
              style={w.level === 'info' ? { opacity: 0.75 } : undefined}>
              {w.level === 'warn' ? '⚠' : '☐'} {w.msg}
            </div>
          ))}
        </div>
      )}

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
          <label>Discount %</label>
          <Num value={discountPct} min="0" max="100" step="1" onChange={(v) => onChangeDiscount(v)} />
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
        {totals.discountAmt > 0 && (
          <div className="totals-row"><span className="k">Discount ({totals.discountPct}%)</span><span className="v">−${fmtMoney(totals.discountAmt)}</span></div>
        )}
        <div className="totals-row"><span className="k">Tax ({taxPct || 0}%)</span><span className="v">${fmtMoney(totals.tax)}</span></div>
        {totals.minAdjustment > 0 && (
          <div className="totals-row"><span className="k">Minimum job charge</span><span className="v">+${fmtMoney(totals.minAdjustment)}</span></div>
        )}
        <div className="totals-row grand"><span className="k">Total</span><span className="v">${fmtMoney(totals.total)}</span></div>
      </div>
    </div>
  );
}
