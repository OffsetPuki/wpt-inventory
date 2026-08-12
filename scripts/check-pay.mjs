// Online-invoice-payment check. Seeds an invoice straight into the DB, then
// drives the public endpoints over HTTP so the express.raw mounting, the
// signature verification and the ledger writes are all exercised for real —
// the raw-body wiring in particular is invisible to a unit test and is exactly
// what breaks when body parsers get reordered.
//
//   1. suite running:  DATA_DIR=<throwaway> STRIPE_SECRET_KEY=sk_test_x \
//                      STRIPE_WEBHOOK_SECRET=whsec_testsecret npm run dev
//   2. node scripts/check-pay.mjs [--data-dir <dir>] [--base http://localhost:5000]
//
// Writes a test invoice — point --data-dir at a throwaway DB, never the shop's.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://localhost:5000");
const DATA_DIR = arg("--data-dir", path.resolve(process.cwd(), "data"));
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_testsecret";

const db = new Database(path.join(DATA_DIR, "inventory.db"));
const token = crypto.randomBytes(24).toString("hex");
const number = `TEST-PAY-${Date.now()}`;

// $1,000 + $82.50 tax = $1,082.50, with a $250 deposit and $100 already paid
// in cash. Balance = 1082.50 - 100 = 982.50; deposit still owing = 150.00.
const items = JSON.stringify([{ description: "Test gate", qty: 1, unitPriceCents: 100_000 }]);
db.prepare(`
  INSERT INTO fin_invoices
    (number, client_name, status, items, subtotal_cents, tax_rate_bp, tax_cents,
     total_cents, paid_cents, deposit_cents, share_token, sent_at, issue_date, due_date)
  VALUES (?, 'Test Customer', 'sent', ?, 100000, 825, 8250, 108250, 10000, 25000, ?, ?, '2026-08-11', '2026-09-10')
`).run(number, items, token, Date.now());
const invoiceId = db.prepare("SELECT id FROM fin_invoices WHERE number = ?").get(number).id;

const paymentsFor = (id) =>
  db.prepare("SELECT * FROM fin_invoice_payments WHERE invoice_id = ?").all(id);
const invoiceRow = (id) => db.prepare("SELECT * FROM fin_invoices WHERE id = ?").get(id);

const cleanup = () => {
  db.prepare("DELETE FROM fin_invoice_payments WHERE invoice_id = ?").run(invoiceId);
  db.prepare("DELETE FROM fin_invoices WHERE id = ?").run(invoiceId);
};

// Sign a webhook body the way Stripe does: HMAC-SHA256 over "<ts>.<body>".
function signed(body, { ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) {
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

const sessionEvent = (id, amountCents, which = "balance") =>
  JSON.stringify({
    id: `evt_${id}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${id}`,
        payment_intent: `pi_${id}`,
        payment_status: "paid",
        amount_total: amountCents,
        metadata: { invoiceId: String(invoiceId), invoiceNumber: number, which },
      },
    },
  });

// --via <url> drives the webhook through the WEBSITE's relay instead of hitting
// the suite directly — the path production actually uses, since the suite has
// no public domain for Stripe to call. The relay must not alter a single byte
// or every signature fails, so it is worth exercising for real.
const VIA = arg("--via", "");
const WEBHOOK_URL = VIA
  ? `${VIA.replace(/\/+$/, "")}/api/stripe-webhook`
  : `${BASE}/api/public/stripe/webhook`;

const postWebhook = (body, signature) =>
  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "Stripe-Signature": signature } : {}) },
    body,
  });

let failed = false;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed = true;
    console.error(`  FAIL ${name}\n       ${e.message}`);
  }
};

console.log(`\ncheck-pay — invoice ${number} (id ${invoiceId})`);
console.log(`webhooks via ${VIA ? "the website relay" : "the suite directly"}: ${WEBHOOK_URL}\n`);

await check("the invoice renders, priced from the stored row", async () => {
  const res = await fetch(`${BASE}/api/public/invoice/${token}`);
  assert.equal(res.status, 200);
  const { invoice } = await res.json();
  assert.equal(invoice.number, number);
  assert.equal(invoice.totalCents, 108_250);
  // total - paid. Retainage is zero here.
  assert.equal(invoice.balanceCents, 98_250);
  // deposit 250.00 less the 100.00 already paid, and still under the balance.
  assert.equal(invoice.depositCents, 15_000);
  assert.equal(invoice.payable, true);
});

