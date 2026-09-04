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
import fs from "node:fs";
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

// Owner-only routes. --pin signs in first (dev seed is Owner/1234); without a
// session those checks FAIL rather than skip — an unexercised rollback on the
// money path is exactly the thing that silently rots.
let ownerAuth;
const ownerToken = async () => {
  if (ownerAuth) return ownerAuth;
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: arg("--user", "Owner"), pin: arg("--pin", "1234") }),
  });
  assert.equal(login.status, 200, "could not sign in — pass --user/--pin");
  ownerAuth = (await login.json()).token;
  assert.ok(ownerAuth, "login returned no token");
  return ownerAuth;
};
const ownerJson = async (method, url, body) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Auth": await ownerToken() },
    body: JSON.stringify(body),
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

// ─── Deposit invoice: pay the slice, or settle the whole job ─────────────────
// A 2,000.00 deposit against a 10,000.00 contract. The deposit is the ask; the
// discount applies to clearing the CONTRACT, never to the deposit itself —
// discounting a deposit cuts the shop's money while the contract price stays
// put, and settles nothing.

const depToken = crypto.randomBytes(24).toString("hex");
const depNum = `TEST-DEP-${Date.now()}`;
const depQuote = db.prepare(
  "INSERT INTO quotes (number, type, customer_name, status, total_cents, payload, created_at) " +
  "VALUES (?, 'fence', 'Test Customer', 'accepted', 1000000, ?, ?)",
).run(`Q-DEP-${Date.now()}`, JSON.stringify({ taxPct: 0 }), Date.now());
db.prepare(`
  INSERT INTO fin_invoices
    (number, client_name, status, items, subtotal_cents, tax_rate_bp, tax_cents,
     total_cents, paid_cents, quote_id, share_token, sent_at)
  VALUES (?, 'Test Customer', 'sent', ?, 200000, 0, 0, 200000, 0, ?, ?, ?)
`).run(depNum, JSON.stringify([{ description: "Deposit — 20% of contract price", qty: 1, unitPriceCents: 200000 }]),
  depQuote.lastInsertRowid, depToken, Date.now());
const depId = db.prepare("SELECT id FROM fin_invoices WHERE number = ?").get(depNum).id;

