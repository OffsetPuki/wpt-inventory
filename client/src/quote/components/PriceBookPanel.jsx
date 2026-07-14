import { DEFAULT_PRICE_BOOK, PRICE_BOOK_SCHEMA, MATERIAL_UNITS } from '../data/priceBook.js';
import { getPath } from '../lib/store.js';

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

/**
 * The shared material library editor. One row per material: cost per unit +
 * waste %. Editing a price here reprices EVERY product that uses the material
 * (fence posts, gate frames, pergola legs...) and the website ballpark.
 */
function MaterialsGroup({ priceBook, onChange }) {
  const ids = Object.keys(DEFAULT_PRICE_BOOK.materials);
  return (
    <div className="pb-group">
      <h3>Materials — shared library</h3>
      <p className="note">
        One price per material, entered once. Every product that uses it — and the
        website ballpark — reprices automatically. Waste % is blended into the rate.
      </p>
      {ids.map((id) => {
        const def = DEFAULT_PRICE_BOOK.materials[id];
        const unit = (MATERIAL_UNITS[def.unit] || {}).suffix || '';
        return (
          <div key={id}>
            <Field
              field={{ path: `materials.${id}.cost`, label: def.name, prefix: '$', suffix: unit, step: 0.25 }}
              value={getPath(priceBook, `materials.${id}.cost`)}
              onChange={onChange}
            />
            <Field
              field={{ path: `materials.${id}.wastePct`, label: '↳ waste', suffix: '%', step: 1 }}
              value={getPath(priceBook, `materials.${id}.wastePct`)}
              onChange={onChange}
            />
          </div>
        );
      })}
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
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: 32 }}>
          <button className="btn ghost" onClick={onReset}>Reset price book to defaults</button>
        </div>
      </div>
    </div>
  );
}
