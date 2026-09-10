import type { Express, Request } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { and, eq, isNull } from "drizzle-orm";
import { db, sqlite } from "./storage";
import { hasLeadKey } from "./public-api";
import { currentShop, currentShopInvoice, quoteDocument } from "./public-portal";
import { quotes } from "../shared/quote-schema";
import { clients } from "../shared/crm-schema";
import { contracts } from "../shared/pm-schema";
// payInFullDiscountBp: the owner-editable rate (Finance → Billing markups),
// shared with the invoice email that advertises the offer.
import {
  presentInvoice, recordInvoicePayment, payInFullDiscountBp as discountBp,
  otherInvoicedCents, invoiceAttachments, sendInvoiceAttachment,
} from "./finance";
import { invoices, type Invoice } from "../shared/finance-schema";
import { parseLineItems, lineItemsTotalCents } from "../shared/biz-common";
import { parseJson } from "./quotes";
import { todayLocal, usd } from "./http-util";

// ─── Online invoice payment (Stripe Checkout) ───────────────────────────────
// The customer's half of an invoice:
//
//   GET  /api/public/invoice/:token           — the document behind /invoice/<token>
//   POST /api/public/invoice/:token/checkout  — { url } to Stripe's hosted page
//   POST /api/public/stripe/webhook           — Stripe reports the money landed
//
// Card, Apple Pay and Google Pay all come from that one hosted page — they are
// payment methods on a Checkout Session, not three integrations. Apple Pay
// needs no domain registration because the page is Stripe's own origin, not
// ours. Which methods appear is a dashboard setting; no code here names them.
//
// Nothing in this file is required for the suite to run: with no
// STRIPE_SECRET_KEY the invoice page still renders and the Pay button reports
// that online payment is off, exactly as it does when Stripe is down.
//
// ⚠ This is the ONE place money arrives from outside. Two rules hold it up:
// the amount is always computed here from the stored invoice (the browser only
// says WHICH amount it wants, never how much), and the webhook is trusted only
// after its signature verifies against STRIPE_WEBHOOK_SECRET.
//
// Env (suite service):
//   STRIPE_SECRET_KEY     — sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET — whsec_…, from the endpoint you create in Stripe
//   PUBLIC_SITE_URL       — where /invoice/<token> lives (already used by quotes)

const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://www.cjmmetals.com";

// fin_invoices.share_token, like quotes: 24 random bytes hex-encoded.
const TOKEN_RE = /^[0-9a-f]{48}$/i;

// Stripe rejects anything under $0.50 USD; offering a button that 400s at the
// last step is worse than not offering it.
const STRIPE_MIN_CENTS = 50;

const stripeKey = () => process.env.STRIPE_SECRET_KEY || "";

const publicLimiter = (max: number) => rateLimit({
  windowMs: 60 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: hasLeadKey,
  message: { ok: false, error: "rate limited" },
});

// ─── What the customer may pay ───────────────────────────────────────────────
// Derived from the stored row on every request — never from the client, and
// never cached. Retainage is withheld by agreement, so it is not collectable
// here (the release invoice collects it); `paid` covers cash and checks the
// owner already recorded, so a part-paid invoice offers only what's left.

/**
 * What clearing the whole invoice in one payment would cost, and what it saves.
 * Returns null when the offer doesn't apply.
 *
 * Offered ONLY on a fresh, unpaid, retainage-free invoice — "pay in full at
 * first" is exactly that. Excluding retainage is deliberate: retainage is money
 * withheld by agreement and released on a later invoice, so "in full" has no
 * single meaning there, and discounting a total that's still going to move
 * would be guesswork.
 *
 * The discount comes off the SUBTOTAL and the tax is restated on what's left —
 * you don't owe the state sales tax on money the customer never paid. (That
 * lands on the same figure as taking the percentage off the gross, since both
 * are the same multiplication; doing it in this order is just what keeps
 * subtotal − discount + tax = total true on the printed document.)
 */