await check("a deposit invoice offers the deposit AND settling the whole job", async () => {
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${depToken}`)).json();
  // The ask is the deposit, undiscounted.
  assert.equal(invoice.balanceCents, 200_000);
  // The offer beside it is the whole contract at 6% off — measured against the
  // CONTRACT price, never against the deposit.
  assert.ok(invoice.payInFull, "a deposit invoice should offer to settle the job");
  assert.equal(invoice.payInFull.scope, "contract");
  assert.equal(invoice.payInFull.wasCents, 1_000_000);
  assert.equal(invoice.payInFull.totalCents, 940_000);
  assert.equal(invoice.payInFull.savesCents, 60_000);
  // The deposit itself is never the thing being discounted.
  assert.notEqual(invoice.payInFull.totalCents, Math.round(200_000 * 0.94));
});

await check("settling the job grows the invoice without erasing the deposit line", async () => {
  const body = JSON.stringify({
    id: "evt_depfull", type: "checkout.session.completed",
    data: { object: {
      id: "cs_depfull", payment_intent: "pi_depfull", payment_status: "paid",
      amount_total: 940_000,
      metadata: { invoiceId: String(depId), which: "full" },
    } },
  });
  const res = await postWebhook(body, signed(body));
  assert.equal(res.status, 200);
  const inv = invoiceRow(depId);
  assert.equal(inv.paid_cents, 940_000);
  assert.equal(inv.total_cents, 940_000);
  assert.equal(inv.discount_cents, 60_000);
  assert.equal(inv.status, "paid", "paying the contract must settle the invoice");
  assert.equal(inv.total_cents - inv.paid_cents, 0, "nothing may be left owing");

  // THE point of appending: the invoice the customer was SENT said "Deposit —
  // 20% of contract price". That is a record, not a draft, and it survives.
  const items = JSON.parse(inv.items);
  assert.equal(items.length, 2);
  assert.match(items[0].description, /^Deposit/, "the billed deposit line must survive");
  assert.equal(items[0].unitPriceCents, 200_000);
  assert.match(items[1].description, /^Balance of contract/);
  // The two lines are the deposit and the balance the invoice already quoted.
  assert.equal(items[1].unitPriceCents, 800_000);
  assert.equal(items[0].unitPriceCents + items[1].unitPriceCents, inv.subtotal_cents);
  assert.equal(
    inv.subtotal_cents - inv.discount_cents + inv.tax_cents,
    inv.total_cents,
    "the printed ladder has to add up",
  );
  assert.ok(inv.restated_from, "the pre-restatement figures must be kept");
});

await check("reversing that payment puts the deposit invoice back", async () => {
  // A bounced card or a cancelled job. Without this the invoice would sit
  // unpaid at 940,000 having silently kept a 60,000 discount it never earned.
  const pay = db.prepare("SELECT id FROM fin_invoice_payments WHERE invoice_id = ?").get(depId);
  const res = await fetch(`${BASE}/api/finance/payments/${pay.id}`, {
    method: "DELETE",
    headers: { "X-Auth": await ownerToken() },
  });
  assert.equal(res.status, 200, await res.text());

  const inv = invoiceRow(depId);
  assert.equal(inv.paid_cents, 0);
  assert.equal(inv.total_cents, 200_000, "back to the deposit it billed");
  assert.equal(inv.discount_cents, null, "the discount must not survive the reversal");
  assert.equal(inv.restated_from, null);
  const items = JSON.parse(inv.items);
  assert.equal(items.length, 1, "the appended balance line must be gone");
  assert.match(items[0].description, /^Deposit/);
  assert.equal(inv.status, "sent", "an unpaid, already-sent invoice is 'sent'");
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

// ─── Billing the balance ─────────────────────────────────────────────────────
// The rest of the same contract, billed after the deposit. Once two invoices
// share a quote neither may offer "settle the whole job" — the customer already
// declined it on the deposit, and the balance is not the whole job.

const balToken = crypto.randomBytes(24).toString("hex");
const balNum = `TEST-BAL-${Date.now()}`;
db.prepare(`
  INSERT INTO fin_invoices
    (number, client_name, status, items, subtotal_cents, tax_rate_bp, tax_cents,
     total_cents, paid_cents, quote_id, share_token, sent_at, kind)
  VALUES (?, 'Test Customer', 'sent', ?, 800000, 0, 0, 800000, 0, ?, ?, ?, 'balance')
`).run(balNum, JSON.stringify([{ description: "Balance of contract — less 20% deposit of $2000.00", qty: 1, unitPriceCents: 800000 }]),
  depQuote.lastInsertRowid, balToken, Date.now());
const balId = db.prepare("SELECT id FROM fin_invoices WHERE number = ?").get(balNum).id;

await check("the balance invoice after a deposit offers no pay-in-full and reports the deposit as prior", async () => {
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${balToken}`)).json();
  assert.equal(invoice.payInFull, null, "the balance is not the whole job");
  assert.equal(invoice.quote.priorCents, 200_000, "the deposit is what was billed before");
  assert.equal(invoice.balanceCents, 800_000);
  assert.equal(invoice.kind, "balance", "the page is told which button made the bill");
  // The deposit invoice (back to 'sent' after the reversal) loses the offer too.
  const dep = (await (await fetch(`${BASE}/api/public/invoice/${depToken}`)).json()).invoice;
  assert.equal(dep.payInFull, null, "another invoice bills the same quote");
});

