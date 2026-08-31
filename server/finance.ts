import type { Express, Request } from "express";
import type { z } from "zod";
import crypto from "crypto";
import { eq, and, or, desc, isNull, inArray, sql } from "drizzle-orm";
import { sqlite, db } from "./storage";
import { auditQuiet as audit } from "./audit";
import { requireElevated } from "./auth";
import { mailEnabled, sendMail, isOptedOut } from "./mailer";
import { renderTemplate, firstNameOf, shopBrand } from "./email-templates";
import {
  invoices, invoicePayments, expenses, purchaseOrders,
  finSettings,
  insertInvoiceSchema, insertInvoicePaymentSchema, insertExpenseSchema,
  insertPurchaseOrderSchema,
  updateFinSettingsSchema, pullUnbilledSchema, retainagePctSchema,
  EXPENSE_CATEGORY_LABELS,
  type Invoice, type InvoiceStatus, type Expense, type PurchaseOrder,
} from "../shared/finance-schema";
import { clients } from "../shared/crm-schema";
import { projects } from "../shared/schema";
// Phase B #9: automated customer emails land on the CRM timeline. The helper
// is deferred + try/catch'd internally — safe to call from any mail hook.
// clientNameById: crm owns crm_clients; try/catch'd internally too.
import { logEmailActivity, clientNameById } from "./crm";
// Contract-vs-invoiced reconciliation (Phase A #3) + approved change orders
// (Phase G #1) + review-request tasks (Package C: tasks live on the pm
// board). Table objects only — the pm module owns the DDL, so the touches
// below are try/catch'd.
import { contracts, changeOrders, pmTasks } from "../shared/pm-schema";
// Cross-module automation hook: a freshly paid invoice queues a review request.
// mk_settings is owned by the marketing module's DDL; every touch below is
// deferred + try/catch'd so a marketing hiccup can't break payment recording.
import { marketingSettings } from "../shared/marketing-schema";
import { parseLineItems, computeDocTotals } from "../shared/biz-common";
import { pid, qstr, todayLocal, ymdLocal, usd, registerSoftDelete, registerCreate } from "./http-util";

// ─── Table creation (synchronous DDL) ────────────────────────────────────────
// Mirrors shared/finance-schema.ts exactly. client_id / estimate_id are soft
// references into the CRM module — no REFERENCES clause, so this module never
// depends on crm.ts having created its tables first. project_id points at the
// core projects table, which storage.ts guarantees exists before we get here.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS fin_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    client_id INTEGER,
    client_name TEXT,
    estimate_id INTEGER,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    issue_date TEXT,
    due_date TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_rate_bp INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    paid_cents INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fin_invoices_client ON fin_invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_fin_invoices_project ON fin_invoices(project_id);
  CREATE INDEX IF NOT EXISTS idx_fin_invoices_status ON fin_invoices(status);
  CREATE INDEX IF NOT EXISTS idx_fin_invoices_due ON fin_invoices(due_date);
  CREATE INDEX IF NOT EXISTS idx_fin_invoices_created ON fin_invoices(created_at);

  CREATE TABLE IF NOT EXISTS fin_invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'other',
    gateway_key TEXT,
    reference TEXT,
    paid_at TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_fin_payments_invoice ON fin_invoice_payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_fin_payments_created ON fin_invoice_payments(created_at);

  CREATE TABLE IF NOT EXISTS fin_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    vendor TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'card',
    receipt_url TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    billable INTEGER NOT NULL DEFAULT 0,
    -- "Billed on" stamp (wiring plan, Fix 4) — soft ref to fin_invoices.id.
    invoice_id INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fin_expenses_date ON fin_expenses(date);
  CREATE INDEX IF NOT EXISTS idx_fin_expenses_category ON fin_expenses(category);
  CREATE INDEX IF NOT EXISTS idx_fin_expenses_project ON fin_expenses(project_id);
  CREATE INDEX IF NOT EXISTS idx_fin_expenses_created ON fin_expenses(created_at);

  CREATE TABLE IF NOT EXISTS fin_purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    vendor TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    items TEXT NOT NULL DEFAULT '[]',
    total_cents INTEGER NOT NULL DEFAULT 0,
    expected_date TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fin_po_status ON fin_purchase_orders(status);
  CREATE INDEX IF NOT EXISTS idx_fin_po_project ON fin_purchase_orders(project_id);
  CREATE INDEX IF NOT EXISTS idx_fin_po_created ON fin_purchase_orders(created_at);
`);

// Additive migrations: columns that arrived after installs existed. The throw
// on re-run is expected. deposit_cents / lead_id are Phase A (findings 2 & 6) —
// lead_id is a soft ref into crm_leads, same stance as projects.client_id.
for (const ddl of [
  "ALTER TABLE fin_expenses ADD COLUMN invoice_id INTEGER",
  "ALTER TABLE fin_invoices ADD COLUMN deposit_cents INTEGER",
  "ALTER TABLE fin_invoices ADD COLUMN lead_id INTEGER",
  // Phase G #3: commercial retainage — see shared/finance-schema.ts.
  "ALTER TABLE fin_invoices ADD COLUMN retainage_cents INTEGER",
  "ALTER TABLE fin_invoices ADD COLUMN retainage_released_at INTEGER",
  // Online payment: the customer's /invoice/<token> page (server/pay.ts).
  "ALTER TABLE fin_invoices ADD COLUMN share_token TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_invoices_share ON fin_invoices(share_token)",
  "ALTER TABLE fin_invoices ADD COLUMN discount_cents INTEGER",
  // The quote this invoice bills against — see shared/finance-schema.ts.
  "ALTER TABLE fin_invoices ADD COLUMN quote_id INTEGER",
  "ALTER TABLE fin_invoices ADD COLUMN restated_from TEXT",
  "CREATE INDEX IF NOT EXISTS idx_fin_invoices_quote ON fin_invoices(quote_id)",
  // NOTE: fin_settings is created BELOW, so its own migration lives after it —
  // an ALTER here would silently no-op on a fresh install and the column would
  // never exist.
]) {
  try {
    sqlite.exec(ddl);
  } catch {
    /* column already exists */
  }
}
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_fin_expenses_invoice ON fin_expenses(invoice_id);

  -- Finance knobs singleton (wiring plan, Fix 4): markup basis points for
  -- pulling unbilled labor / expenses onto an invoice.
  CREATE TABLE IF NOT EXISTS fin_settings (
    id INTEGER PRIMARY KEY,
    labor_markup_bp INTEGER NOT NULL DEFAULT 0,
    expense_markup_bp INTEGER NOT NULL DEFAULT 0,
    -- Prompt-payment discount for clearing an invoice online in one payment
    -- (server/pay.ts). 600 = 6%; 0 stops offering it.
    payinfull_discount_bp INTEGER NOT NULL DEFAULT 600,
    updated_at INTEGER
  );
`);
// Same column onto installs that predate it. Must follow the CREATE above.
try {
  sqlite.exec("ALTER TABLE fin_settings ADD COLUMN payinfull_discount_bp INTEGER NOT NULL DEFAULT 600");
} catch {
  /* column already exists */
}
sqlite.exec("INSERT OR IGNORE INTO fin_settings (id) VALUES (1)");

// Package D: the 5-status PO lifecycle collapsed to open/received/cancelled,
// and the payment-gateway registry is gone (method 'gateway' → 'other'; the
// reference field still carries the transaction id). Idempotent remaps.
try {
  sqlite.exec(`
    UPDATE fin_purchase_orders SET status = 'open' WHERE status IN ('draft', 'sent');
    UPDATE fin_purchase_orders SET status = 'received' WHERE status = 'closed';
    UPDATE fin_invoice_payments SET method = 'other' WHERE method = 'gateway';
  `);
} catch { /* nothing to migrate */ }

// ─── Helpers ─────────────────────────────────────────────────────────────────
// `todayLocal` (local calendar date) lives in ./http-util — invoices/expenses
// are dated in the shop's timezone, not UTC, so "overdue" flips at local
// midnight like the owner expects.

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Server-computed totals (shared/biz-common). `clampTax` floors a negative tax
// rate at zero — a negative rate would refund tax against the subtotal — as a
// backstop even though the schema also rejects it now.
function computeTotals(itemsJson: string, taxRateBp: number) {
  return computeDocTotals(itemsJson, taxRateBp, { clampTax: true });
}

// "overdue" is derived, never stored: a sent/partial invoice past its due date
// reports as overdue, but the stored status stays untouched so a payment (or a
// due-date extension) snaps it back without any sweep job.
function derivedStatus(inv: Invoice, today: string): InvoiceStatus {
  if ((inv.status === "sent" || inv.status === "partial") && inv.dueDate && inv.dueDate < today) {
    return "overdue";
  }
  return inv.status;
}

// Phase G #3 — revenue honesty: retainage stays part of totalCents (it IS
// earned revenue), so income/reports/margin never shrink. It only reduces the
// DUE-NOW balance: balance = total − retainage − paid. The subtraction sticks
// after release too — the "Bill retainage" release invoice owns collecting it,
// so counting it due on the source again would double-dun the customer (spec
// said unreleased-only; deviated to avoid the double-count — the project
// summary compensates by netting released retainage out of invoicedCents).
const retainageOf = (inv: Invoice): number => inv.retainageCents ?? 0;

