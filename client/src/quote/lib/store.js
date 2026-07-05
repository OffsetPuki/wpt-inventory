// =============================================================================
//  Quote builder persistence helpers.
//
//  Ported from the standalone CJM Quote app. The price book and shop identity
//  moved to the suite's database (GET/PUT /api/quotes/settings) so every
//  device sees the same rates — only the in-progress session (a scratchpad)
//  still lives in localStorage, same key as the old app.
// =============================================================================

const SESSION_KEY = 'cjm.session.v1';

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

export function loadSession() { return safeParse(localStorage.getItem(SESSION_KEY), null); }
export function saveSession(sess) { return safeSet(SESSION_KEY, sess); }
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

export const DEFAULT_SHOP = {
  name: 'CJM Metals',
  location: 'Arlington, Texas',
  phone: '(214) 603-9142',
  email: 'support@cjmmetals.com',
};

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
