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
import { presentInvoice, recordInvoicePayment, payInFullDiscountBp as discountBp } from "./finance";
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

async function stripePost(path: string, params: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey()}`,
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

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerPayRoutes(app: Express): void {
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
        createdAt: inv.createdAt.getTime(),
        sentAt: inv.sentAt,
      },
    });
  });

  // Start a payment. The body chooses BETWEEN the amounts this invoice offers;
  // it can never name one. 20/hour per visitor is generous for a customer
  // retrying a declined card and useless for anyone farming session URLs.
  app.post("/api/public/invoice/:token/checkout", publicLimiter(20), async (req, res) => {
    const token = String(req.params.token);
    const inv = findInvoice(token);
    if (!inv) return res.status(404).json({ ok: false });
    if (!stripeKey()) return res.status(503).json({ ok: false, reason: "unconfigured" });
    if (inv.status === "void" || inv.status === "paid") {
      return res.status(409).json({ ok: false, reason: "closed" });
    }

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

    try {
      const session = await stripePost("checkout/sessions", {
        mode: "payment",
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
      });
      if (!session?.url) throw new Error("no session url");
      res.json({ ok: true, url: session.url });
    } catch (e) {
      console.error("[pay] checkout session failed", e);
      res.status(502).json({ ok: false, reason: "stripe" });
    }
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
    if (event.type !== "checkout.session.completed") return res.json({ received: true });

    const session = event.data?.object ?? {};
    if (session.payment_status !== "paid") return res.json({ received: true });

    const invoiceId = Number(session.metadata?.invoiceId);
    const amountCents = Number(session.amount_total);
    const reference = String(session.payment_intent || session.id || "");
    if (!Number.isInteger(invoiceId) || !(amountCents > 0) || !reference) {
      console.error("[pay] paid session with no usable invoice ref", session.id);
      return res.json({ received: true });
    }

    // Idempotency. Stripe retries until it gets a 2xx, and a retry after a
    // crashed handler must not bill the customer's ledger twice. The
    // transaction id is the natural key — one payment per PaymentIntent.
    const seen = sqlite
      .prepare("SELECT id FROM fin_invoice_payments WHERE reference = ?")
      .get(reference);
    if (seen) return res.json({ received: true });

    let inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    if (!inv || inv.deletedAt != null) {
      console.error("[pay] paid session for a missing invoice", invoiceId, reference);
      return res.json({ received: true });
    }

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
      }, "stripe");
    } catch (e) {
      // 500 so Stripe retries — the idempotency check above makes that safe.
      console.error("[pay] failed to record online payment", reference, e);
      return res.status(500).json({ ok: false });
    }
    res.json({ received: true });
  });
}
