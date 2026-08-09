import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projects } from "./schema";
import { clients } from "./crm-schema";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partial",
  "paid",
  "overdue",
  "void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "materials",
  "fuel",
  "tools_equipment",
  "rent",
  "utilities",
  "marketing",
  "insurance",
  "software",
  "travel",
  "meals",
  "taxes_fees",
  "subcontractors",
  "payroll",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = [
  "cash",
  "check",
  "bank_transfer",
  "card",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PO_STATUSES = ["open", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

export const invoices = sqliteTable("fin_invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(), // "INV-2026-0001"
  clientId: integer("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  clientName: text("client_name"), // denormalized for display + unlinked clients
  // Kept for existing rows; the crm_estimates table (and its FK) is gone.
  estimateId: integer("estimate_id"),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
  issueDate: text("issue_date"), // "YYYY-MM-DD"
  dueDate: text("due_date"), // "YYYY-MM-DD"
  items: text("items").notNull().default("[]"), // JSON LineItem[]
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  paidCents: integer("paid_cents").notNull().default(0),
  // Deposit the customer agreed to online (quote depositPct) — display/chase
  // only, never part of the total math. Nullable, ALTER'd in finance.ts.
  depositCents: integer("deposit_cents"),
  // Phase G #3: commercial retainage the GC withholds. Server-derived from the
  // retainagePct the editor sends (round(total × pct)); nullable, ALTER'd in
  // finance.ts. Retainage stays part of totalCents (it IS earned revenue) —
  // it only reduces the due-now balance until it's billed via the project's
  // "Bill retainage" release invoice, which stamps retainage_released_at.
  retainageCents: integer("retainage_cents"),
  retainageReleasedAt: integer("retainage_released_at"), // unix ms
  // Soft ref to crm_leads (no FK — cross-module). Stamped by the quote-accept
  // hook so a fully paid invoice can push realized revenue back onto the lead.
  leadId: integer("lead_id"),
  sentAt: integer("sent_at"), // unix ms
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const invoicePayments = sqliteTable("fin_invoice_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: text("method", { enum: PAYMENT_METHODS }).notNull().default("other"),
  // Kept for existing rows only — the payment-gateway registry is gone. No
  // type/FK coupling; the reference field is where transaction ids live.
  gatewayKey: text("gateway_key"),
  reference: text("reference"), // check #, transaction id, …
  paidAt: text("paid_at"), // "YYYY-MM-DD"
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const expenses = sqliteTable("fin_expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // "YYYY-MM-DD"
  vendor: text("vendor"),
  category: text("category", { enum: EXPENSE_CATEGORIES })
    .notNull()
    .default("other"),
  amountCents: integer("amount_cents").notNull().default(0),
  paymentMethod: text("payment_method", { enum: PAYMENT_METHODS })
    .notNull()
    .default("card"),
  receiptUrl: text("receipt_url"), // uploaded receipt photo
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  billable: integer("billable", { mode: "boolean" }).notNull().default(false),
  // "Billed on" stamp (wiring plan, Fix 4) — set when a billable expense is
  // pulled onto a draft invoice, cleared when that invoice is voided/deleted.
  // NULL + billable=1 ⇒ shows up as unbilled. Soft ref (ALTER'd column).
  invoiceId: integer("invoice_id"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

// Singleton row (id=1) — finance knobs (wiring plan, Fix 4). Markups are
// basis points (1500 = 15%): labor bills at the worker's HR pay rate ×
// (1 + laborMarkupBp), billable expenses at cost × (1 + expenseMarkupBp).
export const finSettings = sqliteTable("fin_settings", {
  id: integer("id").primaryKey(),
  laborMarkupBp: integer("labor_markup_bp").notNull().default(0),
  expenseMarkupBp: integer("expense_markup_bp").notNull().default(0),
  updatedAt: integer("updated_at"),
});

// App-native purchase orders (vendor orders the business sends out).
export const purchaseOrders = sqliteTable("fin_purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(), // "PO-2026-0001"
  vendor: text("vendor").notNull(),
  status: text("status", { enum: PO_STATUSES }).notNull().default("open"),
  items: text("items").notNull().default("[]"), // JSON LineItem[]
  totalCents: integer("total_cents").notNull().default(0),
  expectedDate: text("expected_date"), // "YYYY-MM-DD"
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertInvoiceSchema = createInsertSchema(invoices, {
  // Tax basis points can never be negative — a negative rate would credit tax
  // back against the subtotal. (computeTotals also clamps as a backstop.)
  taxRateBp: z.number().int().min(0).optional(),
}).omit({
  id: true,
  number: true, // server-assigned
  paidCents: true,
  // Server-managed by the quote-accept hook — a client write could fake a
  // deposit or re-point the CRM lead the paid sync updates.
  depositCents: true,
  leadId: true,
  sentAt: true,
  // Server-derived from the retainagePct payload field — a client writing the
  // cents directly could desync the balance math from the stored total.
  retainageCents: true,
  retainageReleasedAt: true,
  createdAt: true,
  deletedAt: true,
  // Server-derived from items + taxRateBp — never client-writable, or the
  // books could be desynced from the line items.
  subtotalCents: true,
  taxCents: true,
  totalCents: true,
});

// Phase G #3: "Retainage withheld %" from the invoice editor. Not a column —
// the server derives retainage_cents = round(total × pct) from it on save.
export const retainagePctSchema = z.number().min(0).max(100).nullable().optional();

export const insertInvoicePaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS).default("other"),
  reference: z.string().optional(),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
});

export const insertExpenseSchema = createInsertSchema(expenses, {
  // amount_cents carries a DB default, so drizzle-zod would otherwise accept
  // negative/zero. Mirror the client's `parseMoney(amount) <= 0` guard.
  amountCents: z.number().int().positive(),
}).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
  // Server-managed by the pull-unbilled flow (Fix 4) — a client write could
  // fake "already billed" or double-bill by clearing it.
  invoiceId: true,
});

export const updateFinSettingsSchema = z.object({
  laborMarkupBp: z.number().int().min(0).max(50000).optional(),
  expenseMarkupBp: z.number().int().min(0).max(50000).optional(),
});

export const pullUnbilledSchema = z.object({
  projectId: z.number().int(),
  laborMarkupBp: z.number().int().min(0).max(50000).optional(),
  expenseMarkupBp: z.number().int().min(0).max(50000).optional(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  number: true, // server-assigned
  createdAt: true,
  deletedAt: true,
  totalCents: true, // server-derived from items
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Invoice = typeof invoices.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type FinSettings = typeof finSettings.$inferSelect;

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;

// ─── Label maps ──────────────────────────────────────────────────────────────

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: "Materials",
  fuel: "Fuel",
  tools_equipment: "Tools & Equipment",
  rent: "Rent",
  utilities: "Utilities",
  marketing: "Marketing",
  insurance: "Insurance",
  software: "Software",
  travel: "Travel",
  meals: "Meals",
  taxes_fees: "Taxes & Fees",
  subcontractors: "Subcontractors",
  payroll: "Payroll",
  other: "Other",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  bank_transfer: "Bank Transfer",
  card: "Card",
  other: "Other",
};

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  open: "Open",
  received: "Received",
  cancelled: "Cancelled",
};