// Retainage still HELD on an invoice — i.e. what "Bill retainage" would
// collect: unreleased, on an issued (non-draft, non-void) invoice, capped at
// what's actually uncollected so a GC that paid the full total holds $0.
const HELD_STATUSES = new Set<InvoiceStatus>(["sent", "partial", "paid", "overdue"]);
function heldRetainageOf(inv: Invoice): number {
  if (inv.retainageReleasedAt != null || !HELD_STATUSES.has(inv.status)) return 0;
  return Math.min(retainageOf(inv), Math.max(0, inv.totalCents - inv.paidCents));
}

export function presentInvoice(inv: Invoice, today: string) {
  return {
    ...inv,
    status: derivedStatus(inv, today),
    balanceCents: inv.totalCents - retainageOf(inv) - inv.paidCents,
    // The customer's page, once it exists — the UI offers it to copy, and the
    // site's domain is the server's to know, not the browser's to hardcode.
    payUrl: invoicePayLink(inv),
  };
}

// Document numbers: PREFIX-<year>-<4-digit seq>. Seq defaults to max(id)+1,
// which only ever grows, so numbers never reuse after a delete; callers whose
// row ids and issued numbers came apart (quotes.ts) pass their own `seed`.
// The UNIQUE constraint on `number` is the arbiter under concurrency — on
// conflict we bump the seq and retry (bounded, so a pathological table can't
// spin forever).
export function insertNumbered<T>(
  table: string,
  prefix: string,
  doInsert: (num: string) => T,
  opts: { seed?: () => number; attempts?: number } = {},
): T {
  const base = opts.seed
    ? opts.seed()
    : (sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`).get() as { m: number }).m + 1;
  const year = new Date().getFullYear();
  const attempts = opts.attempts ?? 25;
  for (let i = 0; i < attempts; i++) {
    const num = `${prefix}-${year}-${String(base + i).padStart(4, "0")}`;
    try {
      return doInsert(num);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("UNIQUE")) continue;
      throw e;
    }
  }
  throw new Error(`Could not allocate a unique ${prefix} number`);
}

// Cross-module reads into CRM (`clientNameById` is imported from crm.ts —
// same degrade-to-null stance). If that module isn't wired yet these queries
// would throw "no such table", so they fall back instead of 500ing the page.
function allClientNames(): Map<number, string> {
  try {
    return new Map(
      db.select({ id: clients.id, name: clients.name }).from(clients).all().map((r) => [r.id, r.name])
    );
  } catch {
    return new Map();
  }
}

// Statuses that represent money still owed to us (draft/void owe nothing,
// paid is settled). Stored "overdue" is included for rows a user set manually.
const RECEIVABLE_STATUSES: InvoiceStatus[] = ["sent", "partial", "overdue"];

function paymentCountFor(invoiceId: number): number {
  return db.select({ c: sql<number>`COUNT(*)` })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId))
    .get()?.c ?? 0;
}

function getInvoice(id: number): Invoice | undefined {
  return db.select().from(invoices)
    .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)))
    .get();
}

// ─── Review-request automation ───────────────────────────────────────────────
// The moment an invoice is settled is the best moment to ask for a review.
// Called from both places the paid/partial derivation runs (recording a
// payment, and reversing one — which can also re-land on "paid"). Everything
// happens in setImmediate + try/catch: recording money must NEVER fail or
// slow down because a marketing nicety hiccuped.

const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://www.cjmmetals.com";

function queueReviewRequest(inv: Invoice): void {
  setImmediate(async () => {
    try {
      // Owner opt-out lives in mk_settings; a missing row/table means default on.
      const cfg = db.select({ on: marketingSettings.autoReviewRequest })
        .from(marketingSettings).where(eq(marketingSettings.id, 1)).get();
      if (cfg && !cfg.on) return;
      // One ask per invoice, ever — a void/reissue or payment reversal dance
      // must not spam the customer.
      const existing = sqlite.prepare(
        "SELECT id FROM review_requests WHERE invoice_id = ?",
      ).get(inv.id);
      if (existing) return;

      const client = inv.clientId != null
        ? db.select({ name: clients.name, email: clients.email }).from(clients)
            .where(eq(clients.id, inv.clientId)).get()
        : undefined;
      const name = client?.name ?? inv.clientName ?? null;
      const email = client?.email ?? null;

      // Phase B #12: tie the invitation to the customer — clientId straight
      // off the invoice; leadId from the Phase A stamp, else the client's most
      // recent won lead (crm table → try/catch, degrades to NULL).
      let leadId: number | null = inv.leadId ?? null;
      if (leadId == null && inv.clientId != null) {
        try {
          leadId = (sqlite.prepare(`
            SELECT id FROM crm_leads
            WHERE deleted_at IS NULL AND client_id = ? AND stage = 'won'
            ORDER BY created_at DESC, id DESC LIMIT 1
          `).get(inv.clientId) as { id: number } | undefined)?.id ?? null;
        } catch { /* crm module absent */ }
      }

      const token = crypto.randomBytes(24).toString("hex");
      const inserted = sqlite.prepare(`
        INSERT INTO review_requests (token, name, email, invoice_id, client_id, lead_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(token, name, email, inv.id, inv.clientId ?? null, leadId);

      if (mailEnabled() && email && !isOptedOut(email)) {
        const first = firstNameOf(name);
        // Wording is owner-editable in the Emails section.
        const msg = renderTemplate("review.request", {
          firstName: first,
          reviewUrl: `${PUBLIC_SITE_URL}/review/${token}`,
        });
        const ok = msg ? await sendMail({ to: email, ...msg }) : false;
        if (ok) {
          sqlite.prepare("UPDATE review_requests SET sent_at = ? WHERE id = ?")
            .run(Date.now(), inserted.lastInsertRowid);
          logEmailActivity({
            clientId: inv.clientId, leadId,
            subject: `Review request after ${inv.number} was paid`,
          });
        }
      }

      // Always surface the ask in-app too — with no email on file (or no
      // mailer) the task is the only prompt the owner gets.
      db.insert(pmTasks).values({
        title: `Ask ${name ?? `the customer on ${inv.number}`} for a review`,
        kind: "review_request",
        leadId,
        autoCreated: true,
        dueDate: todayLocal(),
        description: `Invoice ${inv.number} paid.`,
      }).run();
    } catch (e) {
      console.error("[finance] review-request hook failed", e);
    }
  });
}

// ─── Payment receipt email ───────────────────────────────────────────────────
// Confirms the money landed the moment it's recorded. Same contract as the
// review hook: everything deferred + try/catch'd, so recording a payment can
// never fail or slow down because mail hiccuped. Skips silently with no
// mailer or no client email on file. (`usd` — cents → "$x.xx" — lives in
// ./http-util.)

function queuePaymentReceipt(inv: Invoice, amountCents: number): void {
  setImmediate(async () => {
    try {
      if (!mailEnabled() || inv.clientId == null) return;
      const client = db.select({ name: clients.name, email: clients.email })
        .from(clients).where(eq(clients.id, inv.clientId)).get();
      if (!client?.email) return;

      const first = firstNameOf(client.name ?? inv.clientName);
      const balanceCents = inv.totalCents - retainageOf(inv) - inv.paidCents;
      // Two templates rather than one with a conditional sentence: the owner
      // edits "still owes us" and "paid in full" as the different notes they
      // are. Wording lives in the Emails section.
      const msg = renderTemplate(
        balanceCents > 0 ? "payment.receipt.partial" : "payment.receipt.final",
        {
          firstName: first,
          amount: usd(amountCents),
          invoiceNumber: inv.number,
          balance: usd(balanceCents),
        },
      );
      const ok = msg ? await sendMail({ to: client.email, ...msg }) : false;
      // Phase B #9: receipt on the timeline.
      if (ok) {
        logEmailActivity({
          clientId: inv.clientId, leadId: inv.leadId,
          subject: `Payment receipt — ${usd(amountCents)} received on ${inv.number}`,
        });
      }
    } catch (e) {
      console.error("[finance] payment-receipt hook failed", e);
    }
  });
}

// ─── The customer's invoice link ─────────────────────────────────────────────
// Same address the quote share uses, so both documents live on the website
// under the shop's own domain. Token is minted at the first send (see the
// status PATCH) and never rotated — a link already in an inbox stays live.

// A draft carries a token only because the owner asked to proof it, and the
// public page refuses a draft without ?preview=1 — so the flag rides along or
// the owner's own link 404s at them. The send hook emails the UPDATED row
// (status "sent"), so a customer's link never carries it.
export const invoicePayLink = (inv: Invoice): string | null =>
  inv.shareToken
    ? `${PUBLIC_SITE_URL}/invoice/${inv.shareToken}${inv.status === "draft" ? "?preview=1" : ""}`
    : null;

