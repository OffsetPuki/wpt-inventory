// =============================================================================
//  Quote builder persistence helpers.
//
//  Ported from the standalone CJM Quote app. The price book and shop identity
//  moved to the suite's database (GET/PUT /api/quotes/settings) so every
//  device sees the same rates — only the in-progress session (a scratchpad)
//  still lives in localStorage, scoped to the signed-in user.
// =============================================================================

let draftUserId = null;
export function setDraftUser(id) {
  draftUserId = Number.isInteger(id) && id > 0 ? id : null;
  // An unowned legacy draft must never appear in another person's account.
  // Keep the legacy key for recovery, but never load an unowned draft.
}
const sessionKey = () => draftUserId ? `cjm.session.v2.user.${draftUserId}` : null;

function safeParse(s, fallback) {
  if (s == null) return fallback;
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

// Deep-merge stored values over defaults so newly-added rates appear automatically.
// Prototype-polluting key names are skipped — server data merges into the price
// book object, and a '__proto__' key would otherwise rewrite its prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base == null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (UNSAFE_KEYS.has(k)) continue;
    out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

/**
 * A saved quote as the starting point for a new one — "same grill, different
 * window". Everything you priced (lines, overrides, order, markups, notes,
 * features, drawings) rides along; everything that identifies the ORIGINAL is
 * dropped:
 *   · quoteId / number — else the first save would overwrite the original.
 *   · customer + designRef — a copy is for someone else, and their quote must
 *     never carry another customer's details or lead code.
 *   · the price-book snapshot — a new quote prices off today's rates. Rates
 *     you typed BY HAND stay typed; only book-driven lines move.
 */
export function duplicateSession(sess, sid) {
  const copy = structuredClone(sess);
  delete copy.designRef;
  delete copy.leadId;
  delete copy.version;
  delete copy.quoteStatus;
    delete copy.revisionOf;
    delete copy.alternativeOf;
    delete copy.copiedFromNumber;
  return {
    ...copy,
    sid,
    quoteId: null,
    number: null,
    customer: { name: '', company: '', phone: '', email: '', location: '' },
    priceBookSnapshot: null,
    priceBookSnapshotAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function loadSession() { try { return sessionKey() ? safeParse(localStorage.getItem(sessionKey()), null) : null; } catch { return null; } }
export function saveSession(sess) { return sessionKey() ? safeSet(sessionKey(), sess) : false; }
export function clearSession() { try { if (sessionKey()) localStorage.removeItem(sessionKey()); } catch { /* ignore */ } }
// A delayed write from a screen being unmounted must stay with its original
// account, even if a different person signs in before the request completes.
export function captureDraftStorage() {
  const key = sessionKey();
  return {
    save: (sess) => !!key && key === sessionKey() && !!sess && safeSet(key, sess),
    clear: () => { try { if (key && key === sessionKey()) localStorage.removeItem(key); } catch { /* unavailable */ } },
  };
}

export const DEFAULT_SHOP = {
  name: 'CJM Metals',
  location: 'Arlington, Texas',
  phone: '(214) 603-9142',
  email: 'support@cjmmetals.com',
  // The small print at the foot of every quote — one term per line, edited in
  // the Price Book. Printed on the PDF and on the customer's web page.
  terms: 'Quote valid for 30 days. Final price confirmed after an on-site measure.\n'
    + 'Permit, engineering and HOA approval by others unless itemized above.',
  // The small print at the foot of an INVOICE — a bill, not an offer, so it
  // says nothing about the price still standing. One term per line.
  invoiceTerms: 'Payment is due by the date shown above.\n'
    + 'Work is scheduled against cleared funds; a late deposit moves the start date by the length of the delay.',
  // Where a customer paying by transfer sends the money. Printed on the invoice
  // (and only the invoice — a quote is not a request for payment). Every field
  // blank = the remit-to block is left off entirely.
  bank: {
    accountName: '',
    bankName: '',
    routing: '',
    account: '',
    accountType: 'Checking',
    // Shown under the details when the account is not in the business's name —
    // banks reject transfers whose name doesn't match, so the customer has to
    // be told which name to type.
    nameNote: '',
  },
};

/** The shop's invoice terms as printable lines (blank lines dropped). */
export function invoiceTermLines(shop) {
  return String((shop && shop.invoiceTerms) ?? '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Remit-to details, or null when the owner hasn't filled them in. */
export function bankBlock(shop) {
  const b = (shop && shop.bank) || {};
  const has = ['accountName', 'bankName', 'routing', 'account'].some((k) => String(b[k] ?? '').trim());
  return has
    ? {
        accountName: String(b.accountName ?? '').trim(),
        bankName: String(b.bankName ?? '').trim(),
        routing: String(b.routing ?? '').trim(),
        account: String(b.account ?? '').trim(),
        accountType: String(b.accountType ?? '').trim(),
        nameNote: String(b.nameNote ?? '').trim(),
      }
    : null;
}

/** The shop's quote terms as printable lines (blank lines dropped). */
export function termLines(shop) {
  return String((shop && shop.terms) ?? '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
}

// --- dot-path helpers (used by the price-book editor) ------------------------

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Immutable set at dot-path; clones along the path. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const next = Array.isArray(obj) ? [...obj] : { ...obj };
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const child = cur[k];
    cur[k] = child && typeof child === 'object' ? (Array.isArray(child) ? [...child] : { ...child }) : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return next;
}
