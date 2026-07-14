import type { Express } from "express";
import crypto from "crypto";
import { eq, and, or, desc, asc, isNull, inArray, sql } from "drizzle-orm";
import { sqlite, db } from "./storage";
import { auditQuiet as audit } from "./audit";
import { requireElevated } from "./auth";
import { mailEnabled, sendMail } from "./mailer";
import {
  invoices, invoicePayments, expenses, paymentGateways, purchaseOrders,
  finSettings,
  insertInvoiceSchema, insertInvoicePaymentSchema, insertExpenseSchema,
  updateGatewaySchema, insertPurchaseOrderSchema,
  updateFinSettingsSchema, pullUnbilledSchema,
  PAYMENT_GATEWAY_CATALOG, EXPENSE_CATEGORY_LABELS,
  type Invoice, type InvoiceStatus, type Expense,
} from "../shared/finance-schema";
import { clients, estimates, type Estimate } from "../shared/crm-schema";
// Cross-module automation hook: a freshly paid invoice queues a review request.
// The mk_ tables are owned by the marketing module's DDL; every touch below is
// deferred + try/catch'd so a marketing hiccup can't break payment recording.
import { marketingSettings, mkTasks } from "../shared/marketing-schema";
import { parseLineItems, lineItemsTotalCents, lineItemsSchema } from "../shared/biz-common";

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

  CREATE TABLE IF NOT EXISTS fin_gateways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'card',
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    fees_note TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_fin_gateways_order ON fin_gateways(order_index);

  CREATE TABLE IF NOT EXISTS fin_purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    vendor TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
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

// Additive migration (wiring plan, Fix 4): fin_expenses.invoice_id arrived
// after installs existed. The throw on re-run is expected.
try {
  sqlite.exec("ALTER TABLE fin_expenses ADD COLUMN invoice_id INTEGER");
} catch {
  /* column already exists */
}
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_fin_expenses_invoice ON fin_expenses(invoice_id);

  -- Finance knobs singleton (wiring plan, Fix 4): markup basis points for
  -- pulling unbilled labor / expenses onto an invoice.
  CREATE TABLE IF NOT EXISTS fin_settings (
    id INTEGER PRIMARY KEY,
    labor_markup_bp INTEGER NOT NULL DEFAULT 0,
    expense_markup_bp INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER
  );