// The prompt-payment discount rate in basis points (Finance → Billing markups).
// server/pay.ts owns granting it; this is here so the invoice email can offer
// it. 0 = the offer is off.
export function payInFullDiscountBp(): number {
  const row = sqlite.prepare("SELECT payinfull_discount_bp AS bp FROM fin_settings WHERE id = 1")
    .get() as { bp?: number } | undefined;
  const bp = Number(row?.bp);
  return Number.isFinite(bp) && bp > 0 ? Math.min(bp, 5000) : 0;
}

// ─── Invoice "sent" → email the customer (Phase A #1) ────────────────────────
// The invoice itself, the moment it goes out — before this the customer's
// first contact about a bill was the overdue chaser. Same contract as the
// receipt hook: deferred + try/catch, skips silently with no mailer/address.

// Who this invoice's email would go to, or null if there is nobody to send to.
// Cheap and synchronous, so the PATCH route can tell the client what is about
// to happen: "Mark sent" used to report a flat "Invoice marked sent" whether or
// not an address existed, and a customer with no email on file simply never
// heard from us until the overdue chaser — by which time the due date had
// already passed and the money had sat unasked-for for the whole window.
export function invoiceRecipient(inv: Invoice): string | null {
  const client = inv.clientId != null
    ? db.select({ name: clients.name, email: clients.email })
        .from(clients).where(eq(clients.id, inv.clientId)).get()
    : undefined;
  // Fallback: any email typed into the invoice notes (unlinked clients).
  return client?.email
    || (inv.notes ?? "").match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/)?.[0]
    || null;
}

function queueInvoiceEmail(inv: Invoice): void {
  setImmediate(async () => {
    try {
      if (!mailEnabled()) return;
      const client = inv.clientId != null
        ? db.select({ name: clients.name, email: clients.email })
            .from(clients).where(eq(clients.id, inv.clientId)).get()
        : undefined;
      const to = invoiceRecipient(inv);
      if (!to) return;

      const first = firstNameOf(client?.name ?? inv.clientName);
      const lines = parseLineItems(inv.items).map((it) =>
        `  - ${it.description} — ${it.qty} × ${usd(it.unitPriceCents)} = ${usd(Math.round(it.qty * it.unitPriceCents))}`);

      // Shop identity — the same quote_settings singleton the shared quote
      // page renders; a missing table/row degrades to the stock signature.
      let shopBlock = `${shopBrand()} · Arlington, TX`;
      try {
        const row = sqlite.prepare("SELECT shop FROM quote_settings WHERE id = 1")
          .get() as { shop?: string } | undefined;
        const shop = row?.shop ? JSON.parse(row.shop) : null;
        if (shop?.name) {
          shopBlock = [shop.name, shop.location, shop.phone, shop.email]
            .filter(Boolean).join(" · ");
        }
      } catch { /* quote module absent — stock signature */ }

      // The pay link, when there is one — the invoice page carries the Pay
      // button (card / Apple Pay / Google Pay). Without a token the email is
      // exactly what it always was, so nothing here depends on Stripe.
      const payUrl = invoicePayLink(inv);
      // The prompt-payment offer, worded from this invoice's own numbers. An
      // incentive nobody is told about doesn't incentivise anything — this is
      // the one place the customer reliably reads before deciding how to pay.
      const discountBp = payUrl ? payInFullDiscountBp() : 0;
      const savesCents = discountBp > 0 && inv.paidCents === 0 && retainageOf(inv) === 0
        ? Math.round((inv.totalCents * discountBp) / 10_000)
        : 0;

      const ok = await sendMail({
        to,
        subject: `Invoice ${inv.number} from ${shopBrand()}${inv.dueDate ? ` — due ${inv.dueDate}` : ""}`,
        text:
          `Hi ${first},\n\n` +
          `Here's your invoice ${inv.number}:\n\n` +
          (lines.length ? `${lines.join("\n")}\n\n` : "") +
          `Total:       ${usd(inv.totalCents)}\n` +
          (retainageOf(inv) > 0 ? `Retainage withheld: -${usd(retainageOf(inv))}\n` : "") +
          (inv.paidCents > 0 ? `Paid so far: ${usd(inv.paidCents)}\n` : "") +
          `Balance due: ${usd(inv.totalCents - retainageOf(inv) - inv.paidCents)}\n` +
          ((inv.depositCents ?? 0) > 0 ? `Deposit due: ${usd(inv.depositCents!)}\n` : "") +
          (inv.dueDate ? `Due date:    ${inv.dueDate}\n` : "") +
          (payUrl ? `\nView it online and pay by card, Apple Pay or Google Pay:\n${payUrl}\n` : "") +
          (savesCents > 0
            ? `\nPay the whole invoice online in one payment and take ${discountBp / 100}% off — `
              + `${usd(inv.totalCents - savesCents)} instead of ${usd(inv.totalCents)}, `
              + `a saving of ${usd(savesCents)}.\n`
            : "") +
          `\nQuestions? Just reply to this email or give us a call.\n\n` +
          `— ${shopBlock}`,
      });
      // Phase B #9: the invoice email on the timeline.
      if (ok) {
        logEmailActivity({
          clientId: inv.clientId, leadId: inv.leadId, email: to,
          subject: `Invoice ${inv.number} sent — ${usd(inv.totalCents - retainageOf(inv) - inv.paidCents)} due`,
        });
      }
    } catch (e) {
      console.error("[finance] invoice-sent email hook failed", e);
    }
  });
}

// ─── PO received → materials expense (Phase A #4) ────────────────────────────
// Material spend on a received PO lands in fin_expenses so project margin,
// quoted-vs-actual and monthly totals see it. Not billable — the job's quote
// already prices the materials, and billable=1 would double-bill via
// pull-unbilled. Deduped by the auto: key in notes (postPayrollExpense style).

function queuePoExpense(req: Request, po: PurchaseOrder): void {
  setImmediate(() => {
    try {
      if (po.totalCents <= 0) return;
      const dupe = sqlite.prepare(
        "SELECT id FROM fin_expenses WHERE deleted_at IS NULL AND notes LIKE ?",
      ).get(`%auto:po:${po.id};%`);
      if (dupe) return;
      const row = db.insert(expenses).values({
        date: todayLocal(),
        vendor: po.vendor,
        category: "materials",
        amountCents: po.totalCents,
        paymentMethod: "other",
        projectId: po.projectId,
        billable: false,
        notes: `auto:po:${po.id}; — ${po.number} received from ${po.vendor}`,
      }).returning().get();
      audit(req, "finance.po_expense_post", {
        targetType: "expense", targetId: row.id, targetName: po.number,
        details: { poId: po.id, amountCents: po.totalCents },
      });
    } catch (e) {
      console.error("[finance] po→expense hook failed", e);
    }
  });
}

// ─── PO received → stock in (Phase C #18) ────────────────────────────────────
// PO lines that carry a materialKey (stamped by the buy-list → PO flow) raise
// the matching inventory item's quantity via a proper 'purchased' adjustment,
// so receiving a PO books the expense (above) AND puts the steel on the shelf.
// Adjustments belong to the core inventory module → raw SQL, house style.
// Deduped by the auto:po-stockin:<id> key in adjustment notes so a replayed
// receive can't double-add.

function queuePoStockIn(req: Request, po: PurchaseOrder): void {
  const actorUserId = req.user?.userId;
  if (actorUserId == null) return; // adjustments.user_id is NOT NULL
  setImmediate(() => {
    try {
      const lines = parseLineItems(po.items).filter(
        (l) => l.materialKey && Math.ceil(Number(l.qty) || 0) > 0,
      );
      if (lines.length === 0) return;
      const dupe = sqlite.prepare(
        "SELECT id FROM adjustments WHERE notes LIKE ?",
      ).get(`auto:po-stockin:${po.id};%`);
      if (dupe) return;

      const findItem = sqlite.prepare(
        "SELECT id FROM items WHERE material_key = ? AND deleted_at IS NULL",
      );
      const bump = sqlite.prepare("UPDATE items SET quantity = quantity + ? WHERE id = ?");
      const ledger = sqlite.prepare(`
        INSERT INTO adjustments (item_id, user_id, delta, reason, notes, project_id)
        VALUES (?, ?, ?, 'purchased', ?, ?)
      `);
      const stocked: { itemId: number; qty: number }[] = [];
      sqlite.transaction(() => {
        for (const l of lines) {
          const item = findItem.get(l.materialKey) as { id: number } | undefined;
          if (!item) continue;
          const qty = Math.ceil(Number(l.qty) || 0);
          bump.run(qty, item.id);
          ledger.run(
            item.id, actorUserId, qty,
            `auto:po-stockin:${po.id}; — ${po.number} received${po.vendor ? ` from ${po.vendor}` : ""}`,
            po.projectId,
          );
          stocked.push({ itemId: item.id, qty });
        }
      })();
      if (stocked.length > 0) {
        audit(req, "finance.po_stock_in", {
          targetType: "purchase_order", targetId: po.id, targetName: po.number,
          details: { items: stocked },
        });
      }
    } catch (e) {
      console.error("[finance] po→stock-in hook failed", e);
    }
  });
}

