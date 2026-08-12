import { useState } from 'react';
import { DEFAULT_PRICE_BOOK, PRICE_BOOK_SCHEMA, MATERIAL_UNITS } from '../data/priceBook.js';
import { materialLibrary } from '../lib/estimate.js';
import { DEFAULT_SHOP, getPath } from '../lib/store.js';

function Field({ field, value, onChange }) {
  return (
    <div className="pb-field">
      <span className="pb-label">{field.label}</span>
      <span className="pb-input-wrap">
        {field.prefix && <span className="aff">{field.prefix}</span>}
        <input
          type="number"
          className="pb-input"
          min="0"
          step={field.step || 0.5}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            const n = raw === '' ? 0 : Number(raw);
            if (Number.isNaN(n)) return;
            onChange(field.path, n);
          }}
        />
        {field.suffix && <span className="aff">{field.suffix}</span>}
      </span>
    </div>
  );
}

const STALE_MS = 90 * 24 * 60 * 60 * 1000;

/** "seed price" / "updated N days ago" freshness tag for a material. */
function Freshness({ updatedAt }) {
  const at = Number(updatedAt) || null;
  if (at == null) {
    return <p className="note" style={{ margin: '0 0 6px', color: '#d24d3e' }}>⚠ seed price — set yours</p>;
  }
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  const stale = Date.now() - at > STALE_MS;
  return (
    <p className="note" style={{ margin: '0 0 6px', ...(stale ? { color: '#d24d3e' } : { opacity: 0.6 }) }}>
      {stale ? '⚠ ' : ''}updated {days === 0 ? 'today' : `${days}d ago`}
    </p>
  );
}

/**
 * The shared material library editor. One row per material: cost per unit +
 * waste %. Editing a price here reprices EVERY product that uses the material
 * (fence posts, gate frames, pergola legs...) and the website ballpark.
 * Editing a cost stamps `updatedAt` (via QuoteBuilder.updatePriceBook) — that
 * drives the freshness tags and the server's stale-price reminder task.
 */
function MaterialsGroup({ priceBook, onChange }) {
  const materials = priceBook.materials || {};
  const removed = Array.isArray(priceBook.removedMaterials) ? priceBook.removedMaterials : [];
  const visible = materialLibrary(priceBook);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('ft');
  const [cost, setCost] = useState('');

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
    <div className="pb-group">
      <h3>Materials — shared library</h3>
      <p className="note">
        One price per material, entered once. Every product that uses it — and the
        website ballpark — reprices automatically. Waste % is blended into the rate.
        Add your own here; they show up in the quote's "+ Add line" picker.
      </p>
      {visible.map((id) => {
        const def = materials[id];
        const suffix = (MATERIAL_UNITS[def.unit] || {}).suffix || '';
        return (
          <div key={id}>
            <Field
              field={{ path: `materials.${id}.cost`, label: def.name, prefix: '$', suffix, step: 0.25 }}
              value={getPath(priceBook, `materials.${id}.cost`)}
              onChange={onChange}
            />
            <Freshness updatedAt={getPath(priceBook, `materials.${id}.updatedAt`)} />
            <Field
              field={{ path: `materials.${id}.wastePct`, label: '↳ waste', suffix: '%', step: 1 }}
              value={getPath(priceBook, `materials.${id}.wastePct`)}
              onChange={onChange}
            />
            <button type="button" className="estimate-reset" onClick={() => removeMaterial(id)}>
              ✕ delete material
            </button>
          </div>
        );
      })}

      {removed.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p className="note" style={{ margin: '0 0 6px' }}>Deleted — not priced on any quote:</p>
          {removed.map((id) => (
            <div key={id} className="pb-field">
              <span className="pb-label" style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                {(materials[id] || {}).name || id}
              </span>
              <button type="button" className="estimate-reset" onClick={() => restoreMaterial(id)}>
                ↩ restore
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="pb-field" style={{ flexWrap: 'wrap', gap: 8, paddingTop: 18 }} onSubmit={addMaterial}>
        <input
          className="pb-input"
          style={{ width: '11rem', textAlign: 'left' }}
          placeholder="New material — e.g. 3×2 angle iron"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="pb-input" style={{ width: '6rem', textAlign: 'left' }} value={unit} onChange={(e) => setUnit(e.target.value)}>
          {Object.keys(MATERIAL_UNITS).map((u) => (
            <option key={u} value={u}>{MATERIAL_UNITS[u].suffix}</option>
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

export default function PriceBookPanel({ priceBook, onChange, shop, onChangeShop, onReset }) {
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
        </div>

        <div className="pb-grid">
          <MaterialsGroup priceBook={priceBook} onChange={onChange} />

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
      </div>
    </div>
  );
}
