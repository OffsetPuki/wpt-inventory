import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/components/ui/toaster';
import { typeLabel } from '../data/configurators.js';
import { fmtMoney, round2 } from '../lib/format.js';
import { getPath } from '../lib/store.js';

// =============================================================================
//  Costing — quoted vs actual, per accepted job. Turns every finished job into
//  calibration data for the price book: if fences keep running 18% over quoted
//  labor, the labor-hour rates are wrong — fix the book, not the next quote.
//
//  Quoted side: re-derived from the stored session against its snapshot book.
//  Actual side: Finance expenses (category "materials" split out) + PM time
//  entries × HR pay rate — the same math as the project finances card.
// =============================================================================

// The per-type labor-hour fields a suggestion scales, all at once.
const LABOR_FIELDS = {
  fence: ['fence.laborHoursPerFt', 'fence.installHoursPerFt'],
  gate: [
    'gate.laborHours.single', 'gate.laborHours.double', 'gate.laborHours.slide',
    'gate.installHours.single', 'gate.installHours.double', 'gate.installHours.slide',
  ],
  carport: ['carport.laborHoursPer100SqFt', 'carport.installHoursPer100SqFt'],
  pergola: ['pergola.laborHoursPer100SqFt', 'pergola.installHoursPer100SqFt'],
  railing: ['railing.laborHoursPerFt', 'railing.installHoursPerFt'],
};

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** +18% red / −5% green variance chip. null when either side is missing. */
function Variance({ quoted, actual }) {
  if (!(quoted > 0) || actual == null) return <span style={{ opacity: 0.5 }}>—</span>;
  const pct = Math.round((actual / quoted - 1) * 100);
  const over = pct > 0;
  const color = Math.abs(pct) <= 5 ? 'inherit' : over ? '#d24d3e' : '#3e9e5c';
  return <span style={{ color, fontWeight: 600 }}>{over ? '+' : ''}{pct}%</span>;
}

function Row({ r }) {
  const actualHours = r.actual ? round2(r.actual.laborMinutes / 60) : null;
  const quotedHours = round2((r.quoted.shopHours || 0) + (r.quoted.installHours || 0));
  return (
    <div className="line">
      <div className="line-name">
        <span className="sq-number">{r.number}</span>
        <span className="sq-meta">
          {typeLabel(r.type)}{r.customerName ? ` · ${r.customerName}` : ''}
          {r.projectStatus ? ` · job ${r.projectStatus}` : ' · no job linked'}
        </span>
      </div>
      <div className="line-controls" style={{ gap: 18, flexWrap: 'wrap' }}>
        <span className="line-field">
          <label>Materials — quoted / actual</label>
          <span>
            ${fmtMoney(r.quoted.materialCents / 100)}
            {' / '}
            {r.actual ? `$${fmtMoney(r.actual.materialCents / 100)} ` : '— '}
            <Variance quoted={r.quoted.materialCents} actual={r.actual?.materialCents ?? null} />
          </span>
        </span>
        <span className="line-field">
          <label>Labor hrs — quoted / actual</label>
          <span>
            {quotedHours}
            {' / '}
            {actualHours != null ? `${actualHours} ` : '— '}
            <Variance quoted={quotedHours} actual={actualHours} />
          </span>
        </span>
        <span className="line-field">
          <label>Labor $ — quoted / actual</label>
          <span>
            ${fmtMoney(r.quoted.laborCents / 100)}
            {' / '}
            {r.actual ? `$${fmtMoney(r.actual.laborCostCents / 100)} ` : '— '}
            <Variance quoted={r.quoted.laborCents} actual={r.actual?.laborCostCents ?? null} />
          </span>
        </span>
      </div>
    </div>
  );
}

