import { useState } from 'react';
import { DEFAULT_PRICE_BOOK, PRICE_BOOK_SCHEMA, MATERIAL_UNITS } from '../data/priceBook.js';
import { materialLibrary, materialShelves, matRate } from '../lib/estimate.js';
import { fmtMoney } from '../lib/format.js';
import { DEFAULT_SHOP, getPath } from '../lib/store.js';

/** The one number input every rate in this panel is typed into. */
function NumInput({ path, value, onChange, step = 0.5, width }) {
  return (
    <input
      type="number"
      className="pb-input"
      min="0"
      step={step}
      style={width ? { width } : undefined}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        const n = raw === '' ? 0 : Number(raw);
        if (Number.isNaN(n)) return;
        onChange(path, n);
      }}
    />
  );
}

function Field({ field, value, onChange }) {
  return (
    <div className="pb-field">
      <span className="pb-label">{field.label}</span>
      <span className="pb-input-wrap">
        {field.prefix && <span className="aff">{field.prefix}</span>}
        <NumInput path={field.path} value={value} onChange={onChange} step={field.step || 0.5} />
        {field.suffix && <span className="aff">{field.suffix}</span>}
      </span>
    </div>
  );
}

const STALE_MS = 90 * 24 * 60 * 60 * 1000;

/** "seed price" / "updated N days ago" freshness tag for a material. */
function Freshness({ updatedAt }) {
  const at = Number(updatedAt) || null;
  if (at == null) return <span className="pb-mat-age stale">⚠ seed price — set yours</span>;
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  const stale = Date.now() - at > STALE_MS;
  return (
    <span className={`pb-mat-age${stale ? ' stale' : ''}`}>
      {stale ? '⚠ ' : ''}updated {days === 0 ? 'today' : `${days}d ago`}
    </span>
  );
}

/**
 * The shared material library editor. One row per material: cost per unit +
 * waste %. Editing a price here reprices EVERY product that uses the material
 * (fence posts, gate frames, pergola legs...) and the website ballpark.
 * Editing a cost stamps `updatedAt` (via QuoteBuilder.updatePriceBook) — that
 * drives the freshness tags and the server's stale-price reminder task.
 */