await check("nothing internal leaks onto the customer's page", async () => {
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${token}`)).json();
  for (const leaked of ["shareToken", "share_token", "notes", "clientId", "leadId", "projectId", "id"]) {
    assert.ok(!(leaked in invoice), `${leaked} must not be sent to the customer`);
  }
});

await check("a bad token is a 404, not a hint", async () => {
  const res = await fetch(`${BASE}/api/public/invoice/${"0".repeat(48)}`);
  assert.equal(res.status, 404);
});

await check("an unsigned webhook is rejected and records nothing", async () => {
  const res = await postWebhook(sessionEvent("nosig", 98_250), undefined);
  assert.equal(res.status, 400);
  assert.equal(paymentsFor(invoiceId).length, 0);
});

await check("a webhook signed with the wrong secret is rejected", async () => {
  const body = sessionEvent("wrongkey", 98_250);
  const res = await postWebhook(body, signed(body, { secret: "whsec_attacker" }));
  assert.equal(res.status, 400);
  assert.equal(paymentsFor(invoiceId).length, 0);
});

await check("a tampered body fails the signature it arrived with", async () => {
  const body = sessionEvent("tamper", 100);
  const signature = signed(body);
  // Same signature, a body that now claims a much larger payment.
  const res = await postWebhook(sessionEvent("tamper", 500_000), signature);
  assert.equal(res.status, 400);
  assert.equal(paymentsFor(invoiceId).length, 0);
});

await check("a replayed old signature is outside the window", async () => {
  const body = sessionEvent("stale", 98_250);
  const ts = Math.floor(Date.now() / 1000) - 3600;
  const res = await postWebhook(body, signed(body, { ts }));
  assert.equal(res.status, 400);
  assert.equal(paymentsFor(invoiceId).length, 0);
});

await check("a properly signed payment lands on the ledger", async () => {
  const body = sessionEvent("good", 15_000, "deposit");
  const res = await postWebhook(body, signed(body));
  assert.equal(res.status, 200);
  const payments = paymentsFor(invoiceId);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount_cents, 15_000);
  assert.equal(payments[0].method, "card");
  assert.equal(payments[0].reference, "pi_good");
  const inv = invoiceRow(invoiceId);
  assert.equal(inv.paid_cents, 25_000);
  assert.equal(inv.status, "partial");
});

await check("Stripe's retry of that same payment is ignored", async () => {
  const body = sessionEvent("good", 15_000, "deposit");
  const res = await postWebhook(body, signed(body));
  assert.equal(res.status, 200);
  assert.equal(paymentsFor(invoiceId).length, 1, "a retried webhook must not double-bill");
  assert.equal(invoiceRow(invoiceId).paid_cents, 25_000);
});

await check("paying the rest settles the invoice", async () => {
  const body = sessionEvent("rest", 83_250);
  const res = await postWebhook(body, signed(body));
  assert.equal(res.status, 200);
  const inv = invoiceRow(invoiceId);
  assert.equal(inv.paid_cents, 108_250);
  assert.equal(inv.status, "paid");
});

// ─── Pay-in-full discount ────────────────────────────────────────────────────
// A second invoice, untouched, so the offer is actually on the table: the
// discount is only for clearing a fresh invoice in one payment.

const token2 = crypto.randomBytes(24).toString("hex");
const number2 = `TEST-FULL-${Date.now()}`;
db.prepare(`
  INSERT INTO fin_invoices
    (number, client_name, status, items, subtotal_cents, tax_rate_bp, tax_cents,
     total_cents, paid_cents, share_token, sent_at, issue_date, due_date)
  VALUES (?, 'Test Customer', 'sent', ?, 100000, 825, 8250, 108250, 0, ?, ?, '2026-08-11', '2026-09-10')
`).run(number2, items, token2, Date.now());
const invoice2Id = db.prepare("SELECT id FROM fin_invoices WHERE number = ?").get(number2).id;

// 6% of the $1,000 subtotal = $60. Tax restated on $940 at 8.25% = $77.55.
// Total $1,017.55 — and 6% off the $1,082.50 gross is the same figure.
const DISCOUNT = 6_000;
const RESTATED_TAX = 7_755;
const DISCOUNTED_TOTAL = 101_755;

const fullEvent = (id, amountCents) =>
  JSON.stringify({
    id: `evt_${id}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${id}`,
        payment_intent: `pi_${id}`,
        payment_status: "paid",
        amount_total: amountCents,
        metadata: { invoiceId: String(invoice2Id), invoiceNumber: number2, which: "full" },
      },
    },
  });

await check("a fresh invoice offers the discount, priced off the subtotal", async () => {
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${token2}`)).json();
  assert.ok(invoice.payInFull, "a fresh unpaid invoice should offer it");
  assert.equal(invoice.payInFull.totalCents, DISCOUNTED_TOTAL);
  assert.equal(invoice.payInFull.savesCents, 108_250 - DISCOUNTED_TOTAL);
  assert.equal(invoice.payInFull.pct, 6);
  // Taking the percentage off the gross lands on the same cent — the order
  // only matters for keeping subtotal − discount + tax = total on the page.
  assert.equal(DISCOUNTED_TOTAL, Math.round(108_250 * 0.94));
});