interface PayInFull {
  /** What the customer pays. */
  totalCents: number;
  /** Restated invoice figures, so subtotal − discount + tax = total exactly. */
  subtotalCents: number;
  taxRateBp: number;
  taxCents: number;
  discountCents: number;
  /** 'contract' = settling the WHOLE job from a deposit invoice, which
   *  restates this invoice into the invoice for the job. */
  scope: "invoice" | "contract";
  /** The single line the restated invoice carries, for 'contract' only. */
  itemLabel: string;
  /** The undiscounted figure this is measured against — what "was" shows. */
  grossCents: number;
}

function payInFull(inv: Invoice): PayInFull | null {
  const bp = discountBp();
  if (bp <= 0) return null;
  if (inv.paidCents !== 0) return null;
  if ((inv.retainageCents ?? 0) !== 0) return null;
  if (inv.discountCents != null) return null; // already granted
  // A deposit billed separately, or this being that deposit's balance: "the
  // whole job" is no longer this invoice's to settle, and the customer already
  // passed on the pay-upfront offer when the deposit invoice went out. The
  // balance invoice says so itself (kind) — the deposit may have been taken
  // outside the suite, so the sibling check alone can't be relied on.
  if (inv.kind === "balance" || otherInvoicedCents(inv) > 0) return null;

  // What "in full" MEANS depends on the invoice. On an ordinary one it's this
  // bill. On a deposit — a slice of a bigger contract — paying this invoice in
  // full settles nothing, so the offer is to clear the whole job instead, and
  // it has to be priced off the contract, not off the deposit.
  let scope: "invoice" | "contract" = "invoice";
  let grossCents = inv.totalCents;
  let subtotalCents = inv.subtotalCents;
  let taxRateBp = inv.taxRateBp;
  let itemLabel = "";

  if (inv.quoteId != null) {
    const quote = db.select().from(quotes)
      .where(and(eq(quotes.id, inv.quoteId), isNull(quotes.deletedAt)))
      .get();
    if (quote && quote.totalCents > inv.totalCents) {
      scope = "contract";
      grossCents = quote.totalCents;
      itemLabel = `Balance of contract — settled with the deposit (quote ${quote.number})`;
      // A deposit line is a percentage of the TAX-INCLUSIVE contract price, so
      // the restated invoice stays on those terms: subtotal is the contract
      // price with tax already inside it, exactly as the deposit invoice was
      // already built and as its terms say. That also makes the appended line
      // come out at precisely the balance this invoice already quotes.
      subtotalCents = grossCents;
      taxRateBp = 0;
    }
  }
  if (subtotalCents <= 0) return null;

  // The customer is promised "X% off", so the TOTAL is pinned to exactly that
  // and the tax line is whatever makes the ladder add up. Deriving tax
  // independently leaves the two disagreeing by a cent on some amounts, and a
  // printed document that doesn't add up is worse than a rounded tax figure.
  const discountCents = Math.round((subtotalCents * bp) / 10_000);
  const totalCents = Math.round((grossCents * (10_000 - bp)) / 10_000);
  const taxCents = totalCents - subtotalCents + discountCents;
  // An offer that saves nothing, or lands under Stripe's floor, isn't one.
  if (totalCents >= grossCents || totalCents < STRIPE_MIN_CENTS || taxCents < 0) return null;
  return { totalCents, subtotalCents, taxRateBp, taxCents, discountCents, scope, itemLabel, grossCents };
}

function payable(inv: Invoice) {
  const balanceCents = Math.max(
    0,
    inv.totalCents - (inv.retainageCents ?? 0) - inv.paidCents,
  );
  // A deposit is only a distinct choice while it's smaller than the balance —
  // once payments cover it, "deposit" and "balance" are the same button.
  const remainingDeposit = Math.min((inv.depositCents ?? 0) - inv.paidCents, balanceCents);
  const depositCents = remainingDeposit > 0 && remainingDeposit < balanceCents ? remainingDeposit : 0;
  return { balanceCents, depositCents, full: payInFull(inv) };
}

const amountFor = (inv: Invoice, which: string): number => {
  const { balanceCents, depositCents, full } = payable(inv);
  if (which === "full" && full) return full.totalCents;
  return which === "deposit" && depositCents > 0 ? depositCents : balanceCents;
};