function MaterialsGroup({ priceBook, onChange, readOnly }) {
  const materials = priceBook.materials || {};
  const removed = Array.isArray(priceBook.removedMaterials) ? priceBook.removedMaterials : [];
  const visible = materialLibrary(priceBook);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('ft');
  const [cost, setCost] = useState('');

  // Shelved by the unit the material is bought in — the same grouping the
  // quote's "+ Add line" picker uses, so a material sits in the same place in
  // both lists. The search box just narrows what gets shelved.
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? visible.filter((id) => `${(materials[id] || {}).name || ''} ${id}`.toLowerCase().includes(needle))
    : visible;
  const shelves = materialShelves(priceBook, matches);

  const addMaterial = (e) => {
    e.preventDefault();
    const label = name.trim();
    if (!label) return;
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'material';
    let id = base;
    for (let i = 2; materials[id]; i++) id = `${base}_${i}`;
    onChange('materials', {
      ...materials,
      [id]: { name: label, unit, cost: Number(cost) || 0, wastePct: 10, updatedAt: Date.now() },
    });
    setName(''); setCost('');
  };

  // A material you added is deleted outright. A built-in one is tombstoned
  // instead — the defaults would merge it straight back — so it can be put
  // back, and any product formula still using it prices at $0 and says so.
  const removeMaterial = (id) => {
    const builtIn = !!DEFAULT_PRICE_BOOK.materials[id];
    const warn = builtIn
      ? `Delete "${materials[id].name}"?\n\nAny product priced with it (posts, frames, roofs...) will show $0 and flag an unset rate until you put it back.`
      : `Delete "${materials[id].name}" from the material library?`;
    if (!window.confirm(warn)) return;
    if (builtIn) {
      onChange('removedMaterials', [...removed, id]);
    } else {
      const next = { ...materials };
      delete next[id];
      onChange('materials', next);
    }
  };
  const restoreMaterial = (id) => onChange('removedMaterials', removed.filter((r) => r !== id));

  return (
    <div className="pb-group pb-group-wide">
      <div className="pb-mat-head">
        <div>
          <h3>Materials — shared library</h3>
          <p className="note" style={{ marginBottom: 0 }}>
            One price per material, entered once. Every product that uses it — and the
            website ballpark — reprices automatically. Waste % is blended into the rate
            you quote at. Add your own here; they show up in the quote's "+ Add line" picker.
          </p>
        </div>
        {/* Not rendered for workers: the whole panel sits inside a disabled
            fieldset, and a search box they can't type in reads as broken. */}
        {!readOnly && (
          <label className="pb-mat-search">
            <span className="pb-mat-cap">Find</span>
            <input
              className="pb-input"
              type="search"
              placeholder="tubing, mesh, hardware…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>

      {shelves.length === 0 && (
        <p className="note" style={{ margin: '18px 0 0' }}>
          Nothing matches “{query}”. {visible.length} material{visible.length === 1 ? '' : 's'} in the library.
        </p>
      )}

      {shelves.map(([u, ids]) => (
        <div key={u} className="pb-shelf">
          <div className="pb-shelf-head">
            <span className="pb-mat-cap">{MATERIAL_UNITS[u].group}</span>
            <span className="pb-mat-cap">{ids.length}</span>
          </div>
          {/* Column captions once per shelf, not once per row. */}
          <div className="pb-mat pb-mat-cols">
            <span className="pb-mat-cap">Material</span>
            <span className="pb-mat-cap">You pay</span>
            <span className="pb-mat-cap">Waste</span>
            <span className="pb-mat-cap">Quoted at</span>
            <span />
          </div>
          {ids.map((id) => {
            const def = materials[id];
            const suffix = MATERIAL_UNITS[u].suffix;
            return (
              <div key={id} className="pb-mat">
                <span className="pb-mat-name">
                  {def.name}
                  <Freshness updatedAt={getPath(priceBook, `materials.${id}.updatedAt`)} />
                </span>
                <span className="pb-input-wrap">
                  <span className="aff">$</span>
                  <NumInput
                    path={`materials.${id}.cost`}
                    value={getPath(priceBook, `materials.${id}.cost`)}
                    onChange={onChange}
                    step={0.25}
                    width="4.5rem"
                  />
                  <span className="aff">{suffix}</span>
                </span>
                <span className="pb-input-wrap">
                  <NumInput
                    path={`materials.${id}.wastePct`}
                    value={getPath(priceBook, `materials.${id}.wastePct`)}
                    onChange={onChange}
                    step={1}
                    width="3rem"
                  />
                  <span className="aff">%</span>
                </span>
                {/* What a quote actually charges per unit — cost + waste. The
                    number the owner is really setting, so it is shown, not
                    left to be worked out. */}
                <span className="pb-mat-rate">${fmtMoney(matRate(priceBook, id))} <span className="aff">{suffix}</span></span>
                <button
                  type="button"
                  className="pb-mat-del"
                  title={`Delete ${def.name}`}
                  aria-label={`Delete ${def.name}`}
                  onClick={() => removeMaterial(id)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ))}

      {removed.length > 0 && (
        <div className="pb-shelf">
          <div className="pb-shelf-head">
            <span className="pb-mat-cap">Deleted — not priced on any quote</span>
            <span className="pb-mat-cap">{removed.length}</span>
          </div>
          <div className="pb-chips">
            {removed.map((id) => (
              <button key={id} type="button" className="pb-chip" onClick={() => restoreMaterial(id)}>
                <s>{(materials[id] || {}).name || id}</s> ↩ restore
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="pb-shelf pb-mat-add" onSubmit={addMaterial}>
        <span className="pb-mat-cap">Add a material</span>
        <input
          className="pb-input"
          style={{ width: '15rem', textAlign: 'left' }}
          placeholder="e.g. 3×2 angle iron"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="pb-input" style={{ width: '7.5rem', textAlign: 'left' }} value={unit} onChange={(e) => setUnit(e.target.value)}>
          {Object.keys(MATERIAL_UNITS).map((u) => (
            <option key={u} value={u}>{MATERIAL_UNITS[u].label}</option>
          ))}
        </select>
        <span className="pb-input-wrap">
          <span className="aff">$</span>
          <input
            className="pb-input"
            style={{ width: '4.5rem' }}
            type="number"
            min="0"
            step="0.25"
            placeholder="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </span>
        <button type="submit" className="estimate-reset">+ Add material</button>
      </form>
    </div>
  );
}

export default function PriceBookPanel({ priceBook, onChange, shop, onChangeShop, onReset, readOnly = false }) {
  // Workers can READ the rates — the builder cannot price anything without
  // them — but not change them. This panel auto-saves on a keystroke with no
  // save button, so one nudged markup silently repriced every future quote and
  // every instant estimate on the public website. The server is the real guard;
  // this keeps anyone from typing into a field whose save is discarded.
  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <p className="eyebrow">— Settings</p>
          <h1 className="display" style={{ marginTop: 14 }}>Price book</h1>
          <p className="home-lede" style={{ marginTop: 20 }}>
            Set your rates once. Every quote starts from these numbers — and you can still
            override any line on the quote itself. Material prices live in the shared
            library: change one price, every product that uses it follows.
          </p>
          {readOnly && (
            <p className="note" style={{ marginTop: 14, color: '#d24d3e' }}>
              These are the shop's shared rates — only the owner can change them. You can
              still override any line on an individual quote.
            </p>
          )}
        </div>

      {/* One native disabled fieldset switches off every input, select and
          button inside it — no per-field plumbing, and it survives new fields
          being added below. Unstyled so the layout is unchanged. */}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="pb-grid">
          <MaterialsGroup priceBook={priceBook} onChange={onChange} readOnly={readOnly} />

          {PRICE_BOOK_SCHEMA.map((group) => (
            <div key={group.title} className="pb-group">
              <h3>{group.title}</h3>
              {group.note && <p className="note">{group.note}</p>}
              {group.fields.map((f) => (
                <Field key={f.path} field={f} value={getPath(priceBook, f.path)} onChange={onChange} />
              ))}
            </div>
          ))}

          <div className="pb-group">
            <h3>Shop details</h3>
            <p className="note">Printed at the top of every customer quote.</p>
            {[
              ['name', 'Business name'],
              ['location', 'Location'],
              ['phone', 'Phone'],
              ['email', 'Email'],
            ].map(([key, label]) => (
              <div key={key} className="pb-field">
                <span className="pb-label">{label}</span>
                <input
                  className="pb-input"
                  style={{ width: '11rem', textAlign: 'right' }}
                  value={shop[key] || ''}
                  onChange={(e) => onChangeShop(key, e.target.value)}
                />
              </div>
            ))}

            <div style={{ marginTop: 18 }}>
              <span className="pb-label">Quote terms</span>
              <p className="note" style={{ margin: '4px 0 8px' }}>
                The small print at the foot of every quote — one term per line. Shows on
                the PDF and on the customer&rsquo;s online quote.
              </p>
              <textarea
                className="pb-input"
                style={{ width: '100%', textAlign: 'left', minHeight: '5.5rem', lineHeight: 1.5, resize: 'vertical' }}
                value={shop.terms ?? ''}
                placeholder={DEFAULT_SHOP.terms}
                onChange={(e) => onChangeShop('terms', e.target.value)}
              />
            </div>

            <div style={{ marginTop: 18 }}>
              <span className="pb-label">Invoice terms</span>
              <p className="note" style={{ margin: '4px 0 8px' }}>
                The small print at the foot of every invoice — one term per line. An
                invoice is a bill, not an offer, so these are separate from the quote
                terms above.
              </p>
              <textarea
                className="pb-input"
                style={{ width: '100%', textAlign: 'left', minHeight: '4.5rem', lineHeight: 1.5, resize: 'vertical' }}
                value={shop.invoiceTerms ?? ''}
                placeholder={DEFAULT_SHOP.invoiceTerms}
                onChange={(e) => onChangeShop('invoiceTerms', e.target.value)}
              />
            </div>
          </div>

          <div className="pb-group">
            <h3>Where customers send payment</h3>
            <p className="note">
              Printed on every invoice for anyone paying by bank transfer or ACH — never
              on a quote. Leave the fields blank and the block is left off. Customers
              paying by card, Apple&nbsp;Pay or Google&nbsp;Pay use the Pay button
              instead and never see this.
            </p>
            {[
              ['accountName', 'Account name'],
              ['bankName', 'Bank'],
              ['routing', 'Routing number (ACH)'],
              ['account', 'Account number'],
              ['accountType', 'Account type'],
            ].map(([key, label]) => (
              <div key={key} className="pb-field">
                <span className="pb-label">{label}</span>
                <input
                  className="pb-input"
                  style={{ width: '13rem', textAlign: 'right' }}
                  value={(shop.bank || {})[key] || ''}
                  onChange={(e) => onChangeShop(`bank.${key}`, e.target.value)}
                />
              </div>
            ))}
            <div style={{ marginTop: 14 }}>
              <span className="pb-label">Note about the account name</span>
              <p className="note" style={{ margin: '4px 0 8px' }}>
                Only needed when the account is not in the business&rsquo;s name. Banks
                reject transfers where the name doesn&rsquo;t match, so say plainly whose
                name to enter.
              </p>
              <textarea
                className="pb-input"
                style={{ width: '100%', textAlign: 'left', minHeight: '3.5rem', lineHeight: 1.5, resize: 'vertical' }}
                value={(shop.bank || {}).nameNote || ''}
                placeholder="This account is held individually in the name of …, an owner of CJM Metals LLC. Enter the account name exactly as shown above, not the business name, or your bank may reject the transfer."
                onChange={(e) => onChangeShop('bank.nameNote', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: 32 }}>
          <button className="btn ghost" onClick={onReset}>Reset price book to defaults</button>
        </div>
      </fieldset>
      </div>
    </div>
  );
}