await check("paying it restates the invoice and settles it", async () => {
  const body = fullEvent("full", DISCOUNTED_TOTAL);
  const res = await postWebhook(body, signed(body));
  assert.equal(res.status, 200);
  const inv = invoiceRow(invoice2Id);
  assert.equal(inv.discount_cents, DISCOUNT);
  assert.equal(inv.tax_cents, RESTATED_TAX, "tax is owed on what was actually paid");
  assert.equal(inv.total_cents, DISCOUNTED_TOTAL);
  assert.equal(inv.paid_cents, DISCOUNTED_TOTAL);
  assert.equal(inv.status, "paid", "the restated total must let the payment settle it");
  // Subtotal is untouched — the line items still say what the work was worth.
  assert.equal(inv.subtotal_cents, 100_000);
  assert.equal(
    inv.subtotal_cents - inv.discount_cents + inv.tax_cents,
    inv.total_cents,
    "the printed ladder has to add up",
  );
});

await check("nothing is left owing anywhere", async () => {
  const inv = invoiceRow(invoice2Id);
  // THE regression guard: every dunning email, AR total and CRM balance in the
  // app is this expression. If a discount ever stops reducing total_cents,
  // this goes positive and the shop starts chasing a customer who paid.
  const balance = inv.total_cents - (inv.retainage_cents ?? 0) - inv.paid_cents;
  assert.equal(balance, 0, "a discounted, fully-paid invoice must owe nothing");
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${token2}`)).json();
  assert.equal(invoice.balanceCents, 0);
  assert.equal(invoice.discountCents, DISCOUNT);
  assert.equal(invoice.payInFull, null, "an offer already taken is not still open");
});

await check("the discount can't be taken twice", async () => {
  const body = fullEvent("full2", DISCOUNTED_TOTAL);
  const res = await postWebhook(body, signed(body));
  assert.equal(res.status, 200);
  const inv = invoiceRow(invoice2Id);
  assert.equal(inv.discount_cents, DISCOUNT, "the discount must not compound");
  assert.equal(inv.total_cents, DISCOUNTED_TOTAL);
});

await check("an invoice with money already on it is never offered the discount", async () => {
  // The first invoice was seeded with $100 paid and has taken payments since —
  // "pay in full at first" no longer applies to it however it's asked.
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${token}`)).json();
  assert.equal(invoice.payInFull, null);
  const res = await fetch(`${BASE}/api/public/invoice/${token}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ which: "full" }),
  });
  // Asking for it anyway must not conjure it — 409 (nothing due, it's settled)
  // rather than a discounted session.
  assert.ok(res.status >= 400, "a stale page asking for 'full' must not be granted it");
});

await check("a settled invoice stops offering to be paid", async () => {
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${token}`)).json();
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.balanceCents, 0);
  assert.equal(invoice.payable, false);
  const res = await fetch(`${BASE}/api/public/invoice/${token}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ which: "balance" }),
  });
  assert.equal(res.status, 409);
});

cleanup();
db.prepare("DELETE FROM fin_invoice_payments WHERE invoice_id = ?").run(invoice2Id);
db.prepare("DELETE FROM fin_invoices WHERE id = ?").run(invoice2Id);
db.close();
console.log(failed ? "\nFAILED\n" : "\nall good\n");
process.exit(failed ? 1 : 0);
