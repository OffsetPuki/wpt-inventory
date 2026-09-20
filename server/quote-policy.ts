import {quoteBusiness,businessShop} from '../shared/business.js';
import { sqlite } from './storage';
import { DEFAULT_SHOP, deepMerge } from '../client/src/quote/lib/store.js';

export const QUOTE_VALIDITY_DAYS = 5;
const VALIDITY_TERM = 'Quote valid for 5 days from the issue date and time shown.';
const LEGACY_DEFAULT = 'Quote valid for 30 days. Final price confirmed after an on-site measure.\nPermit, engineering and HOA approval by others unless itemized above.';
const parse = (value: string) => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };

export function normalizeQuoteTerms(value: unknown): string[] {
  // Remove duration sentences only; preserve unrelated delivery/warranty terms.
  const rest = String(value ?? '').replace(/(?:quote|quotation|estimate|cotizaci[oó]n|presupuesto)\s+(?:is\s+)?(?:valid(?:\s+for)?|v[aá]lid[ao](?:\s+por)?)\s+(?:\d+|one|five|ten|thirty|un|una|cinco|diez|treinta)\s+(?:calendar\s+|business\s+)?(?:days?|months?|d[ií]as?|mes(?:es)?)(?:\s+from the issue date and time shown)?\.?/gi, '').trim();
  return [VALIDITY_TERM, ...rest.split('\n').map(s => s.trim()).filter(Boolean)];
}

function shopSettings(legacy = false, site = 'metals') {
  const row = sqlite.prepare('SELECT shop FROM quote_settings WHERE id=1').get() as any;
  const shop: any = deepMerge({...DEFAULT_SHOP, ...(legacy ? {terms: LEGACY_DEFAULT} : {})}, parse(row?.shop || '{}'));
  const identity=businessShop(shop,site);
  return {name:identity.name, location:identity.location, phone:identity.phone, email:identity.email,
    terms:String(identity.terms || '').split('\n').map(s=>s.trim()).filter(Boolean)};
}

export function quotePolicy(quote: any) {
  if (quote.status === 'draft') return null;
  const value = parse(quote.payload).quotePolicy;
  return value?.version === 1 && Number.isFinite(value.issuedAt) && Number.isFinite(value.expiresAt) ? value : null;
}

export function quoteShop(quote: any) {
  const session = parse(quote.payload);
  if (quote.status !== 'draft' && session.quotePolicy?.shop) return session.quotePolicy.shop;
  if (quote.status !== 'draft') return session.legacyShopSnapshot?.shop || shopSettings(true);
  const shop = shopSettings(false,quoteBusiness({...session,type:quote.type}));
  return {...shop, terms:normalizeQuoteTerms(shop.terms.join('\n'))};
}

export function issuedPayload(quote: any, now: number): string {
  const session = parse(quote.payload);
  // Re-sharing an issued offer never extends its deadline or replaces its terms.
  if (quote.status !== 'draft') return quote.payload;
  delete session.legacyShopSnapshot;
  session.quotePolicy = {version:1, validDays:QUOTE_VALIDITY_DAYS, issuedAt:now,
    expiresAt:now + QUOTE_VALIDITY_DAYS * 86400000, shop:quoteShop(quote)};
  return JSON.stringify(session);
}

export function isQuoteExpired(quote: any, now = Date.now()): boolean {
  const policy = quotePolicy(quote);
  return quote.status !== 'accepted' && !!policy && now >= policy.expiresAt;
}

export function preserveLegacyQuoteTerms(): void {
  // Capture what legacy issued links display at upgrade. This is NOT evidence
  // of what was shown at original issuance; the previous app kept no snapshot.
  sqlite.transaction(() => {
    const shop = shopSettings(true), capturedAt = Date.now();
    const rows = sqlite.prepare("SELECT id,payload FROM quotes WHERE status != 'draft'").all() as any[];
    for (const row of rows) {
      // Never replace a malformed historical record with an empty payload.
      try {
        const raw = JSON.parse(row.payload);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      } catch { continue; }
      const session = parse(row.payload);
      if (session.quotePolicy || session.legacyShopSnapshot) continue;
      session.legacyShopSnapshot = {shop, capturedAt, provenance:'display-at-upgrade'};
      sqlite.prepare('UPDATE quotes SET payload=? WHERE id=?').run(JSON.stringify(session),row.id);
    }
  })();
}