`);
sqlite.exec("INSERT OR IGNORE INTO fin_settings (id) VALUES (1)");

// Seed the gateway registry from the catalog on first boot only — an empty
// table means "never seeded", so the owner's later edits (toggles, config,
// deleting nothing since rows are permanent) are never clobbered by a restart.
{
  const count = (sqlite.prepare("SELECT COUNT(*) AS c FROM fin_gateways").get() as { c: number }).c;
  if (count === 0) {
    const ins = sqlite.prepare(
      "INSERT INTO fin_gateways (key, name, kind, fees_note, order_index) VALUES (?, ?, ?, ?, ?)"
    );
    sqlite.transaction(() => {
      PAYMENT_GATEWAY_CATALOG.forEach((g, i) => ins.run(g.key, g.name, g.kind, g.feesNote ?? null, i));
    })();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Local calendar date — invoices/expenses are dated in the shop's timezone,
// not UTC, so "overdue" flips at local midnight like the owner expects.
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Totals are always server-computed from the line items — the client-supplied
// subtotal/tax/total are ignored so the books can't be desynced by a stale UI.
// Throws (zod) on malformed line items so callers surface a 400, same as the
// CRM estimate equivalent.
function computeTotals(itemsJson: string, taxRateBp: number) {
  const items = lineItemsSchema.parse(parseLineItems(itemsJson));
  const subtotalCents = lineItemsTotalCents(items);
  // Tax rate can't go below zero — a negative rate would refund tax against the
  // subtotal. Clamp as a backstop even though the schema also rejects it now.
  const bp = Math.max(0, taxRateBp);
  const taxCents = Math.round((subtotalCents * bp) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
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

function presentInvoice(inv: Invoice, today: string) {
  return { ...inv, status: derivedStatus(inv, today), balanceCents: inv.totalCents - inv.paidCents };
}

// Document numbers: PREFIX-<year>-<4-digit seq>. Seq is derived from max id,
// which only ever grows, so numbers never reuse after a delete. The UNIQUE
// constraint on `number` is the arbiter under concurrency — on conflict we
// bump the seq and retry (bounded, so a pathological table can't spin forever).
function insertNumbered<T>(
  table: "fin_invoices" | "fin_purchase_orders",
  prefix: "INV" | "PO",
  doInsert: (num: string) => T
): T {
  const base =
    (sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`).get() as { m: number }).m + 1;
  const year = new Date().getFullYear();
  for (let i = 0; i < 25; i++) {
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

// Cross-module reads into CRM. The tables belong to crm.ts; if that module
// isn't wired yet these queries would throw "no such table", so they degrade
// to "not found" instead of 500ing the whole finance page.
function clientNameById(id: number): string | null {
  try {
    return db.select({ name: clients.name }).from(clients).where(eq(clients.id, id)).get()?.name ?? null;
  } catch {
    return null;
  }
}

function estimateById(id: number): Estimate | undefined {
  try {
    return db.select().from(estimates)
      .where(and(eq(estimates.id, id), isNull(estimates.deletedAt)))
      .get();
  } catch {
    return undefined;
  }
}

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

      const token = crypto.randomBytes(24).toString("hex");
      const inserted = sqlite.prepare(`
        INSERT INTO review_requests (token, name, email, invoice_id)
        VALUES (?, ?, ?, ?)
      `).run(token, name, email, inv.id);

      if (mailEnabled() && email) {
        const first = (name ?? "").trim().split(/\s+/)[0] || "there";
        const ok = await sendMail({
          to: email,
          subject: "How did we do? — CJM Metals",
          text:
            `Hi ${first},\n\n` +
            `Thanks for choosing CJM Metals for your project. If you have a ` +
            `minute, we'd really appreciate a quick review — it takes about ` +
            `30 seconds:\n\n` +
            `${PUBLIC_SITE_URL}/review/${token}\n\n` +
            `Thank you!\n\n` +
            `— CJM Metals · Arlington, TX`,
        });
        if (ok) {
          sqlite.prepare("UPDATE review_requests SET sent_at = ? WHERE id = ?")
            .run(Date.now(), inserted.lastInsertRowid);
        }
      }

      // Always surface the ask in-app too — with no email on file (or no
      // mailer) the task is the only prompt the owner gets.
      db.insert(mkTasks).values({
        title: `Ask ${name ?? `the customer on ${inv.number}`} for a review`,
        kind: "review_request",
        status: "open",
        autoCreated: true,
        dueAt: Date.now(),
        notes: `Invoice ${inv.number} paid.`,
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
// mailer or no client email on file.

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

function queuePaymentReceipt(inv: Invoice, amountCents: number): void {
  setImmediate(async () => {
    try {
      if (!mailEnabled() || inv.clientId == null) return;
      const client = db.select({ name: clients.name, email: clients.email })
        .from(clients).where(eq(clients.id, inv.clientId)).get();
      if (!client?.email) return;

      const first = (client.name ?? inv.clientName ?? "").trim().split(/\s+/)[0] || "there";
      const balanceCents = inv.totalCents - inv.paidCents;
      await sendMail({
        to: client.email,
        subject: `Received ${usd(amountCents)} on ${inv.number} — CJM Metals`,
        text:
          `Hi ${first},\n\n` +
          `We received your payment of ${usd(amountCents)} on invoice ${inv.number}. ` +
          (balanceCents > 0
            ? `Remaining balance: ${usd(balanceCents)}.\n\n`
            : `Your invoice is paid in full — thank you!\n\n`) +
          `— CJM Metals · Arlington, TX`,
      });
    } catch (e) {
      console.error("[finance] payment-receipt hook failed", e);
    }
  });
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

export function registerFinanceRoutes(app: Express): void {
  // Express types `req.params.*` as `string | string[]`; narrow to string.
  const pid = (v: string | string[]): number => parseInt(v as string, 10);
  const pkey = (v: string | string[]): string => v as string;
  const qstr = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

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
    const outstandingCents = db.select({
      v: sql<number>`COALESCE(SUM(${invoices.totalCents} - ${invoices.paidCents}), 0)`,
    }).from(invoices).where(receivableWhere).get()?.v ?? 0;

    const overdueCents = db.select({
      v: sql<number>`COALESCE(SUM(${invoices.totalCents} - ${invoices.paidCents}), 0)`,
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

    const enabledGateways = db.select({ c: sql<number>`COUNT(*)` })
      .from(paymentGateways)
      .where(eq(paymentGateways.enabled, true))
      .get()?.c ?? 0;

    res.json({
      outstandingCents,
      overdueCents,
      paidThisMonthCents,
      expensesThisMonthCents,
      netThisMonthCents: paidThisMonthCents - expensesThisMonthCents,
      draftInvoices,
      enabledGateways,
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
      const balance = inv.totalCents - inv.paidCents;
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
    let body, itemsJson, totals;
    try {
      // Items arrive as a JSON string (the column shape) or a raw array —
      // same tolerance as the CRM estimate endpoints.
      const raw = { ...req.body };
      if (Array.isArray(raw.items)) raw.items = JSON.stringify(raw.items);
      body = insertInvoiceSchema.parse(raw);
      itemsJson = body.items ?? "[]";
      totals = computeTotals(itemsJson, body.taxRateBp ?? 0);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    // Snapshot the client's name at issue time — the invoice keeps displaying
    // correctly even if the CRM client is later renamed or deleted.
    let clientName = body.clientName ?? null;
    if (!clientName && body.clientId != null) clientName = clientNameById(body.clientId);

    const row = insertNumbered("fin_invoices", "INV", (num) =>
      db.insert(invoices)
        .values({ ...body, number: num, items: itemsJson, clientName, ...totals })
        .returning()
        .get()
    );
    audit(req, "finance.invoice_create", {
      targetType: "invoice", targetId: row.id, targetName: row.number,
      details: { totalCents: row.totalCents, clientId: row.clientId },
    });
    res.status(201).json(presentInvoice(row, todayLocal()));
  });

  // Literal segment — must be registered before any /invoices/:id sibling.
  app.post("/api/finance/invoices/from-estimate/:estimateId", requireElevated, (req, res) => {
    const est = estimateById(pid(req.params.estimateId));
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    const totals = computeTotals(est.items, est.taxRateBp);
    const clientName = est.clientId != null ? clientNameById(est.clientId) : null;
    const row = insertNumbered("fin_invoices", "INV", (num) =>
      db.insert(invoices).values({
        number: num,
        clientId: est.clientId,
        clientName,
        estimateId: est.id,
        status: "draft",
        issueDate: todayLocal(),
        items: est.items,
        taxRateBp: est.taxRateBp,
        ...totals,
        // The estimate's title lives in notes — invoices have no title column.
        notes: `From estimate ${est.number} — ${est.title}`,
      }).returning().get()
    );
    audit(req, "finance.invoice_create", {
      targetType: "invoice", targetId: row.id, targetName: row.number,
      details: { fromEstimate: est.number, totalCents: row.totalCents },
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

  app.patch("/api/finance/invoices/:id", requireElevated, (req, res) => {
    const inv = getInvoice(pid(req.params.id));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    let body;
    try {
      const raw = { ...req.body };
      if (Array.isArray(raw.items)) raw.items = JSON.stringify(raw.items);
      body = insertInvoiceSchema.partial().parse(raw);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    // Once money has been recorded against an invoice its line items and
    // totals are immutable — editing them would silently corrupt paid/balance
    // math. The escape hatch is voiding and reissuing. (Totals themselves are
    // schema-stripped, so items/taxRateBp are the only money inputs.)
    const touchesMoney = body.items !== undefined || body.taxRateBp !== undefined;
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
      // become billable again on the reissued invoice.
      if (body.status === "void") releaseBilledItems(inv.id);
    }
    res.json(presentInvoice(row, todayLocal()));
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

    const payment = db.insert(invoicePayments)
      .values({ invoiceId: inv.id, ...body })
      .returning()
      .get();
    // Auto-status from the running paid total: covered → paid, anything → partial.
    const paidCents = inv.paidCents + body.amountCents;
    // A $0-total invoice must not auto-settle to "paid" (mirrors the reversal
    // path's `&& inv.totalCents > 0` guard below).
    const status: InvoiceStatus =
      paidCents >= inv.totalCents && inv.totalCents > 0 ? "paid" : "partial";
    const updated = db.update(invoices)
      .set({ paidCents, status })
      .where(eq(invoices.id, inv.id))
      .returning()
      .get();

    // Newly settled → queue the review ask (deferred; can never break this path).
    if (status === "paid" && inv.status !== "paid") queueReviewRequest(updated);
    // Every recorded payment → receipt email to the customer (same contract).
    queuePaymentReceipt(updated, body.amountCents);

    audit(req, "finance.payment_record", {
      targetType: "invoice", targetId: inv.id, targetName: inv.number,
      details: { amountCents: body.amountCents, method: body.method, newStatus: status },
    });
    res.status(201).json({ payment, invoice: presentInvoice(updated, todayLocal()) });
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
      // void stays void; otherwise: covered → paid, some → partial, none →
      // back to sent (if it ever went out) or draft.
      let status = inv.status;
      if (inv.status !== "void") {
        status =
          paidCents >= inv.totalCents && inv.totalCents > 0 ? "paid"
          : paidCents > 0 ? "partial"
          : inv.sentAt ? "sent"
          : "draft";
      }
      updated = db.update(invoices)
        .set({ paidCents, status })
        .where(eq(invoices.id, inv.id))
        .returning()
        .get();

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
    const invoicedCents = live.reduce((s, i) => s + i.totalCents, 0);
    const paidCents = live.reduce((s, i) => s + i.paidCents, 0);
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

    const today = todayLocal();
    res.json({
      invoices: live.map((i) => presentInvoice(i, today)),
      totals: {
        invoicedCents,
        paidCents,
        outstandingCents: invoicedCents - paidCents,
        expenseCents,
        laborMinutes,
        laborCostCents,
        // What's left after materials + labor if everything billed gets paid.
        marginCents: invoicedCents - expenseCents - laborCostCents,
      },
    });
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

  app.post("/api/finance/expenses", requireElevated, (req, res) => {
    let body;
    try {
      body = insertExpenseSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const row = db.insert(expenses).values(body).returning().get();
    audit(req, "finance.expense_create", {
      targetType: "expense", targetId: row.id, targetName: row.vendor ?? row.category,
      details: { amountCents: row.amountCents, category: row.category },
    });
    res.status(201).json(row);
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

  // ─── Payment gateways ────────────────────────────────────────────────────

  app.get("/api/finance/gateways", requireElevated, (_req, res) => {
    const catalogByKey = new Map(PAYMENT_GATEWAY_CATALOG.map((g) => [g.key, g]));
    const rows = db.select().from(paymentGateways)
      .orderBy(asc(paymentGateways.orderIndex), asc(paymentGateways.id))
      .all();
    // Fall back to the catalog's fees note so wiping the field in the UI
    // restores the stock guidance instead of leaving it blank.
    res.json(rows.map((r) => ({
      ...r,
      feesNote: r.feesNote ?? catalogByKey.get(r.key)?.feesNote ?? null,
    })));
  });

  app.patch("/api/finance/gateways/:key", requireElevated, (req, res) => {
    const gw = db.select().from(paymentGateways)
      .where(eq(paymentGateways.key, pkey(req.params.key)))
      .get();
    if (!gw) return res.status(404).json({ message: "Gateway not found" });
    let body;
    try {
      body = updateGatewaySchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    // config is persisted as-is and parsed by the client — reject garbage now
    // rather than blowing up the settings page later.
    if (body.config !== undefined) {
      try {
        JSON.parse(body.config);
      } catch {
        return res.status(400).json({ message: "config must be a valid JSON string" });
      }
    }

    const row = db.update(paymentGateways)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(paymentGateways.id, gw.id))
      .returning()
      .get();
    if (body.enabled !== undefined && body.enabled !== gw.enabled) {
      audit(req, "finance.gateway_toggle", {
        targetType: "gateway", targetId: gw.id, targetName: gw.name,
        details: { enabled: body.enabled },
      });
    }
    res.json(row);
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
        .values({ ...body, number: num, items: itemsJson, totalCents })
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
    }
    res.json(row);
  });

  app.delete("/api/finance/purchase-orders/:id", requireElevated, (req, res) => {
    const existing = db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, pid(req.params.id)), isNull(purchaseOrders.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Purchase order not found" });
    db.update(purchaseOrders).set({ deletedAt: Date.now() }).where(eq(purchaseOrders.id, existing.id)).run();
    audit(req, "finance.po_delete", {
      targetType: "purchase_order", targetId: existing.id, targetName: existing.number,
    });
    res.json({ ok: true });
  });
}
