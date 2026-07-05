import { TYPES } from '../data/configurators.js';

const ICONS = {
  fence: (
    <svg viewBox="0 0 320 180" className="art" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="30" y1="20" x2="30" y2="170" /><line x1="125" y1="20" x2="125" y2="170" />
      <line x1="220" y1="20" x2="220" y2="170" /><line x1="290" y1="20" x2="290" y2="170" />
      {[40, 60, 80, 100, 120, 140].map((y) => (
        <g key={y}>
          <line x1="30" y1={y} x2="125" y2={y} /><line x1="125" y1={y} x2="220" y2={y} /><line x1="220" y1={y} x2="290" y2={y} />
        </g>
      ))}
    </svg>
  ),
  gate: (
    <svg viewBox="0 0 320 180" className="art" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="60" y="20" width="200" height="150" />
      {[40, 58, 76, 94, 112, 130, 148].map((y) => <line key={y} x1="60" y1={y} x2="260" y2={y} />)}
      <circle cx="60" cy="55" r="3" /><circle cx="60" cy="135" r="3" /><circle cx="260" cy="95" r="3" />
    </svg>
  ),
  carport: (
    <svg viewBox="0 0 320 180" className="art" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M50 95 L150 52 L250 95" />
      <path d="M92 73 L192 30 L292 73" strokeOpacity="0.55" />
      <path d="M150 52 L192 30" /><path d="M50 95 L92 73" strokeOpacity="0.55" /><path d="M250 95 L292 73" strokeOpacity="0.55" />
      <path d="M50 95 V160" /><path d="M250 95 V160" />
      <path d="M92 73 V148" strokeOpacity="0.4" /><path d="M292 73 V148" strokeOpacity="0.4" />
      <path d="M38 160 H300" strokeOpacity="0.25" />
    </svg>
  ),
  railing: (
    <svg viewBox="0 0 320 180" className="art" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="30" y1="40" x2="290" y2="40" strokeWidth="4" />
      <line x1="30" y1="150" x2="290" y2="150" />
      <line x1="36" y1="40" x2="36" y2="164" strokeWidth="3" /><line x1="284" y1="40" x2="284" y2="164" strokeWidth="3" />
      {[66, 92, 118, 144, 170, 196, 222, 248].map((x) => <line key={x} x1={x} y1="46" x2={x} y2="150" />)}
      <line x1="20" y1="164" x2="300" y2="164" strokeOpacity="0.25" />
    </svg>
  ),
};

export default function Home({ onPick, onFind }) {
  return (
    <div className="page">
      <div className="container">
        <div className="page-head" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginBottom: 56 }}>
          <div>
            <p className="eyebrow">— New quote</p>
            <h1 className="display" style={{ marginTop: 14 }}>Build it. Price it. Send it.</h1>
          </div>
          <p className="home-lede">
            Pick a build, configure it exactly like the customer would on the site, and a priced,
            itemized quote falls out — every number editable.
            {onFind && (
              <>
                {' '}Customer has a design code from the website?{' '}
                <button className="home-find-link" onClick={onFind}>Look it up →</button>
              </>
            )}
          </p>
        </div>

        <div className="type-grid">
          {TYPES.map((t, i) => (
            <button key={t.key} className="type-card" onClick={() => onPick(t.key)}>
              <div className="idx">
                <span>{String(i + 1).padStart(2, '0')}</span>
                <span className="bar" />
              </div>
              {ICONS[t.key]}
              <div>
                <h2 className="display">{t.label}</h2>
                <p>{t.tagline}</p>
                <span className="go">Start designing →</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