// ─── The rest of the document ────────────────────────────────────────────────
// An invoice on its own is a number and some line items. What makes it read
// like the shop's own paperwork — who it's for in full, what the job actually
// is, which quote and contract it answers to — lives in records beside it.
// All of it degrades to null: an invoice typed by hand with no quote behind it
// still prints, just with fewer blocks.

function billTo(inv: Invoice) {
  if (inv.clientId == null) return { name: inv.clientName ?? "", lines: [] as string[] };
  const c = db.select().from(clients).where(eq(clients.id, inv.clientId)).get();
  if (!c) return { name: inv.clientName ?? "", lines: [] as string[] };
  // Street, then "City, ZIP", then contact — the shape an envelope wants.
  const cityZip = [c.city, c.zip].filter(Boolean).join(", ");
  return {
    name: c.name || inv.clientName || "",
    lines: [
      c.company,
      c.address,
      cityZip,
      [c.phone, c.email].filter(Boolean).join("  ·  "),
    ].filter((l): l is string => !!l && l.trim().length > 0),
  };
}

/**
 * The quote this invoice bills against: the job in the customer's own words,
 * the full contract price, and the reference codes. Deposit invoices lean on
 * this — without it a $2,266 deposit reads as the whole price of the job.
 */
function fromQuote(inv: Invoice) {
  if (inv.quoteId == null) return null;
  const quote = db.select().from(quotes)
    .where(and(eq(quotes.id, inv.quoteId), isNull(quotes.deletedAt)))
    .get();
  if (!quote) return null;
  const doc = quoteDocument(quote);
  // The signed paperwork behind the job, if there is any. quote_ref is how the
  // contracts module already points back at a quote.
  const contract = db.select({ title: contracts.title, id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.quoteRef, quote.number), isNull(contracts.deletedAt)))
    .get();
  return {
    quoteNumber: quote.number,
    designRef: quote.designRef,
    contractTitle: contract?.title ?? null,
    contractCents: quote.totalCents,
    // What was already billed on this job before this invoice (the deposit,
    // when this is the balance) — the page nets it out of the contract price.
    // A balance invoice is, by construction, the contract less the deposit,
    // so it says so even when the deposit was never invoiced here. Otherwise
    // earlier siblings only: the balance invoice mustn't rewrite the deposit's page.
    priorCents: inv.kind === "balance"
      ? Math.max(otherInvoicedCents(inv, true), quote.totalCents - inv.totalCents, 0)
      : otherInvoicedCents(inv, true),
    project: {
      label: doc?.project.label ?? "",
      summary: doc?.project.summary ?? "",
      specs: (doc?.specs ?? []).slice(0, 14),
    },
  };
}

// allowDraft: the owner proofing an unsent bill (POST /api/finance/invoices/:id/
// preview mints the token early and views it with ?preview=1). Only the GET
// passes it — the checkout route never does, so a draft can't be charged for.
const findInvoice = (token: string, allowDraft = false): Invoice | undefined => {
  if (!TOKEN_RE.test(token)) return undefined;
  const inv = db.select().from(invoices)
    .where(and(eq(invoices.shareToken, token), isNull(invoices.deletedAt)))
    .get();
  // A draft behind a token is an unfinished document — shown only to the one
  // person who could have the link before it was sent: whoever minted it.
  return inv && (allowDraft || inv.status !== "draft") ? inv : undefined;
};

// ─── Stripe REST ─────────────────────────────────────────────────────────────
// Two calls, one auth header, form-encoded bodies — the SDK would be a
// dependency for `new URLSearchParams`.

async function stripePost(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey()}`,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error?.message || `Stripe ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify Stripe's `Stripe-Signature` header against the raw request body.
 * Scheme v1: HMAC-SHA256 of `<timestamp>.<body>` keyed by the endpoint secret.
 * Returns the parsed event, or null when anything at all is off — a forged or
 * replayed webhook must never reach the ledger.
 */