await check("a balance invoice stays a balance invoice even when the deposit was never issued here", async () => {
  // The deposit taken in cash, or its invoice still a draft: the balance bill
  // still says what it is, so no "settle the whole job" and the deposit is
  // still netted out of the contract price on the page.
  db.prepare("UPDATE fin_invoices SET status = 'draft' WHERE id = ?").run(depId);
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${balToken}`)).json();
  assert.equal(invoice.payInFull, null, "kind = balance is enough on its own");
  assert.equal(invoice.quote.priorCents, 200_000, "contract less this bill = the deposit");
  db.prepare("UPDATE fin_invoices SET status = 'sent' WHERE id = ?").run(depId);
});

// ─── Owner discounts ─────────────────────────────────────────────────────────
let discId = null;
let uploaded = null;

await check("the owner can give a percentage discount and the ladder adds up", async () => {
  const created = await ownerJson("POST", "/api/finance/invoices", {
    clientName: "Test Customer",
    items: [{ description: "Gate", qty: 1, unitPriceCents: 100_000 }],
    taxRateBp: 825,
    discountPct: 10,
  });
  const createdText = await created.text();
  assert.equal(created.status, 201, createdText);
  discId = JSON.parse(createdText).id;
  let inv = invoiceRow(discId);
  assert.equal(inv.subtotal_cents, 100_000);
  assert.equal(inv.discount_cents, 10_000);
  // Tax is owed on what is actually charged: 8.25% of 900.00.
  assert.equal(inv.tax_cents, 7_425);
  assert.equal(inv.total_cents, 97_425);

  let res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, { discountCents: 2_500 });
  assert.equal(res.status, 200, await res.text());
  inv = invoiceRow(discId);
  assert.equal(inv.discount_cents, 2_500);
  assert.equal(inv.tax_cents, 8_044, "round(97500 × 0.0825) = 8043.75 → 8044");
  assert.equal(inv.total_cents, 105_544);

  res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, { discountCents: 0 });
  assert.equal(res.status, 200, await res.text());
  inv = invoiceRow(discId);
  assert.equal(inv.discount_cents, null, "zero is stored as no discount");
  assert.equal(inv.total_cents, 108_250);

  res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, { discountPct: 150 });
  assert.equal(res.status, 400, "more than 100% off is not a discount");
});

await check("a negative line is a discount, and a bill can't go below zero", async () => {
  // The owner's other way to write a discount: a "-300" line among the others.
  let res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, {
    items: [
      { description: "Gate", qty: 1, unitPriceCents: 100_000 },
      { description: "Discount — referral", qty: 1, unitPriceCents: -30_000 },
    ],
  });
  assert.equal(res.status, 200, await res.text());
  let inv = invoiceRow(discId);
  assert.equal(inv.subtotal_cents, 70_000, "the credit nets against the other lines");
  assert.equal(inv.tax_cents, 5_775, "tax on what's left: 8.25% of 700.00");
  assert.equal(inv.total_cents, 75_775);

  // A credit bigger than the bill is a refund, not an invoice.
  res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, {
    items: [
      { description: "Gate", qty: 1, unitPriceCents: 100_000 },
      { description: "Credit", qty: 1, unitPriceCents: -200_000 },
    ],
  });
  assert.equal(res.status, 400, "lines netting below zero must be refused");
  assert.equal(invoiceRow(discId).total_cents, 75_775, "a refused edit changes nothing");

  res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, {
    items: [{ description: "Gate", qty: 1, unitPriceCents: 100_000 }],
  });
  assert.equal(res.status, 200, await res.text());
  assert.equal(invoiceRow(discId).total_cents, 108_250);
});

// ─── Attachments ─────────────────────────────────────────────────────────────
const discToken = crypto.randomBytes(24).toString("hex");

await check("an invoice can carry attachments and the customer can fetch them by token only", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%%EOF\n")], { type: "application/pdf" }), "Signed contract.pdf");
  const up = await fetch(`${BASE}/api/finance/attachments`, {
    method: "POST",
    headers: { "X-Auth": await ownerToken() },
    body: fd,
  });
  const upText = await up.text();
  assert.equal(up.status, 201, upText);
  const { file, name, size } = JSON.parse(upText);
  assert.match(file, /^\d+-[0-9a-f]{32}\.pdf$/, "the disk name is random, never the customer's");
  assert.equal(name, "Signed contract.pdf");
  assert.equal(size, 15);
  uploaded = file;

  let res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, { attachments: [{ name: "Signed contract.pdf", file }] });
  assert.equal(res.status, 200, await res.text());
  res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, { attachments: [{ name: "x", file: "../../etc/passwd" }] });
  assert.equal(res.status, 400, "a path is not an upload name");

  db.prepare("UPDATE fin_invoices SET share_token = ?, status = 'sent', sent_at = ? WHERE id = ?")
    .run(discToken, Date.now(), discId);
  const { invoice } = await (await fetch(`${BASE}/api/public/invoice/${discToken}`)).json();
  assert.deepEqual(invoice.attachments, [{ name: "Signed contract.pdf", index: 0 }]);
  assert.ok(!JSON.stringify(invoice).includes(file), "the disk filename must never reach the customer");

  res = await fetch(`${BASE}/api/public/invoice/${discToken}/file/0`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").startsWith("application/pdf"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await res.arrayBuffer()).toString("latin1").startsWith("%PDF"));
  assert.equal((await fetch(`${BASE}/api/public/invoice/${discToken}/file/1`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/public/invoice/${"0".repeat(48)}/file/0`)).status, 404);

  // The owner's copy needs a session; without one it is not a 200 of any kind.
  res = await fetch(`${BASE}/api/finance/invoices/${discId}/file/0`, { headers: { "X-Auth": await ownerToken() } });
  assert.equal(res.status, 200);
  res = await fetch(`${BASE}/api/finance/invoices/${discId}/file/0`);
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