// ─── Fully paid → close the loop (Phase A #6) ────────────────────────────────
// A settled invoice pushes realized revenue back onto its CRM lead (stamped by
// the quote-accept hook — only ever RAISED, a partial refund story must not
// shrink closed revenue) and retires the accept hook's "Schedule the job"
// task. Cross-module tables → raw SQL, everything deferred + try/catch'd.

function queuePaidCloseLoop(req: Request, inv: Invoice): void {
  setImmediate(() => {
    try {
      // The accept hook wrote "From quote Q-2026-0001 — …" into notes; that
      // number keys the task it created (public-portal.ts).
      const quoteNumber = /^From quote (\S+)/.exec(inv.notes ?? "")?.[1];
      if (inv.leadId == null && !quoteNumber) return;
      if (inv.leadId != null) {
        sqlite.prepare(`
          UPDATE crm_leads SET revenue_closed_cents = ?
          WHERE id = ? AND deleted_at IS NULL AND revenue_closed_cents < ?
        `).run(inv.totalCents, inv.leadId, inv.totalCents);
      }
      if (quoteNumber) {
        sqlite.prepare(`
          UPDATE pm_tasks SET status = 'done', completed_at = ?
          WHERE deleted_at IS NULL AND status != 'done' AND auto_created = 1 AND title LIKE ?
        `).run(Date.now(), `Schedule the job — quote ${quoteNumber} accepted%`);
      }
      audit(req, "finance.invoice_paid_sync", {
        targetType: "invoice", targetId: inv.id, targetName: inv.number,
        details: { leadId: inv.leadId, quoteNumber: quoteNumber ?? null, totalCents: inv.totalCents },
      });
    } catch (e) {
      console.error("[finance] paid close-loop hook failed", e);
    }
  });
}

// ─── Recording money — the one path ──────────────────────────────────────────
// The owner typing a check into the UI and Stripe's webhook reporting a card
// both land here, so the status ladder, the receipt email, the review ask and
// the close-loop hooks can never drift apart between the two. Callers own the
// validation and the void check; this owns everything that happens after.

