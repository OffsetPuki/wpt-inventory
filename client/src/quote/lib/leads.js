// =============================================================================
//  Design lookup — now served by the suite itself. The standalone Quote App
//  called flipnob.com's public designs endpoint with a shared key; embedded in
//  the suite, the same data comes from the authenticated /api/quotes/designs
//  route (same envelope: { ok, leads: [...] }), so no URL or key to configure.
//
//  Each lead: { time, type, ref, name, phone, email, contact, bestTime,
//               service, location, consent, source, designSpec, notes, lang }
// =============================================================================

import { getAuthToken } from '@/lib/queryClient';

/**
 * Normalize whatever the owner types OR pastes into a canonical design code:
 *   "f7k2", "CJM F7K2", "cjm-f7k2"            → "CJM-F7K2"
 *   "[DESIGN CJM-F7K2] New quote request …"    → "CJM-F7K2"   (email subject)
 *   "Diseño CJM-F7K2" / "Design CJM-F7K2"      → "CJM-F7K2"   (SMS first line)
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
    // tool letter (F/G/C/R) up front.
    if (/^[FGCR][A-Z0-9]+$/.test(body)) return `CJM-${body}`;
    if (/^[FGCR][A-Z0-9]+$/.test(flat)) return `CJM-${flat}`;
    return `CJM-${body}`;
  }

  // Code embedded in pasted context — pick out the CJM token instead of
  // gluing the surrounding words into a garbage ref.
  const m = raw.match(/CJM[\s-]*([A-Z0-9]{2,8})/);
  if (m) return `CJM-${m[1]}`;

  return `CJM-${flat}`;
}

/** The configurator tool a design code came from (F/G/C/R), or null. */
export function refTool(ref) {
  const m = /^CJM-([FGCR])/i.exec(String(ref || '').trim());
  if (!m) return null;
  return { F: 'fence', G: 'gate', C: 'carport', R: 'railing' }[m[1].toUpperCase()] || null;
}

function normalizeLead(row) {
  const get = (k) => (row && row[k] != null ? String(row[k]).trim() : '');
  return {
    time: get('time'),
    type: get('type') || 'lead',
    ref: get('ref').toUpperCase(),
    name: get('name'),
    phone: get('phone'),
    email: get('email'),
    contact: get('contact'),
    bestTime: get('bestTime'),
    service: get('service'),
    location: get('location'),
    consent: get('consent'),
    source: get('source'),
    designSpec: get('designSpec'),
    notes: get('notes'),
    lang: get('lang') || 'en',
    reason: get('reason'), // alert rows: why the website reported a delivery failure
  };
}

/**
 * Query the suite for website designs. opts = { ref } or { recent }.
 * Resolves to a normalized lead array (possibly empty); throws an Error with
 * an owner-readable message on any failure. Uses fetch directly (not
 * apiRequest) to keep the original 15s abort — a hung request must not leave
 * the Find design screen stuck on "Searching…" forever.
 */
export async function fetchLeads({ ref, recent } = {}) {
  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  else params.set('recent', String(recent || 25));

  const headers = {};
  const token = getAuthToken();
  if (token) headers['X-Auth'] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetch(`/api/quotes/designs?${params.toString()}`, { headers, signal: controller.signal });
  } catch (err) {
    throw new Error(err && err.name === 'AbortError'
      ? 'The lookup timed out. Check your connection and try again.'
      : 'Could not load website designs. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new Error('Your session expired — sign in again to look up designs.');
  if (!res.ok) throw new Error(`The design lookup responded with an error (HTTP ${res.status}).`);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('The design lookup returned something unexpected. Try again in a moment.');
  }
  if (!data || data.ok !== true) {
    throw new Error(`Lookup failed${data && data.error ? `: ${data.error}` : ''}.`);
  }
  return (Array.isArray(data.leads) ? data.leads : []).map(normalizeLead);
}