await check("a draft's attachment is only reachable with the preview flag", async () => {
  db.prepare("UPDATE fin_invoices SET status = 'draft' WHERE id = ?").run(discId);
  assert.equal((await fetch(`${BASE}/api/public/invoice/${discToken}/file/0`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/public/invoice/${discToken}/file/0?preview=1`)).status, 200);
  db.prepare("UPDATE fin_invoices SET status = 'sent' WHERE id = ?").run(discId);
});

await check("the owner's own wording reaches the customer, and blank means the default", async () => {
  let res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, {
    customerNote: "  Half now, half at install — {contract} total.  ",
    terms: "Line A\n\n  Line B  \n",
  });
  assert.equal(res.status, 200, await res.text());
  let { invoice } = await (await fetch(`${BASE}/api/public/invoice/${discToken}`)).json();
  assert.equal(invoice.customerNote, "Half now, half at install — {contract} total.");
  assert.deepEqual(invoice.terms, ["Line A", "Line B"], "one term per line, blanks dropped");

  res = await ownerJson("PATCH", `/api/finance/invoices/${discId}`, { customerNote: null, terms: "" });
  assert.equal(res.status, 200, await res.text());
  ({ invoice } = await (await fetch(`${BASE}/api/public/invoice/${discToken}`)).json());
  assert.equal(invoice.customerNote, null, "blank = the page's own wording");
  assert.equal(invoice.terms, null);
});

// ─── The owner's pre-send preview ────────────────────────────────────────────
// A draft carries a share token only because the owner asked to proof it. It
// must stay invisible without ?preview=1, and must never be chargeable — the
// bill hasn't been issued.
const draftToken = crypto.randomBytes(24).toString("hex");
const draftNum = `TEST-DRAFT-${Date.now()}`;
db.prepare(`
  INSERT INTO fin_invoices
    (number, client_name, status, items, subtotal_cents, tax_rate_bp, tax_cents,
     total_cents, paid_cents, share_token, issue_date)
  VALUES (?, 'Test Customer', 'draft', ?, 50000, 0, 0, 50000, 0, ?, '2026-08-12')
`).run(draftNum, JSON.stringify([{ description: "Draft gate", qty: 1, unitPriceCents: 50000 }]), draftToken);
const draftId = db.prepare("SELECT id FROM fin_invoices WHERE number = ?").get(draftNum).id;

await check("a draft stays invisible without the preview flag", async () => {
  const res = await fetch(`${BASE}/api/public/invoice/${draftToken}`);
  assert.equal(res.status, 404);
});

await check("the owner's preview renders the draft, unpayable", async () => {
  const res = await fetch(`${BASE}/api/public/invoice/${draftToken}?preview=1`);
  assert.equal(res.status, 200);
  const { invoice } = await res.json();
  assert.equal(invoice.number, draftNum);
  assert.equal(invoice.status, "draft");
  // Stripe is configured in this run, and 500.00 clears its floor — so only the
  // draft status can be what's holding the Pay button back.
  assert.equal(invoice.payable, false);
});

await check("a draft cannot be charged for, preview flag or not", async () => {
  for (const url of [
    `${BASE}/api/public/invoice/${draftToken}/checkout`,
    `${BASE}/api/public/invoice/${draftToken}/checkout?preview=1`,
  ]) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ which: "balance" }),
    });
    assert.equal(res.status, 404, `${url} must not open checkout on an unissued bill`);
  }
});

cleanup();
db.prepare("DELETE FROM fin_invoices WHERE id = ?").run(draftId);
for (const id of [invoice2Id, depId, balId, discId]) {
  db.prepare("DELETE FROM fin_invoice_payments WHERE invoice_id = ?").run(id);
  db.prepare("DELETE FROM fin_invoices WHERE id = ?").run(id);
}
db.prepare("DELETE FROM quotes WHERE id = ?").run(depQuote.lastInsertRowid);
// The suite leaves attachment files on disk when an invoice is deleted; the
// test's upload is ours to remove.
if (uploaded) fs.rmSync(path.join(DATA_DIR, "uploads", path.basename(uploaded)), { force: true });
db.close();
console.log(failed ? "\nFAILED\n" : "\nall good\n");
process.exit(failed ? 1 : 0);
