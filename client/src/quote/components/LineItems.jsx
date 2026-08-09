import { useState } from 'react';
import { fmtMoney, round2 } from '../lib/format.js';
import { lineCost, matRate, materialLibrary, MAT_KIND, MAT_QTY_UNIT } from '../lib/estimate.js';

// Field labels per generic item kind.
const KIND_FIELDS = {
  area:   { qty: 'Area', qtyUnit: 'sq ft', rate: 'Rate', rateUnit: '$/sq ft' },
  unit:   { qty: 'Qty', qtyUnit: '', rate: 'Unit', rateUnit: '$/ea' },
  length: { qty: 'Length', qtyUnit: 'ft', rate: 'Rate', rateUnit: '$/ft' },
  flat:   null,
};

// How a hand-added line is measured. Anything but "flat" gets a quantity field
// on the row (length in ft, pieces, sq ft) instead of just a dollar amount.
const KIND_OPTIONS = [
  ['length', 'By the foot'],
  ['unit', 'By the piece'],
  ['area', 'By the square foot'],
  ['flat', 'Flat amount'],
];

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
        <span className="dot" />
        {/* The description is what the CUSTOMER reads on their quote, so it's
            editable on every line — not just the ones you typed yourself. */}
        <input
          className="line-name-input"
          value={item.name}
          title="Rename this line — this is the wording the customer sees"
          onChange={(e) => onEdit(item.key, 'name', e.target.value)}
        />
        {item.unpriced && <span className="line-warn" title="A rate driving this line isn't set in the Price Book — open it and fill in the missing rate.">⚠ unset rate</span>}
        {onRemove && (
          <button
            type="button"
            className="estimate-reset line-remove"
            title={item.custom ? 'Delete this custom line' : 'Take this line off the quote (you can put it back)'}
            onClick={() => onRemove(item)}
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

/**
 * "+ Add line" form. Picking a material from the shared library fills in the
 * name, how it's measured and today's rate (waste blended in) — so an extra
 * length of 3×2 angle iron prices and lands in the buy list like any derived
 * line. Leave the material blank to type a one-off line yourself.
 */
function AddLineForm({ priceBook, onAdd, onCancel }) {
  const materials = (priceBook && priceBook.materials) || {};
  const [name, setName] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [kind, setKind] = useState('length');

  const pickMaterial = (id) => {
    setMaterialId(id);
    const m = materials[id];
    if (!m) return;
    setKind(MAT_KIND[m.unit] || 'unit');
    if (!name.trim()) setName(m.name);
  };

  const submit = (e) => {
    e.preventDefault();
    const m = materials[materialId];
    const label = name.trim() || (m && m.name);
    if (!label) return;
    onAdd({
      name: label,
      kind,
      rate: m ? matRate(priceBook, materialId) : 0,
      ...(m ? { materialId, unit: MAT_QTY_UNIT[m.unit] || '' } : {}),
    });
  };

  return (
    <form className="line" onSubmit={submit}>
      <div className="line-name" style={{ gridColumn: '1 / -1' }}>
        <span className="dot" style={{ opacity: 1 }} />
        <input
          className="cell"
          style={{ width: '18rem' }}
          placeholder='Line description — e.g. "3×2 angle iron — table frame"'
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="line-controls">
        <span className="line-field">
          <label>Material</label>
          <select className="cell" style={{ width: '13rem' }} value={materialId} onChange={(e) => pickMaterial(e.target.value)}>
            <option value="">— none (price it yourself) —</option>
            {materialLibrary(priceBook).map((id) => (
              <option key={id} value={id}>{materials[id].name}</option>
            ))}
          </select>
        </span>
        <span className="line-field">
          <label>Measured</label>
          <select className="cell" style={{ width: '9rem' }} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </span>
        <button type="submit" className="estimate-reset">Add</button>
        <button type="button" className="estimate-reset" onClick={onCancel}>Cancel</button>
      </div>
    </form>
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
  lineState, totals, warnings, materialsSummary, priceLockAt, priceBook,
  materialMarkupPct, laborMarkupPct, taxPct, discountPct, deliveryMiles, deliveryRate,
  onEditItem, onEditLabor, onEditInstall, onAddCustomLine, onRemoveCustomLine, onSetLineRemoved,
  onUnlockPrices, onReset,
  onChangeMaterialMarkup, onChangeLaborMarkup, onChangeTax, onChangeDiscount,
  onChangeDeliveryMiles, onChangeDeliveryRate,
}) {
  const { items, labor, install } = lineState;
  const removedItems = lineState.removedItems || [];
  const edited = items.some((it) => it.edited) || removedItems.length > 0 || labor.edited || (install && install.edited);
  const unpricedCount = items.filter((it) => it.unpriced).length;
  const deliveryCost = (Number(deliveryMiles) || 0) * (Number(deliveryRate) || 0);
  const rawCost = round2(totals.subtotal - totals.totalMarkup);
  const warnList = warnings || [];

  const [adding, setAdding] = useState(false);

  // A custom line is deleted for good; a derived one is struck off and can be
  // put back from the "Taken off this quote" list below.
  const removeLine = (item) => {
    if (item.custom) onRemoveCustomLine(item.key);
    else onSetLineRemoved(item.key, true);
  };

  return (
    <div className="estimate">
      <div className="estimate-head">
        <span className="eyebrow">Estimate — itemized</span>
        <span>
          <button className="estimate-reset" onClick={() => setAdding(true)} style={{ marginRight: 8 }}>
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
          <ItemRow key={item.key} item={item} onEdit={onEditItem} onRemove={removeLine} />
        ))}

        {adding && (
          <AddLineForm
            priceBook={priceBook}
            onAdd={(spec) => { onAddCustomLine(spec); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        )}

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

      {/* Lines struck off this quote — parked here, not lost. */}
      {removedItems.length > 0 && (
        <div className="lines" style={{ marginTop: 10 }}>
          <div className="estimate-head">
            <span className="eyebrow">Taken off this quote</span>
            <button className="estimate-reset" onClick={() => removedItems.forEach((it) => onSetLineRemoved(it.key, false))}>
              Put all back
            </button>
          </div>
          {removedItems.map((item) => (
            <div key={item.key} className="line removed-line">
              <div className="line-name">
                <span className="dot" />{item.name}
                <button
                  type="button"
                  className="estimate-reset line-remove"
                  title="Put this line back on the quote"
                  onClick={() => onSetLineRemoved(item.key, false)}
                >
                  ↩ restore
                </button>
              </div>
              <div className="line-cost">—</div>
            </div>
          ))}
        </div>
      )}

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