function verifiedEvent(raw: Buffer, header: string | undefined): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret || !header || !Buffer.isBuffer(raw)) return null;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") timestamp = v ?? "";
    else if (k?.trim() === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return null;

  // Replay window. Stripe retries for days, but always with a fresh signature;
  // a body captured off the wire must not stay redeemable.
  const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 300) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${raw.toString("utf8")}`)
    .digest();
  const matched = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!matched) return null;

  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS fin_checkout_sessions (
    fingerprint TEXT PRIMARY KEY, invoice_id INTEGER NOT NULL, request_key TEXT NOT NULL,
    session_id TEXT, url TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
`);

const checkoutQueues = new Map<number, Promise<void>>();
async function checkoutLock(invoiceId: number): Promise<() => void> {
  const previous = checkoutQueues.get(invoiceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  checkoutQueues.set(invoiceId, current);
  await previous;
  return () => { release(); if (checkoutQueues.get(invoiceId) === current) checkoutQueues.delete(invoiceId); };
}
async function stripeSession(id: string) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${stripeKey()}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not verify previous payment (${response.status})`);
  return response.json();
}
async function closeCheckout(id: string) {
  const current = await stripeSession(id);
  if (current.status === 'open') await stripePost(`checkout/sessions/${encodeURIComponent(id)}/expire`, {});
  else if (current.status === 'complete') {
    const recorded = current.payment_intent && sqlite.prepare('SELECT 1 FROM fin_invoice_payments WHERE reference=?').get(String(current.payment_intent));
    if (!recorded) throw new Error('A previous payment is processing. Wait for its confirmation before paying again.');
  } else if (!['complete','expired'].includes(current.status)) throw new Error('Could not confirm the previous payment page is closed.');
  sqlite.prepare('UPDATE fin_checkout_sessions SET url=NULL, expires_at=0 WHERE session_id=?').run(id);
}
async function expireChangedInvoices() {
  if (!stripeKey()) return;
  const jobs = sqlite.prepare('SELECT invoice_id FROM fin_checkout_expiry_queue ORDER BY created_at LIMIT 20').all() as {invoice_id:number}[];
  for (const job of jobs) {
    const release = await checkoutLock(job.invoice_id);
    try {
      const sessions = sqlite.prepare('SELECT session_id FROM fin_checkout_sessions WHERE invoice_id=? AND session_id IS NOT NULL AND url IS NOT NULL').all(job.invoice_id) as {session_id:string}[];
      for (const row of sessions) await closeCheckout(row.session_id);
      sqlite.prepare('DELETE FROM fin_checkout_expiry_queue WHERE invoice_id=?').run(job.invoice_id);
    } catch (error) {
      sqlite.prepare(`INSERT OR IGNORE INTO fin_payment_exceptions (event_id,invoice_id,kind,details,created_at) VALUES (?,?,?,?,?)`)
        .run(`expire:${job.invoice_id}`,job.invoice_id,'checkout_expiration_failed',String(error),Date.now());
    } finally { release(); }
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerPayRoutes(app: Express): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS fin_checkout_expiry_queue (invoice_id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS fin_expire_changed_checkout AFTER UPDATE OF paid_cents,total_cents,status,items,deposit_cents,retainage_cents,discount_cents,deleted_at ON fin_invoices
    WHEN OLD.paid_cents IS NOT NEW.paid_cents OR OLD.total_cents IS NOT NEW.total_cents OR OLD.status IS NOT NEW.status OR OLD.items IS NOT NEW.items OR OLD.deposit_cents IS NOT NEW.deposit_cents OR OLD.retainage_cents IS NOT NEW.retainage_cents OR OLD.discount_cents IS NOT NEW.discount_cents OR OLD.deleted_at IS NOT NEW.deleted_at
    BEGIN INSERT INTO fin_checkout_expiry_queue (invoice_id,created_at) VALUES (NEW.id,unixepoch()*1000) ON CONFLICT(invoice_id) DO UPDATE SET created_at=excluded.created_at; END;`);
  const expiryTimer = setInterval(() => { void expireChangedInvoices().catch((e) => console.error('[pay] expiration retry failed',e)); }, 30_000);
  expiryTimer.unref();
  // The customer's invoice document. Deliberately hand-picked rather than
  // spread from the row: `notes` is the owner's scratch pad (the quote-accept
  // hook writes into it, and the mailer reads addresses out of it), share_token
  // is a credential, and client_id/lead_id/project_id are none of their
  // business. Send the sheet of paper, nothing else.
  app.get("/api/public/invoice/:token", publicLimiter(120), (req, res) => {
    const inv = findInvoice(String(req.params.token), req.query.preview === "1");
    if (!inv) return res.status(404).json({ ok: false });

    const view = presentInvoice(inv, todayLocal());
    const { balanceCents, depositCents, full } = payable(inv);
    res.json({
      ok: true,
      invoice: {
        number: inv.number,
        status: view.status,
        customerName: inv.clientName,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        items: parseLineItems(inv.items).map((it) => ({
          description: it.description,
          qty: it.qty,
          unit: it.unit ?? null,
          unitPriceCents: it.unitPriceCents,
          amountCents: Math.round(it.qty * it.unitPriceCents),
        })),
        subtotalCents: inv.subtotalCents,
        taxRateBp: inv.taxRateBp,
        taxCents: inv.taxCents,
        totalCents: inv.totalCents,
        paidCents: inv.paidCents,
        retainageCents: inv.retainageCents ?? 0,
        // A discount already granted — the ladder on a settled invoice has to
        // explain why the total is below the work billed.
        discountCents: inv.discountCents ?? 0,
        balanceCents,
        // > 0 = the invoice offers "pay the deposit" as a smaller first step.
        depositCents,
        // Present = clearing it in one payment is discounted. `totalCents` is
        // what they'd pay, `savesCents` what they keep.
        // `scope: 'contract'` means this settles the WHOLE job from a deposit
        // invoice — the page offers it beside the deposit rather than instead
        // of it, and `wasCents` is the contract price, not this bill.
        payInFull: full
          ? {
              totalCents: full.totalCents,
              wasCents: full.grossCents,
              savesCents: full.grossCents - full.totalCents,
              pct: discountBp() / 100,
              scope: full.scope,
            }
          : null,
        // Whether the Pay button should be live at all: money still owed, the
        // invoice still open, Stripe configured, and above Stripe's floor.
        // A draft is only ever visible to the owner proofing it, and a bill
        // that hasn't been issued must not be collectable — the checkout route
        // refuses it too, so this keeps the page from offering what it can't do.
        payable:
          !!stripeKey()
          && balanceCents >= STRIPE_MIN_CENTS
          && inv.status !== "draft"
          && inv.status !== "void"
          && inv.status !== "paid",
        shop: currentShop(),
        // Bank remit-to + the invoice's own small print. Bank details are
        // printed for anyone paying by transfer; the Pay button covers cards.
        pay: currentShopInvoice(),
        billTo: billTo(inv),
        // Null when the invoice wasn't raised from a quote — the document
        // simply drops the project block and the contract-price ladder.
        quote: fromQuote(inv),
        // Names only — the disk filename stays the server's. The site fetches
        // each by index through the /file/:i route below.
        attachments: invoiceAttachments(inv).map((a, index) => ({ name: a.name, index })),
        // The owner's own wording for this bill, or null for the page's default.
        // Same line/length caps as the shop terms (currentShopInvoice).
        customerNote: (inv.customerNote ?? "").trim().slice(0, 2000) || null,
        terms: (() => {
          const lines = (inv.terms ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
          return lines.length ? lines.slice(0, 12).map((l) => l.slice(0, 300)) : null;
        })(),
        createdAt: inv.createdAt.getTime(),
        sentAt: inv.sentAt,
      },
    });
  });

  // An attachment the owner put on the bill — a signed contract, a drawing.
  // Same draft rule as the document: only the owner's ?preview=1 sees a draft's.
  app.get("/api/public/invoice/:token/file/:i", publicLimiter(60), (req, res) => {
    const inv = findInvoice(String(req.params.token), req.query.preview === "1");
    if (!inv) return res.status(404).json({ ok: false });
    res.setHeader("Cache-Control", "private, max-age=0");
    sendInvoiceAttachment(res, inv, Number(req.params.i));
  });

  // Start a payment. The body chooses BETWEEN the amounts this invoice offers;
  // it can never name one. 20/hour per visitor is generous for a customer
  // retrying a declined card and useless for anyone farming session URLs.
  app.post("/api/public/invoice/:token/checkout", publicLimiter(20), async (req, res) => {
    const token = String(req.params.token);
    let inv = findInvoice(token);
    if (!inv) return res.status(404).json({ ok: false });
    if (!stripeKey()) return res.status(503).json({ ok: false, reason: "unconfigured" });
    if (inv.status === "void" || inv.status === "paid") {
      return res.status(409).json({ ok: false, reason: "closed" });
    }

    const release = await checkoutLock(inv.id);
    try {
    inv = findInvoice(token);
    if (!inv || ["paid", "void"].includes(inv.status)) return res.status(409).json({ok:false,reason:"closed"});
    // "full" only means anything while the offer stands; payable() decides
    // that, so a stale page asking for it just gets the ordinary balance.
    const asked = String(req.body?.which ?? "");
    const which = asked === "deposit" ? "deposit"
      : asked === "full" && payInFull(inv) ? "full"
      : "balance";
    // Come back to the page they left. A flag, not a path — the browser naming
    // its own return URL is an open redirect waiting to happen.
    const home = `${PUBLIC_SITE_URL}${req.body?.lang === "es" ? "/es" : ""}/invoice/${token}`;
    const amountCents = amountFor(inv, which);
    if (amountCents < STRIPE_MIN_CENTS) {
      return res.status(409).json({ ok: false, reason: "nothing due" });
    }

    const label = which === "deposit"
      ? `Invoice ${inv.number} — deposit`
      : which === "full"
      ? `Invoice ${inv.number} — paid in full (${discountBp() / 100}% discount)`
      : `Invoice ${inv.number}${inv.paidCents > 0 ? " — remaining balance" : ""}`;

    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      invoiceId: inv.id, amountCents, which, home, paid: inv.paidCents,
      total: inv.totalCents, items: inv.items, discount: inv.discountCents, retainage: inv.retainageCents,
    })).digest("hex");
    const checkout = sqlite.transaction(() => {
      const now = Date.now();
      const existing = sqlite.prepare("SELECT * FROM fin_checkout_sessions WHERE fingerprint = ?")
        .get(fingerprint) as { request_key: string; session_id: string | null; url: string | null; expires_at: number } | undefined;
      if (existing && ((existing.url && existing.session_id) || existing.expires_at > now)) return existing;
      const request_key = `cjm-${crypto.randomUUID()}`;
      const expires_at = now + 24 * 60 * 60_000;
      sqlite.prepare(`INSERT INTO fin_checkout_sessions (fingerprint, invoice_id, request_key, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET request_key=excluded.request_key,
        session_id=NULL, url=NULL, expires_at=excluded.expires_at, created_at=excluded.created_at`)
        .run(fingerprint, inv!.id, request_key, expires_at, now);
      return { request_key, session_id: null, url: null, expires_at };
    })();
    if (checkout.url && checkout.session_id) {
      const current = await stripeSession(checkout.session_id);
      if (current.status === 'open') return res.json({ ok: true, url: checkout.url });
      if (current.status === 'complete') return res.status(409).json({ok:false,reason:'processing',message:'This payment has already been submitted. Wait for confirmation.'});
      sqlite.prepare('UPDATE fin_checkout_sessions SET url=NULL,expires_at=0 WHERE session_id=?').run(checkout.session_id);
      return res.status(409).json({ok:false,reason:'expired',message:'This payment page expired. Please try again.'});
    }
    try {
      const stale = sqlite.prepare("SELECT session_id FROM fin_checkout_sessions WHERE invoice_id = ? AND fingerprint != ? AND session_id IS NOT NULL AND url IS NOT NULL")
        .all(inv.id, fingerprint) as { session_id: string }[];
      for (const old of stale) {
        // Expiration failure is visible and retryable; do not open a competing
        // session while an older payment page may still be usable.
        await closeCheckout(old.session_id);
      }
      const session = await stripePost("checkout/sessions", {
        mode: "payment",
        // Stripe defaults to 24 hours; omitting a relative expiry keeps retry parameters identical.
        // ?paid=1 only tells the page to say "thanks, updating" — the webhook,
        // not this redirect, is what moves money in the ledger.
        success_url: `${home}?paid=1`,
        cancel_url: home,
        client_reference_id: inv.number,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": label,
        // Echoed back on the webhook — the only link from Stripe's world to
        // this row, and the reason the handler never has to guess.
        "metadata[invoiceId]": String(inv.id),
        "metadata[invoiceNumber]": inv.number,
        "metadata[which]": which,
      }, checkout.request_key);
      if (!session?.url) throw new Error("no session url");
      sqlite.prepare("UPDATE fin_checkout_sessions SET session_id = ?, url = ?, expires_at = ? WHERE fingerprint = ? AND request_key = ?")
        .run(session.id, session.url, session.expires_at ? session.expires_at * 1000 : checkout.expires_at, fingerprint, checkout.request_key);
      const latest = findInvoice(token);
      if (!latest || latest.paidCents !== inv.paidCents || latest.totalCents !== inv.totalCents || latest.items !== inv.items || latest.status !== inv.status) {
        await closeCheckout(session.id);
        return res.status(409).json({ok:false,reason:'changed',message:'The invoice changed. Reload it before paying.'});
      }
      res.json({ ok: true, url: session.url });
    } catch (e) {
      console.error("[pay] checkout session failed", e);
      res.status(502).json({ ok: false, reason: "stripe" });
    }
    } catch (error) { res.status(502).json({ok:false,reason:"stripe",message:String(error)}); } finally { release(); }
  });

  // Stripe tells us the money landed. Mounted with express.raw (see index.ts)
  // because the signature covers the exact bytes, not the reparsed JSON.
  // Always 200 on anything we've decided not to act on — a 4xx just makes
  // Stripe retry a webhook that will never succeed.
  app.post("/api/public/stripe/webhook", (req, res) => {
    const event = verifiedEvent(req.body as Buffer, req.header("stripe-signature"));
    if (!event) {
      console.warn("[pay] webhook rejected — bad or missing signature");
      return res.status(400).json({ ok: false });
    }
    if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed", "checkout.session.async_payment_failed"].includes(event.type)) {
      const object = event.data?.object ?? {};
      const ref = String(object.payment_intent || "");
      const payment = ref ? sqlite.prepare("SELECT invoice_id FROM fin_invoice_payments WHERE reference = ?").get(ref) as { invoice_id: number } | undefined : undefined;
      sqlite.prepare(`INSERT OR IGNORE INTO fin_payment_exceptions (event_id, invoice_id, kind, details, created_at)
        VALUES (?, ?, ?, ?, ?)`).run(String(event.id), (payment?.invoice_id ?? Number(object.metadata?.invoiceId)) || null,
          event.type, JSON.stringify({ reference: ref, objectId: object.id, amount: object.amount_refunded ?? object.amount, status: object.status }), Date.now());
      if (event.type === "checkout.session.async_payment_failed" && object.id) {
        sqlite.prepare('UPDATE fin_checkout_sessions SET url=NULL,expires_at=0 WHERE session_id=?').run(String(object.id));
      }
      return res.json({ received: true });
    }
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return res.json({ received: true });

    const session = event.data?.object ?? {};
    if (session.payment_status !== "paid") return res.json({ received: true });

    const invoiceId = Number(session.metadata?.invoiceId);
    const amountCents = Number(session.amount_total);
    const reference = String(session.payment_intent || session.id || "");
    if (!Number.isSafeInteger(invoiceId) || !Number.isSafeInteger(amountCents) || !(amountCents > 0) || session.currency !== "usd" || !reference) {
      sqlite.prepare(`INSERT OR IGNORE INTO fin_payment_exceptions (event_id,invoice_id,kind,details,created_at) VALUES (?,NULL,'unmatched_payment',?,?)`).run(String(event.id),JSON.stringify({sessionId:session.id,invoiceId,amountCents,currency:session.currency}),Date.now());
      console.error("[pay] paid session with no usable invoice ref", session.id);
      return res.json({ received: true });
    }

    let inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    if (!inv || inv.deletedAt != null) {
      sqlite.prepare(`INSERT OR IGNORE INTO fin_payment_exceptions (event_id,invoice_id,kind,details,created_at) VALUES (?,?,'payment_missing_invoice',?,?)`).run(String(event.id),invoiceId,JSON.stringify({reference,amountCents}),Date.now());
      console.error("[pay] paid session for a missing invoice", invoiceId, reference);
      return res.json({ received: true });
    }

    // A payment against a voided invoice is a real problem — the money is in
    // the Stripe account either way, so record it and let the owner see it
    // rather than silently dropping it on the floor.
    if (inv.status === "void") {
      console.error("[pay] payment landed on a VOID invoice", inv.number, reference);
    }

    try {
      recordInvoicePayment(req as Request, inv, {
        amountCents,
        method: "card", // Apple Pay and Google Pay ARE card payments
        reference,
        paidAt: todayLocal(),
        notes: inv.discountCents != null && session.metadata?.which === "full"
          ? `Paid online in full — ${usd(inv.discountCents)} prompt-payment discount applied`
          : `Paid online — ${session.metadata?.which === "deposit" ? "deposit" : "balance"}`,
      }, "stripe", (current) => {
        let inv = current;
    // Granting the discount. It has to happen BEFORE the payment is recorded,
    // because the status ladder compares what was paid against the invoice
    // total — restate the total first and the payment settles it; the other
    // way round and a fully-paid invoice sits at "partial" forever.
    //
    // Eligibility is re-checked here against the invoice as it stands NOW, not
    // as it stood when the session opened: between those two moments a deposit
    // could have landed. And the amount must match what the offer is worth to
    // the cent — anything else is recorded as an ordinary payment, which leaves
    // a visible balance for the owner to look at rather than quietly writing
    // off the difference.
    if (session.metadata?.which === "full") {
      const offer = payInFull(inv);
      if (offer && offer.totalCents === amountCents) {
        inv = db.update(invoices)
          .set({
            discountCents: offer.discountCents,
            taxCents: offer.taxCents,
            totalCents: offer.totalCents,
            // Settling the whole job from a DEPOSIT invoice grows that invoice
            // to cover the contract. The deposit line is KEPT — it is what the
            // customer was actually billed, and an invoice already sent is a
            // record, not a draft. A second line covers the rest of the job, so
            // the two sum to the contract price and the itemisation survives.
            //
            // The pre-restatement figures are snapshotted so reversing the
            // payment can put it back: without that, a bounced card leaves an
            // unpaid invoice that has quietly kept the discount.
            ...(offer.scope === "contract"
              ? {
                  restatedFrom: JSON.stringify({
                    items: inv.items,
                    subtotalCents: inv.subtotalCents,
                    taxRateBp: inv.taxRateBp,
                    taxCents: inv.taxCents,
                    totalCents: inv.totalCents,
                  }),
                  subtotalCents: offer.subtotalCents,
                  taxRateBp: offer.taxRateBp,
                  items: JSON.stringify([
                    ...parseLineItems(inv.items),
                    {
                      description: offer.itemLabel,
                      qty: 1,
                      unitPriceCents: offer.subtotalCents - lineItemsTotalCents(parseLineItems(inv.items)),
                    },
                  ]),
                }
              : {}),
          })
          .where(eq(invoices.id, inv.id))
          .returning()
          .get();
      } else {
        console.error(
          "[pay] pay-in-full no longer applies — recording as a plain payment",
          inv.number, reference, { paid: amountCents, expected: offer?.totalCents ?? null },
        );
      }
    }

        return inv;
      });
    } catch (e) {
      // 500 so Stripe retries — the idempotency check above makes that safe.
      console.error("[pay] failed to record online payment", reference, e);
      return res.status(500).json({ ok: false });
    }
    void expireChangedInvoices().catch((error) => console.error("[pay] expiration failed",error));
    res.json({ received: true });
  });
}