export default function Costing({ priceBook, onChangePriceBook }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['quote-costing'],
    queryFn: async () => (await apiRequest('GET', '/api/quotes/costing')).json(),
  });
  const rows = data?.rows || [];

  // Suggestions come ONLY from finished jobs with real actuals — a job still
  // in progress would read as "under budget" and corrupt the calibration.
  const suggestions = useMemo(() => {
    const byType = new Map();
    for (const r of rows) {
      if (r.projectStatus !== 'done' || !r.actual) continue;
      const quotedHours = (r.quoted.shopHours || 0) + (r.quoted.installHours || 0);
      const cur = byType.get(r.type) || { laborRatios: [], materialRatios: [] };
      if (quotedHours > 0 && r.actual.laborMinutes > 0) {
        cur.laborRatios.push((r.actual.laborMinutes / 60) / quotedHours);
      }
      if (r.quoted.materialCents > 0 && r.actual.materialCents > 0) {
        cur.materialRatios.push(r.actual.materialCents / r.quoted.materialCents);
      }
      byType.set(r.type, cur);
    }
    const out = [];
    for (const [type, { laborRatios, materialRatios }] of byType) {
      const labor = median(laborRatios);
      const material = median(materialRatios);
      if (labor != null && Math.abs(labor - 1) >= 0.1) {
        out.push({ type, kind: 'labor', ratio: labor, n: laborRatios.length });
      }
      if (material != null && Math.abs(material - 1) >= 0.1) {
        out.push({ type, kind: 'material', ratio: material, n: materialRatios.length });
      }
    }
    return out;
  }, [rows]);

  const applyLabor = (type, ratio) => {
    const paths = LABOR_FIELDS[type] || [];
    let changed = 0;
    for (const path of paths) {
      const cur = Number(getPath(priceBook, path));
      if (!Number.isFinite(cur) || cur <= 0) continue;
      onChangePriceBook(path, round2(cur * ratio));
      changed++;
    }
    toast({
      variant: 'success',
      title: `${typeLabel(type)} labor recalibrated`,
      description: `${changed} labor-hour rates scaled ×${round2(ratio)} in the price book.`,
    });
  };

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <p className="eyebrow">— Costing</p>
          <h1 className="display" style={{ marginTop: 14 }}>Quoted vs actual</h1>
          <p className="home-lede" style={{ marginTop: 18 }}>
            Every finished job is calibration data. If a product keeps running over the
            quote, fix the price book — not the next customer.
          </p>
        </div>

        {isLoading && <p className="hint">Loading costing data…</p>}
        {error && (
          <p className="find-error">
            {String(error.message || '').includes('403')
              ? 'Costing needs an elevated login — it exposes real labor costs.'
              : error.message || 'Could not load costing data.'}
          </p>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <p className="hint">
            No accepted quotes yet. Once quotes are accepted (and their jobs get time
            logs + expenses), the comparison shows up here.
          </p>
        )}

        {suggestions.length > 0 && (
          <div className="estimate" style={{ marginBottom: 18 }}>
            <div className="estimate-head"><span className="eyebrow">Price book suggestions (from finished jobs)</span></div>
            <div className="lines">
              {suggestions.map((s, i) => (
                <div key={i} className="line">
                  <div className="line-name">
                    <span className="dot" />
                    {typeLabel(s.type)} {s.kind === 'labor' ? 'labor' : 'materials'} run{' '}
                    <b>{s.ratio > 1 ? '+' : ''}{Math.round((s.ratio - 1) * 100)}%</b> vs quoted
                    (median of {s.n} finished {s.n === 1 ? 'job' : 'jobs'})
                  </div>
                  <div className="line-controls">
                    {s.kind === 'labor' ? (
                      <button className="btn ghost sq-btn" onClick={() => applyLabor(s.type, s.ratio)}>
                        Apply ×{round2(s.ratio)} to {typeLabel(s.type)} labor hours
                      </button>
                    ) : (
                      <span className="hint">
                        Check supplier prices / waste % in the Materials library — auto-apply is
                        deliberately off for materials (price vs quantity is your call).
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="estimate">
            <div className="estimate-head">
              <span className="eyebrow">{rows.length} accepted {rows.length === 1 ? 'quote' : 'quotes'}</span>
            </div>
            <div className="lines">
              {rows.map((r) => <Row key={r.quoteId} r={r} />)}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Actuals need the shop habits: log time against the job (PM → Time) and log
              expenses with category <b>materials</b> + the job picked. Jobs marked{' '}
              <b>done</b> feed the suggestions above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