export function recordInvoicePayment(
  req: Request,
  inv: Invoice,
  body: z.infer<typeof insertInvoicePaymentSchema>,
  // Who recorded it, when the request carries no signed-in user — the Stripe
  // webhook. Owner entries leave it unset and the audit log names the session.
  source?: string,
): { payment: typeof invoicePayments.$inferSelect; invoice: Invoice } {
  const payment = db.insert(invoicePayments)
    .values({ invoiceId: inv.id, ...body })
    .returning()
    .get();
  // Auto-status from the running paid total: covered → paid, anything → partial.
  const paidCents = inv.paidCents + body.amountCents;
  // A $0-total invoice must not auto-settle to "paid" (mirrors the reversal
  // path's `&& inv.totalCents > 0` guard). Retainage-aware: the GC paying
  // everything BUT the withheld retainage settles the invoice — the retainage
  // is collected later via the release invoice (Phase G #3).
  const status: InvoiceStatus =
    paidCents >= inv.totalCents - retainageOf(inv) && inv.totalCents > 0 ? "paid" : "partial";
  const invoice = db.update(invoices)
    .set({ paidCents, status })
    .where(eq(invoices.id, inv.id))
    .returning()
    .get();

  // Newly settled → queue the review ask, push realized revenue back onto the
  // CRM lead and retire the "Schedule the job" task (Phase A #6). All
  // deferred; none can break this path.
  if (status === "paid" && inv.status !== "paid") {
    queueReviewRequest(invoice);
    queuePaidCloseLoop(req, invoice);
  }
  // Every recorded payment → receipt email to the customer (same contract).
  queuePaymentReceipt(invoice, body.amountCents);

  audit(req, "finance.payment_record", {
    targetType: "invoice", targetId: inv.id, targetName: inv.number,
    details: {
      amountCents: body.amountCents, method: body.method, newStatus: status,
      ...(source ? { source } : {}),
    },
  });
  return { payment, invoice };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// ─── Unbilled work → invoice (wiring plan, Fix 4) ────────────────────────────

function getFinSettings(): { laborMarkupBp: number; expenseMarkupBp: number } {
  const row = db.select().from(finSettings).where(eq(finSettings.id, 1)).get();
  return { laborMarkupBp: row?.laborMarkupBp ?? 0, expenseMarkupBp: row?.expenseMarkupBp ?? 0 };
}

const withMarkup = (cents: number, markupBp: number): number =>
  Math.round(cents * (1 + markupBp / 10000));

interface UnbilledTimeGroup {
  userId: number;
  userName: string;
  minutes: number;
  entryIds: number[];
  payRateCents: number; // effective HOURLY rate (salary pro-rated at 2080 h/yr)
  payType: string | null;
}

// Billable + unstamped work on a project. Time is grouped per worker — the
// owner's decision: bill at each worker's HR pay rate × (1 + labor markup).
// hr_employees / pm_time_entries belong to other modules → raw SQL + try/catch;
// absent tables degrade to no time (or a 0 rate the owner edits on the invoice).
function collectUnbilled(projectId: number): { expenses: Expense[]; time: UnbilledTimeGroup[] } {
  const exps = db.select().from(expenses).where(and(
    isNull(expenses.deletedAt),
    eq(expenses.billable, true),
    isNull(expenses.invoiceId),
    eq(expenses.projectId, projectId),
  )).all();

  let time: UnbilledTimeGroup[] = [];
  try {
    const rows = sqlite.prepare(`
      SELECT te.id, te.user_id AS userId, te.duration_min AS minutes, u.name AS userName
      FROM pm_time_entries te JOIN users u ON u.id = te.user_id
      WHERE te.project_id = ? AND te.billable = 1 AND te.invoice_id IS NULL
        AND te.ended_at IS NOT NULL AND te.duration_min > 0
    `).all(projectId) as { id: number; userId: number; minutes: number; userName: string }[];
    const byUser = new Map<number, UnbilledTimeGroup>();
    for (const r of rows) {
      let g = byUser.get(r.userId);
      if (!g) {
        g = { userId: r.userId, userName: r.userName, minutes: 0, entryIds: [], payRateCents: 0, payType: null };
        byUser.set(r.userId, g);
      }
      g.minutes += r.minutes;
      g.entryIds.push(r.id);
    }
    for (const g of byUser.values()) {
      try {
        const emp = sqlite.prepare(
          "SELECT pay_type AS payType, pay_rate_cents AS rate FROM hr_employees WHERE user_id = ? AND deleted_at IS NULL",
        ).get(g.userId) as { payType?: string; rate?: number } | undefined;
        if (emp) {
          g.payType = emp.payType ?? null;
          // Salary is cents/year — 2080 work-hours/yr gives the hourly equivalent.
          g.payRateCents = emp.payType === "salary"
            ? Math.round((emp.rate ?? 0) / 2080)
            : (emp.rate ?? 0);
        }
      } catch { /* hr module absent — rate stays 0 */ }
    }
    time = [...byUser.values()];
  } catch { /* pm module absent — no time to bill */ }
  return { expenses: exps, time };
}

// Void/delete releases the stamps so the work becomes billable again.
function releaseBilledItems(invoiceId: number): void {
  sqlite.prepare("UPDATE fin_expenses SET invoice_id = NULL WHERE invoice_id = ?").run(invoiceId);
  try {
    sqlite.prepare("UPDATE pm_time_entries SET invoice_id = NULL WHERE invoice_id = ?").run(invoiceId);
  } catch { /* pm module absent */ }
}

// Phase G #3: voiding/deleting a retainage-RELEASE invoice must put the
// retainage back on "held" — otherwise the money falls into a dead-end (the
// sources are stamped released but nothing is billing it). The release
// endpoint keys its invoice with auto:retainage-release:<projectId>:<ts>; and
// stamps every source with that same ts, so the unwind is an exact match.
function unreleaseRetainage(inv: Invoice): void {
  const m = /auto:retainage-release:(\d+):(\d+);/.exec(inv.notes ?? "");
  if (!m) return;
  sqlite.prepare(
    "UPDATE fin_invoices SET retainage_released_at = NULL WHERE project_id = ? AND retainage_released_at = ?",
  ).run(Number(m[1]), Number(m[2]));
}

export function registerFinanceRoutes(app: Express): void {
  // ─── Stats (literal path — registered before any /:id routes) ────────────

  app.get("/api/finance/stats", requireElevated, (_req, res) => {
    const today = todayLocal();
    const monthPrefix = today.slice(0, 7); // "YYYY-MM"
    const now = new Date();
    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const receivableWhere = and(
      isNull(invoices.deletedAt),
      inArray(invoices.status, RECEIVABLE_STATUSES)
    );
    // Held retainage isn't due yet — it comes off the receivable (Phase G #3).
    const outstandingCents = db.select({
      v: sql<number>`COALESCE(SUM(${invoices.totalCents} - COALESCE(${invoices.retainageCents}, 0) - ${invoices.paidCents}), 0)`,
    }).from(invoices).where(receivableWhere).get()?.v ?? 0;

    const overdueCents = db.select({
      v: sql<number>`COALESCE(SUM(${invoices.totalCents} - COALESCE(${invoices.retainageCents}, 0) - ${invoices.paidCents}), 0)`,
    }).from(invoices).where(and(
      receivableWhere,
      sql`${invoices.dueDate} IS NOT NULL AND ${invoices.dueDate} < ${today}`
    )).get()?.v ?? 0;

    // A payment counts toward the month it was received (paidAt), falling back
    // to when it was recorded (createdAt) for rows entered without a date.
    const paidThisMonthCents = db.select({
      v: sql<number>`COALESCE(SUM(${invoicePayments.amountCents}), 0)`,
    }).from(invoicePayments).where(and(
      or(
        sql`${invoicePayments.paidAt} LIKE ${monthPrefix + "%"}`,
        and(
          isNull(invoicePayments.paidAt),
          sql`${invoicePayments.createdAt} >= ${monthStartMs}`
        )
      ),
      // Payments against VOIDED invoices are not income — exclude them.
      sql`${invoicePayments.invoiceId} NOT IN (SELECT ${invoices.id} FROM ${invoices} WHERE ${invoices.status} = 'void')`
    )).get()?.v ?? 0;

    const expensesThisMonthCents = db.select({
      v: sql<number>`COALESCE(SUM(${expenses.amountCents}), 0)`,
    }).from(expenses).where(and(
      isNull(expenses.deletedAt),
      sql`${expenses.date} LIKE ${monthPrefix + "%"}`
    )).get()?.v ?? 0;

    const draftInvoices = db.select({ c: sql<number>`COUNT(*)` })
      .from(invoices)
      .where(and(isNull(invoices.deletedAt), eq(invoices.status, "draft")))
      .get()?.c ?? 0;

    res.json({
      outstandingCents,
      overdueCents,
      paidThisMonthCents,
      expensesThisMonthCents,
      netThisMonthCents: paidThisMonthCents - expensesThisMonthCents,
      draftInvoices,
    });
  });

  // ─── Reports (accounting rollups, all over the trailing 12 months) ───────

  app.get("/api/finance/reports", requireElevated, (_req, res) => {
    const today = todayLocal();
    const now = new Date();

    // Trailing 12 calendar months including the current one.
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const monthSet = new Set(months);
    const windowStart = `${months[0]}-01`;

    const paymentsAll = db.select().from(invoicePayments).all();
    const invoicesAll = db.select().from(invoices).all();
    const invoiceById = new Map(invoicesAll.map((i) => [i.id, i]));
    const expenseRows = db.select().from(expenses)
      .where(and(isNull(expenses.deletedAt), sql`${expenses.date} >= ${windowStart}`))
      .all();

    const paymentMonth = (p: (typeof paymentsAll)[number]): string =>
      p.paidAt ? p.paidAt.slice(0, 7) : monthKey(p.createdAt);

    // monthly income vs expense
    const income = new Map<string, number>(months.map((m) => [m, 0]));
    const expense = new Map<string, number>(months.map((m) => [m, 0]));
    for (const p of paymentsAll) {
      // Payments against voided invoices aren't income.
      if (invoiceById.get(p.invoiceId)?.status === "void") continue;
      const m = paymentMonth(p);
      if (monthSet.has(m)) income.set(m, (income.get(m) ?? 0) + p.amountCents);
    }
    for (const e of expenseRows) {
      const m = e.date.slice(0, 7);
      if (monthSet.has(m)) expense.set(m, (expense.get(m) ?? 0) + e.amountCents);
    }
    const monthly = months.map((m) => {
      const incomeCents = income.get(m) ?? 0;
      const expenseCents = expense.get(m) ?? 0;
      return { month: m, incomeCents, expenseCents, netCents: incomeCents - expenseCents };
    });

    // expense breakdown by category
    const byCategory = new Map<string, number>();
    for (const e of expenseRows) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountCents);
    }
    const expenseByCategory = [...byCategory.entries()]
      .map(([category, amountCents]) => ({ category, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);

    // AR aging — unpaid balances bucketed by days past due. Undated invoices
    // and ones not yet due sit in "current".
    const arAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    const todayMs = Date.parse(today);
    for (const inv of invoicesAll) {
      if (inv.deletedAt !== null) continue;
      if (!RECEIVABLE_STATUSES.includes(inv.status)) continue;
      const balance = inv.totalCents - retainageOf(inv) - inv.paidCents;
      if (balance <= 0) continue;
      const daysPast = inv.dueDate
        ? Math.floor((todayMs - Date.parse(inv.dueDate)) / 86_400_000)
        : 0;
      if (daysPast <= 0) arAging.current += balance;
      else if (daysPast <= 30) arAging.d1_30 += balance;
      else if (daysPast <= 60) arAging.d31_60 += balance;
      else if (daysPast <= 90) arAging.d61_90 += balance;
      else arAging.d90plus += balance;
    }

    // Top clients by payments received via their invoices (same 12-month
    // window as the rest of the report).
    const clientNames = allClientNames();
    const revenueByClient = new Map<string, number>();
    for (const p of paymentsAll) {
      if (!monthSet.has(paymentMonth(p))) continue;
      const inv = invoiceById.get(p.invoiceId);
      // Payments against voided invoices aren't revenue.
      if (inv?.status === "void") continue;
      const label =
        inv?.clientName ??
        (inv?.clientId != null ? clientNames.get(inv.clientId) : undefined) ??
        "Unassigned";
      revenueByClient.set(label, (revenueByClient.get(label) ?? 0) + p.amountCents);
    }
    const topClients = [...revenueByClient.entries()]
      .map(([clientName, revenueCents]) => ({ clientName, revenueCents }))
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 5);

    res.json({ monthly, expenseByCategory, arAging, topClients });
  });

  // ─── Invoices ─────────────────────────────────────────────────────────────

  app.get("/api/finance/invoices", requireElevated, (req, res) => {
    const status = qstr(req.query.status);
    const clientId = qstr(req.query.clientId);
    const projectId = qstr(req.query.projectId);
    const q = qstr(req.query.q);

    const conds = [isNull(invoices.deletedAt)];
    if (clientId) conds.push(eq(invoices.clientId, parseInt(clientId, 10)));
    if (projectId) conds.push(eq(invoices.projectId, parseInt(projectId, 10)));

    const today = todayLocal();
    let rows = db.select().from(invoices)
      .where(and(...conds))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .all()
      .map((r) => presentInvoice(r, today));

    // Status filter runs against the DERIVED status so ?status=overdue works
    // (and ?status=sent excludes rows that have tipped overdue).
    if (status) rows = rows.filter((r) => r.status === status);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.number.toLowerCase().includes(needle) ||
          (r.clientName ?? "").toLowerCase().includes(needle)
      );
    }
    res.json(rows);
  });

  app.post("/api/finance/invoices", requireElevated, (req, res) => {
    let body, itemsJson, totals, retainagePct;
    try {
      // Items arrive as a JSON string (the column shape) or a raw array —
      // same tolerance as the CRM estimate endpoints.
      const raw = { ...req.body };
      if (Array.isArray(raw.items)) raw.items = JSON.stringify(raw.items);
      body = insertInvoiceSchema.parse(raw);
      retainagePct = retainagePctSchema.parse(raw.retainagePct);
      itemsJson = body.items ?? "[]";
      totals = computeTotals(itemsJson, body.taxRateBp ?? 0);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    // Snapshot the client's name at issue time — the invoice keeps displaying
    // correctly even if the CRM client is later renamed or deleted.
    let clientName = body.clientName ?? null;
    if (!clientName && body.clientId != null) clientName = clientNameById(body.clientId);
    // Phase G #3: retainage cents derived server-side from the pct.
    const retainageCents = retainagePct
      ? Math.round((totals.totalCents * retainagePct) / 100)
      : null;

    const row = insertNumbered("fin_invoices", "INV", (num) =>
      db.insert(invoices)
        .values({ ...body, number: num, items: itemsJson, clientName, retainageCents, ...totals })
        .returning()
        .get()
    );
    audit(req, "finance.invoice_create", {
      targetType: "invoice", targetId: row.id, targetName: row.number,
      details: { totalCents: row.totalCents, clientId: row.clientId },
    });
    res.status(201).json(presentInvoice(row, todayLocal()));
  });

  app.get("/api/finance/invoices/:id", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    const payments = db.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, inv.id))
      .orderBy(desc(invoicePayments.createdAt), desc(invoicePayments.id))
      .all();
    res.json({ invoice: presentInvoice(inv, todayLocal()), payments });
  });

  // Proof the customer's page before it's the customer's page. Mints the share
  // token early and hands back the ?preview=1 URL — no status flip, no email,
  // no side effects of any kind. Same shape as the quote builder's preview.
  app.post("/api/finance/invoices/:id/preview", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    // Re-sharing reuses the token, so a link already copied never goes dead.
    const fresh = inv.shareToken
      ? inv
      : db.update(invoices)
          .set({ shareToken: crypto.randomBytes(24).toString("hex") })
          .where(eq(invoices.id, inv.id))
          .returning()
          .get();
    res.json({ url: invoicePayLink(fresh) });
  });

  app.patch("/api/finance/invoices/:id", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    let body, retainagePct;
    try {
      const raw = { ...req.body };
      if (Array.isArray(raw.items)) raw.items = JSON.stringify(raw.items);
      body = insertInvoiceSchema.partial().parse(raw);
      retainagePct = retainagePctSchema.parse(raw.retainagePct);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    // Once money has been recorded against an invoice its line items and
    // totals are immutable — editing them would silently corrupt paid/balance
    // math. The escape hatch is voiding and reissuing. (Totals themselves are
    // schema-stripped, so items/taxRateBp/retainagePct are the only money inputs.)
    const touchesMoney =
      body.items !== undefined || body.taxRateBp !== undefined || retainagePct !== undefined;
    if (touchesMoney && paymentCountFor(inv.id) > 0) {
      return res.status(400).json({
        message: "Invoice has recorded payments — items and totals are locked. Void it and issue a new one.",
      });
    }

    const updates: Partial<typeof invoices.$inferInsert> = { ...body };
    if (touchesMoney) {
      try {
        Object.assign(
          updates,
          computeTotals(body.items ?? inv.items, body.taxRateBp ?? inv.taxRateBp)
        );
      } catch (e: any) {
        return res.status(400).json({ message: e.message });
      }
      // Fix 4 (bug): editing the line items can drop pulled labor/expense lines.
      // Release this invoice's billed-on stamps so any source entries no longer
      // represented become collectible again (collectUnbilled keys off
      // invoice_id IS NULL). Only reachable pre-payment — the lock above already
      // rejected edits once money has been recorded.
      if (body.items !== undefined) releaseBilledItems(inv.id);
      // Phase G #3: re-derive retainage cents against the (possibly new) total.
      // Explicit pct wins; an items/tax edit without a pct keeps the old cents.
      if (retainagePct !== undefined) {
        const total = (updates.totalCents as number | undefined) ?? inv.totalCents;
        updates.retainageCents = retainagePct ? Math.round((total * retainagePct) / 100) : null;
      }
    }
    // Linking a different CRM client re-snapshots the display name the same
    // way POST does; unlinking (clientId: null) keeps the old snapshot so the
    // invoice still reads correctly as free-text.
    if (body.clientId != null && body.clientName === undefined) {
      updates.clientName = clientNameById(body.clientId) ?? inv.clientName;
    }
    // First transition to "sent" stamps sentAt; re-sending keeps the original.
    if (body.status === "sent" && inv.status !== "sent" && !inv.sentAt) {
      updates.sentAt = Date.now();
    }
    // …and fills the two dates every collection path depends on. An invoice with
    // no dueDate is invisible to ALL of them: the overdue sweep filters on
    // `due_date IS NOT NULL`, derivedStatus only returns "overdue" when it is
    // set, and the digest, the dashboard badge and the overdue total key off
    // that. The customer's copy drops its "Due date:" line too, so neither side
    // knows when payment is expected. The invoice minted when a customer accepts
    // a quote online arrives with NEITHER date, and "Mark sent" is a one-click
    // button that never opens the form — so nothing ever prompts for them.
    // A date typed by hand still wins; this only removes the silent case, and
    // only on the transition, so invoices already sent are left alone.
    // ponytail: net-14 hardcoded — move it to fin_settings only if a second
    // value is ever actually wanted.
    if (body.status === "sent" && inv.status !== "sent") {
      if (!inv.issueDate && body.issueDate === undefined) updates.issueDate = todayLocal();
      if (!inv.dueDate && body.dueDate === undefined) {
        updates.dueDate = ymdLocal(Date.now() + 14 * 24 * 60 * 60 * 1000);
      }
    }
    // …and mints the customer's /invoice/<token> link, once. Minted here rather
    // than in the email hook so the row the owner gets back already carries it
    // (the detail modal offers it to copy) even when there's no address on file.
    if (body.status === "sent" && !inv.shareToken) {
      updates.shareToken = crypto.randomBytes(24).toString("hex");
    }
    if (Object.keys(updates).length === 0) {
      return res.json(presentInvoice(inv, todayLocal()));
    }

    const row = db.update(invoices).set(updates).where(eq(invoices.id, inv.id)).returning().get();
    if (body.status && body.status !== inv.status) {
      audit(req, "finance.invoice_status", {
        targetType: "invoice", targetId: inv.id, targetName: inv.number,
        details: { from: inv.status, to: body.status },
      });
      // Fix 4: voiding releases the billed-on stamps so pulled expenses/time
      // become billable again on the reissued invoice. Phase G #3: same idea
      // for a voided retainage-release invoice — the retainage goes back to held.
      if (body.status === "void") {
        releaseBilledItems(inv.id);
        unreleaseRetainage(inv);
      }
      // Phase A #1: the transition INTO "sent" emails the customer the actual
      // invoice (deferred; a re-PATCH that stays "sent" doesn't re-send).
      if (body.status === "sent") queueInvoiceEmail(row);
    }
    // `emailedTo` rides along on the send transition so the UI can say who it
    // is going to — or that there is nobody to send to, which is the case that
    // used to pass silently as a green "Invoice marked sent".
    const emailedTo = body.status === "sent" && body.status !== inv.status
      ? (mailEnabled() ? invoiceRecipient(row) : null)
      : undefined;
    res.json({ ...presentInvoice(row, todayLocal()), ...(emailedTo !== undefined ? { emailedTo } : {}) });
  });

  app.delete("/api/finance/invoices/:id", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (paymentCountFor(inv.id) > 0) {
      return res.status(400).json({
        message: "Invoice has recorded payments and cannot be deleted — set its status to void instead.",
      });
    }
    db.update(invoices).set({ deletedAt: Date.now() }).where(eq(invoices.id, inv.id)).run();
    // Fix 4: deleting releases the billed-on stamps (same as voiding).
    releaseBilledItems(inv.id);
    unreleaseRetainage(inv);
    audit(req, "finance.invoice_delete", {
      targetType: "invoice", targetId: inv.id, targetName: inv.number,
    });
    res.json({ ok: true });
  });

  app.post("/api/finance/invoices/:id/payments", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.status === "void") {
      return res.status(400).json({ message: "Cannot record a payment on a void invoice" });
    }
    let body;
    try {
      body = insertInvoicePaymentSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    const { payment, invoice } = recordInvoicePayment(req, inv, body);
    res.status(201).json({ payment, invoice: presentInvoice(invoice, todayLocal()) });
  });

  // Payment reversal — mistyped amount, bounced check. Rewinds the invoice's
  // paid total and re-derives its status from what remains.
  app.delete("/api/finance/payments/:id", requireElevated, (req, res) => {
    const payment = db.select().from(invoicePayments)
      .where(eq(invoicePayments.id, pid(req.params.id)))
      .get();
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    db.delete(invoicePayments).where(eq(invoicePayments.id, payment.id)).run();

    const inv = db.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).get();
    let updated = inv;
    if (inv) {
      const paidCents = Math.max(0, inv.paidCents - payment.amountCents);

      // Undo an online settle-in-full. Paying the whole job from a deposit
      // invoice grows that invoice to cover the contract and grants the
      // prompt-payment discount (server/pay.ts). Reversing the payment that
      // bought it must put the invoice back — otherwise a bounced card leaves
      // an unpaid invoice that has quietly kept the discount and forgotten it
      // was ever a deposit. Only when nothing is left paid: a part-reversal
      // hasn't undone the settlement.
      const restore = paidCents === 0 && inv.restatedFrom
        ? (() => {
            try {
              const s = JSON.parse(inv.restatedFrom!);
              return typeof s?.totalCents === "number"
                ? {
                    items: String(s.items ?? "[]"),
                    subtotalCents: s.subtotalCents as number,
                    taxRateBp: s.taxRateBp as number,
                    taxCents: s.taxCents as number,
                    totalCents: s.totalCents as number,
                    discountCents: null,
                    restatedFrom: null,
                  }
                : null;
            } catch {
              return null; // unreadable snapshot — leave the row alone
            }
          })()
        : null;
      // Status is derived against the total the invoice will HAVE, not the one
      // it is being rolled back from.
      const effectiveTotal = restore ? restore.totalCents : inv.totalCents;

      // void stays void; otherwise: covered → paid, some → partial, none →
      // back to sent (if it ever went out) or draft.
      let status = inv.status;
      if (inv.status !== "void") {
        status =
          paidCents >= effectiveTotal - retainageOf(inv) && effectiveTotal > 0 ? "paid"
          : paidCents > 0 ? "partial"
          : inv.sentAt ? "sent"
          : "draft";
      }
      updated = db.update(invoices)
        .set({ paidCents, status, ...(restore ?? {}) })
        .where(eq(invoices.id, inv.id))
        .returning()
        .get();
      if (restore) {
        audit(req, "finance.invoice_unrestated", {
          targetType: "invoice", targetId: inv.id, targetName: inv.number,
          details: { from: inv.totalCents, to: restore.totalCents },
        });
      }

      // The re-derivation can also land on "paid" (e.g. reversing an overpaid
      // duplicate still leaves the total covered) — same newly-paid rule.
      if (status === "paid" && inv.status !== "paid" && updated) queueReviewRequest(updated);
    }
    audit(req, "finance.payment_delete", {
      targetType: "invoice", targetId: payment.invoiceId, targetName: inv?.number ?? null,
      details: { amountCents: payment.amountCents },
    });
    res.json({ ok: true, invoice: updated ? presentInvoice(updated, todayLocal()) : null });
  });

  // ─── Expenses ────────────────────────────────────────────────────────────

  // ─── Unbilled work → invoice (wiring plan, Fix 4) ─────────────────────────

  app.get("/api/finance/settings", requireElevated, (_req, res) => {
    res.json(getFinSettings());
  });

  app.patch("/api/finance/settings", requireElevated, (req, res) => {
    try {
      const body = updateFinSettingsSchema.parse(req.body);
      db.update(finSettings).set({ ...body, updatedAt: Date.now() })
        .where(eq(finSettings.id, 1)).run();
      audit(req, "finance.settings_update", {
        targetType: "settings", targetId: 1, details: body,
      });
      res.json(getFinSettings());
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Preview of what's waiting to be billed on a job — per-worker labor at the
  // HR pay rate + markup, billable expenses at cost + markup.
  app.get("/api/finance/projects/:id/unbilled", requireElevated, (req, res) => {
    const projectId = pid(req.params.id);
    const { expenses: exps, time } = collectUnbilled(projectId);
    const settings = getFinSettings();
    const laborCents = time.reduce(
      (s, g) => s + withMarkup(Math.round((g.minutes / 60) * g.payRateCents), settings.laborMarkupBp), 0);
    const expenseCents = exps.reduce(
      (s, e) => s + withMarkup(e.amountCents, settings.expenseMarkupBp), 0);
    res.json({
      expenses: exps,
      time,
      settings,
      totals: { laborCents, expenseCents, totalCents: laborCents + expenseCents },
    });
  });

  // Pull everything unbilled on a project onto a DRAFT invoice as line items,
  // stamping the sources in the same transaction so a second pull (or a
  // double-click) can't double-bill.
  app.post("/api/finance/invoices/:id/pull-unbilled", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.status !== "draft") {
      return res.status(400).json({ message: "Unbilled work can only be pulled onto a draft invoice" });
    }
    let body;
    try {
      body = pullUnbilledSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const defaults = getFinSettings();
    const laborMarkupBp = body.laborMarkupBp ?? defaults.laborMarkupBp;
    const expenseMarkupBp = body.expenseMarkupBp ?? defaults.expenseMarkupBp;
    const { expenses: exps, time } = collectUnbilled(body.projectId);
    if (exps.length === 0 && time.length === 0) {
      return res.status(400).json({ message: "Nothing unbilled on that job" });
    }

    const newItems = [
      ...time.map((g) => {
        const hours = Math.round((g.minutes / 60) * 100) / 100;
        const rateCents = withMarkup(g.payRateCents, laborMarkupBp);
        // Bill the EXACT amount the /unbilled preview shows: markup applied to
        // the rounded labor cost. Rounding hours→2dp then ×rate drifts from the
        // preview, so charge the computed cents as a single line unit and keep
        // the hours/rate only in the human-readable description.
        const amountCents = withMarkup(Math.round((g.minutes / 60) * g.payRateCents), laborMarkupBp);
        return {
          description: `Labor — ${g.userName} (${hours} hr @ $${(rateCents / 100).toFixed(2)}/hr)`,
          qty: 1,
          unit: "hour",
          unitPriceCents: amountCents,
        };
      }),
      ...exps.map((e) => ({
        description: `${e.vendor || EXPENSE_CATEGORY_LABELS[e.category]} — ${e.date}${e.notes ? ` (${e.notes})` : ""}`,
        qty: 1,
        unitPriceCents: withMarkup(e.amountCents, expenseMarkupBp),
      })),
    ];

    const itemsJson = JSON.stringify([...parseLineItems(inv.items), ...newItems]);
    let totals;
    try {
      totals = computeTotals(itemsJson, inv.taxRateBp);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    const row = db.transaction((tx) => {
      const stampExp = sqlite.prepare("UPDATE fin_expenses SET invoice_id = ? WHERE id = ?");
      for (const e of exps) stampExp.run(inv.id, e.id);
      const stampTime = sqlite.prepare("UPDATE pm_time_entries SET invoice_id = ? WHERE id = ?");
      for (const g of time) for (const entryId of g.entryIds) stampTime.run(inv.id, entryId);
      return tx.update(invoices).set({ items: itemsJson, ...totals })
        .where(eq(invoices.id, inv.id)).returning().get();
    });
    audit(req, "finance.invoice_pull_unbilled", {
      targetType: "invoice", targetId: inv.id, targetName: inv.number,
      details: {
        projectId: body.projectId,
        laborGroups: time.length,
        expenses: exps.length,
        addedCents: totals.totalCents - inv.totalCents,
      },
    });
    res.json(presentInvoice(row, todayLocal()));
  });

  // Job hub money summary — everything needed to answer "is this job making
  // money?" in one call: invoices (billed/collected), expenses, and labor cost
  // (all closed PM time × each worker's HR pay rate, salary pro-rated).
  app.get("/api/finance/projects/:id/summary", requireElevated, (req, res) => {
    const projectId = pid(req.params.id);
    const invRows = db.select().from(invoices)
      .where(and(isNull(invoices.deletedAt), eq(invoices.projectId, projectId)))
      .orderBy(desc(invoices.id))
      .all();
    const live = invRows.filter((i) => i.status !== "void");
    // Phase G #3: a retainage-release invoice re-bills money already inside a
    // source invoice's total, so gross Σ totals would double-count it. Netting
    // out RELEASED retainage keeps billed-to-date equal to the sum of the
    // original invoice totals — retainage counts as revenue exactly once.
    const releasedRetainageCents = live.reduce(
      (s, i) => s + (i.retainageReleasedAt != null ? (i.retainageCents ?? 0) : 0), 0);
    const invoicedCents = live.reduce((s, i) => s + i.totalCents, 0) - releasedRetainageCents;
    const paidCents = live.reduce((s, i) => s + i.paidCents, 0);
    // Still-held retainage, capped at what's actually uncollected on each
    // invoice (a GC that ignored the withholding and paid in full holds $0).
    // Same predicate as the bill-retainage endpoint so card and button agree.
    const retainageHeldCents = live.reduce((s, i) => s + heldRetainageOf(i), 0);
    const expenseCents = db.select({ s: sql<number>`coalesce(sum(${expenses.amountCents}), 0)` })
      .from(expenses)
      .where(and(isNull(expenses.deletedAt), eq(expenses.projectId, projectId)))
      .get()?.s ?? 0;

    let laborMinutes = 0;
    let laborCostCents = 0;
    try {
      const rows = sqlite.prepare(`
        SELECT te.user_id AS userId, SUM(te.duration_min) AS minutes
        FROM pm_time_entries te
        WHERE te.project_id = ? AND te.ended_at IS NOT NULL
        GROUP BY te.user_id
      `).all(projectId) as { userId: number; minutes: number }[];
      for (const r of rows) {
        laborMinutes += r.minutes;
        try {
          const emp = sqlite.prepare(
            "SELECT pay_type AS payType, pay_rate_cents AS rate FROM hr_employees WHERE user_id = ? AND deleted_at IS NULL",
          ).get(r.userId) as { payType?: string; rate?: number } | undefined;
          const hourly = emp
            ? (emp.payType === "salary" ? Math.round((emp.rate ?? 0) / 2080) : (emp.rate ?? 0))
            : 0;
          laborCostCents += Math.round((r.minutes / 60) * hourly);
        } catch { /* hr module absent — labor priced at 0 */ }
      }
    } catch { /* pm module absent — no time on the job */ }

    // Phase A #3: the signed contract's value vs what's actually been billed —
    // a done job with contract money left unbilled is the cash leak this
    // whole card exists to catch. pm_contracts belongs to pm → try/catch.
    let contractCents = 0;
    try {
      contractCents = db.select({ s: sql<number>`coalesce(sum(${contracts.valueCents}), 0)` })
        .from(contracts)
        .where(and(
          isNull(contracts.deletedAt),
          eq(contracts.projectId, projectId),
          inArray(contracts.status, ["active", "signed"]),
        ))
        .get()?.s ?? 0;
    } catch { /* pm module absent — no contract to reconcile */ }

    // Phase G #1: approved change orders move the goalposts — the job's
    // effective contract total is contractCents + changeOrderCents (signed;
    // deductive COs subtract). pm_change_orders belongs to pm → try/catch.
    let changeOrderCents = 0;
    try {
      changeOrderCents = db.select({ s: sql<number>`coalesce(sum(${changeOrders.amountCents}), 0)` })
        .from(changeOrders)
        .where(and(
          isNull(changeOrders.deletedAt),
          eq(changeOrders.projectId, projectId),
          eq(changeOrders.status, "approved"),
        ))
        .get()?.s ?? 0;
    } catch { /* pm module absent — no change orders */ }

    const today = todayLocal();
    res.json({
      invoices: live.map((i) => presentInvoice(i, today)),
      totals: {
        contractCents,
        changeOrderCents,
        invoicedCents,
        paidCents,
        outstandingCents: invoicedCents - paidCents,
        retainageHeldCents,
        expenseCents,
        laborMinutes,
        laborCostCents,
        // What's left after materials + labor if everything billed gets paid.
        marginCents: invoicedCents - expenseCents - laborCostCents,
      },
    });
  });

  // ─── Retainage release (Phase G #3) ───────────────────────────────────────
  // One draft invoice for everything still withheld on the job, stamping the
  // source invoices released in the same transaction so a double-click can't
  // bill the retainage twice. Void/delete of the release invoice unwinds the
  // stamps (unreleaseRetainage above).

  app.post("/api/finance/projects/:id/bill-retainage", requireElevated, (req, res) => {
    const projectId = pid(req.params.id);
    const project = db.select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .get();
    if (!project) return res.status(404).json({ message: "Project not found" });

    const sources = db.select().from(invoices)
      .where(and(isNull(invoices.deletedAt), eq(invoices.projectId, projectId)))
      .orderBy(desc(invoices.id))
      .all()
      .map((i) => ({ inv: i, cents: heldRetainageOf(i) }))
      .filter((s) => s.cents > 0);
    const totalHeld = sources.reduce((s, x) => s + x.cents, 0);
    if (totalHeld <= 0) {
      return res.status(400).json({ message: "No retainage held on this job" });
    }

    // Client identity from the most recent source invoice (they all belong to
    // the same GC in practice). No tax — the source totals were already taxed.
    const latest = sources[0].inv;
    const now = Date.now();
    const itemsJson = JSON.stringify([{
      description: `Retainage release — ${project.name}`,
      qty: 1,
      unitPriceCents: totalHeld,
    }]);
    const totals = computeTotals(itemsJson, 0);

    const row = sqlite.transaction(() => {
      const created = insertNumbered("fin_invoices", "INV", (num) =>
        db.insert(invoices).values({
          number: num,
          clientId: latest.clientId,
          clientName: latest.clientName,
          projectId,
          status: "draft",
          issueDate: todayLocal(),
          items: itemsJson,
          taxRateBp: 0,
          ...totals,
          notes: `auto:retainage-release:${projectId}:${now}; — releases retainage withheld on ${sources.map((s) => s.inv.number).join(", ")}`,
        }).returning().get()
      );
      const stamp = sqlite.prepare("UPDATE fin_invoices SET retainage_released_at = ? WHERE id = ?");
      for (const s of sources) stamp.run(now, s.inv.id);
      return created;
    })();

    audit(req, "finance.retainage_release", {
      targetType: "invoice", targetId: row.id, targetName: row.number,
      details: {
        projectId,
        totalCents: totalHeld,
        sourceInvoices: sources.map((s) => ({ id: s.inv.id, number: s.inv.number, cents: s.cents })),
      },
    });
    res.status(201).json(presentInvoice(row, todayLocal()));
  });

  app.get("/api/finance/expenses", requireElevated, (req, res) => {
    const category = qstr(req.query.category);
    const projectId = qstr(req.query.projectId);
    const from = qstr(req.query.from);
    const to = qstr(req.query.to);
    const q = qstr(req.query.q);

    const conds = [isNull(expenses.deletedAt)];
    if (category) conds.push(eq(expenses.category, category as any));
    if (projectId) conds.push(eq(expenses.projectId, parseInt(projectId, 10)));
    if (from) conds.push(sql`${expenses.date} >= ${from}`);
    if (to) conds.push(sql`${expenses.date} <= ${to}`);

    let rows = db.select().from(expenses)
      .where(and(...conds))
      .orderBy(desc(expenses.date), desc(expenses.id))
      .all();
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.vendor ?? "").toLowerCase().includes(needle) ||
          (r.notes ?? "").toLowerCase().includes(needle)
      );
    }
    // Total is for the FILTERED set — the UI shows "you spent $X on fuel in June".
    const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
    res.json({ rows, totalCents });
  });

  registerCreate(app, "/api/finance/expenses", requireElevated, {
    table: expenses, schema: insertExpenseSchema,
    action: "finance.expense_create", targetType: "expense",
    name: (r) => r.vendor ?? r.category,
    details: (r) => ({ amountCents: r.amountCents, category: r.category }), audit,
  });

  app.patch("/api/finance/expenses/:id", requireElevated, (req, res) => {
    const existing = db.select().from(expenses)
      .where(and(eq(expenses.id, pid(req.params.id)), isNull(expenses.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Expense not found" });
    let body;
    try {
      body = insertExpenseSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    if (Object.keys(body).length === 0) return res.json(existing);
    const row = db.update(expenses).set(body).where(eq(expenses.id, existing.id)).returning().get();
    res.json(row);
  });

  app.delete("/api/finance/expenses/:id", requireElevated, (req, res) => {
    const existing = db.select().from(expenses)
      .where(and(eq(expenses.id, pid(req.params.id)), isNull(expenses.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Expense not found" });
    db.update(expenses).set({ deletedAt: Date.now() }).where(eq(expenses.id, existing.id)).run();
    audit(req, "finance.expense_delete", {
      targetType: "expense", targetId: existing.id, targetName: existing.vendor ?? existing.category,
      details: { amountCents: existing.amountCents },
    });
    res.json({ ok: true });
  });

  // ─── Purchase orders ─────────────────────────────────────────────────────

  app.get("/api/finance/purchase-orders", requireElevated, (req, res) => {
    const status = qstr(req.query.status);
    const q = qstr(req.query.q);

    const conds = [isNull(purchaseOrders.deletedAt)];
    if (status) conds.push(eq(purchaseOrders.status, status as any));

    let rows = db.select().from(purchaseOrders)
      .where(and(...conds))
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
      .all();
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => r.vendor.toLowerCase().includes(needle));
    }
    res.json(rows);
  });

  app.post("/api/finance/purchase-orders", requireElevated, (req, res) => {
    let body, itemsJson, totalCents;
    try {
      const raw = { ...req.body };
      if (Array.isArray(raw.items)) raw.items = JSON.stringify(raw.items);
      body = insertPurchaseOrderSchema.parse(raw);
      itemsJson = body.items ?? "[]";
      totalCents = computeTotals(itemsJson, 0).totalCents; // POs carry no tax
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const row = insertNumbered("fin_purchase_orders", "PO", (num) =>
      db.insert(purchaseOrders)
        // Every PO starts life open — received/cancelled only via PATCH.
        .values({ ...body, number: num, status: "open", items: itemsJson, totalCents })
        .returning()
        .get()
    );
    audit(req, "finance.po_create", {
      targetType: "purchase_order", targetId: row.id, targetName: row.number,
      details: { vendor: row.vendor, totalCents: row.totalCents },
    });
    res.status(201).json(row);
  });

  app.patch("/api/finance/purchase-orders/:id", requireElevated, (req, res) => {
    const existing = db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, pid(req.params.id)), isNull(purchaseOrders.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Purchase order not found" });
    let body;
    try {
      const raw = { ...req.body };
      if (Array.isArray(raw.items)) raw.items = JSON.stringify(raw.items);
      body = insertPurchaseOrderSchema.partial().parse(raw);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    // Only two transitions exist: open → received (books the expense and
    // stocks materials in) and open → cancelled. Both ends are terminal.
    if (body.status && body.status !== existing.status && existing.status !== "open") {
      return res.status(400).json({
        message: `A ${existing.status} purchase order can't change status`,
      });
    }

    const updates: Partial<typeof purchaseOrders.$inferInsert> = { ...body };
    if (body.items !== undefined) {
      try {
        updates.totalCents = computeTotals(body.items, 0).totalCents;
      } catch (e: any) {
        return res.status(400).json({ message: e.message });
      }
    }
    if (Object.keys(updates).length === 0) return res.json(existing);

    const row = db.update(purchaseOrders).set(updates).where(eq(purchaseOrders.id, existing.id)).returning().get();
    if (body.status && body.status !== existing.status) {
      audit(req, "finance.po_status", {
        targetType: "purchase_order", targetId: existing.id, targetName: existing.number,
        details: { from: existing.status, to: body.status },
      });
      // Phase A #4: materials landing at the shop are money spent — book the
      // expense (deduped by the auto: notes key).
      // Phase C #18: and material lines put stock on the shelf (deduped too).
      if (body.status === "received") {
        queuePoExpense(req, row);
        queuePoStockIn(req, row);
      }
    }
    res.json(row);
  });

  registerSoftDelete(app, "/api/finance/purchase-orders/:id", requireElevated, {
    table: purchaseOrders, notFound: "Purchase order not found",
    action: "finance.po_delete", targetType: "purchase_order",
    name: (po) => po.number, audit,
  });
}
