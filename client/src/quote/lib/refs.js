// =============================================================================
//  Design-code helpers — pure functions split out of leads.js so modules that
//  run under plain node (designSpec.js, scripts/check-quote-trades.mjs) don't
//  drag in the client-only fetch layer ('@/lib/queryClient'). leads.js
//  re-exports both, so client imports are unchanged.
// =============================================================================

// The family's sister-site refs: CJC (concrete), CJI (insulation), CJT (trades
// planner) — always a letter + exactly 4 base36 chars (projectRef in each
// site's estimate.mjs), which is what tells "cjc-d7k2q" (a concrete ref) apart
// from "cjc2k" (a metals carport body starting with C).
const SISTER_BODY = /^(CJC|CJI|CJT)([A-Z][A-Z0-9]{4})$/;

/**
 * Normalize whatever the owner types OR pastes into a canonical design code:
 *   "f7k2", "CJM F7K2", "cjm-f7k2"            → "CJM-F7K2"
 *   "[DESIGN CJM-F7K2] New quote request …"    → "CJM-F7K2"   (email subject)
 *   "Diseño CJM-F7K2" / "Design CJM-F7K2"      → "CJM-F7K2"   (SMS first line)
 *   "cjc-d7k2q", "CJC D7K2Q"                   → "CJC-D7K2Q"  (sister sites)
 * Returns '' when there's nothing usable.
 */
export function normalizeRef(input) {
  const raw = String(input || '').toUpperCase();
  const flat = raw.replace(/[^A-Z0-9]/g, '');
  if (!flat) return '';

  // The whole input is the code (with or without the CJM prefix/dash/spaces).
  if (flat.startsWith('CJM')) {
    const body = flat.slice(3);
    if (!body) return '';
    // Carport codes can legitimately start with 'CJM' (CJM-CJM2K), so a bare
    // body like 'CJM2K' is ambiguous — prefer the reading that leaves a valid
    // tool letter (F/G/C/R/P/T) up front.
    if (/^[FGCRPT][A-Z0-9]+$/.test(body)) return `CJM-${body}`;
    if (/^[FGCRPT][A-Z0-9]+$/.test(flat)) return `CJM-${flat}`;
    return `CJM-${body}`;
  }

  // A sister-site code typed whole ("cjc d7k2q" → CJC-D7K2Q). Checked against
  // the strict body shape so a metals carport code like "cjc2k" still falls
  // through to the CJM handling below.
  const sister = SISTER_BODY.exec(flat);
  if (sister) return `${sister[1]}-${sister[2]}`;

  // A sister token embedded in pasted context (email subject, SMS line).
  // Must run BEFORE the loose CJM match: every sister brand name contains
  // "CJM" ("cjm-concrete.com"), and the strict letter+4 body shape means this
  // can never steal a legitimate metals ref.
  const st = raw.match(/(CJC|CJI|CJT)[\s-]*([A-Z][A-Z0-9]{4})(?![A-Z0-9])/);
  if (st) return `${st[1]}-${st[2]}`;

  // Code embedded in pasted context — pick out the CJM token instead of
  // gluing the surrounding words into a garbage ref.
  const m = raw.match(/CJM[\s-]*([A-Z0-9]{2,8})/);
  if (m) return `CJM-${m[1]}`;

  return `CJM-${flat}`;
}

/** The configurator tool a design code came from, or null. */
export function refTool(ref) {
  const r = String(ref || '').trim().toUpperCase();
  const m = /^CJM-([FGCRPT])/.exec(r);
  if (m) return { F: 'fence', G: 'gate', C: 'carport', R: 'railing', P: 'pergola', T: 'table' }[m[1]] || null;
  if (r.startsWith('CJC-')) return 'concrete';
  if (r.startsWith('CJI-')) return 'insulation';
  // CJT- (trades planner) spans multiple shops — no single configurator.
  return null;
}
