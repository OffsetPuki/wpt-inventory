import { PRICE_BOOK_SCHEMA } from '../data/priceBook.js';
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

export default function PriceBookPanel({ priceBook, onChange, shop, onChangeShop, onReset }) {
  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <p className="eyebrow">— Settings</p>
          <h1 className="display" style={{ marginTop: 14 }}>Price book</h1>
          <p className="home-lede" style={{ marginTop: 20 }}>
            Set your rates once. Every quote starts from these numbers — and you can still
            override any line on the quote itself.
          </p>
        </div>

        <div className="pb-grid">
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
