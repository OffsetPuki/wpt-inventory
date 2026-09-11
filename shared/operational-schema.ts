// Operational tables also belong to the schema catalog, so schema tools must
// preserve the payment, payroll, authentication, and intake audit records.
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  unique,
} from "drizzle-orm/sqlite-core";
import { invoicePayments } from "./finance-schema";

export const paymentReceipts = sqliteTable("fin_payment_receipts", {
  reference: text("reference").primaryKey(),
  paymentId: integer("payment_id")
    .notNull()
    .references(() => invoicePayments.id, { onDelete: "cascade" }),
});
export const paymentExceptions = sqliteTable("fin_payment_exceptions", {
  id: integer("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  invoiceId: integer("invoice_id"),
  kind: text("kind").notNull(),
  details: text("details").notNull(),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
});
export const checkoutSessions = sqliteTable("fin_checkout_sessions", {
  fingerprint: text("fingerprint").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  requestKey: text("request_key").notNull(),
  sessionId: text("session_id"),
  url: text("url"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const checkoutExpiryQueue = sqliteTable("fin_checkout_expiry_queue", {
  invoiceId: integer("invoice_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});
export const payRates = sqliteTable(
  "hr_pay_rates",
  {
    id: integer("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    effectiveDate: text("effective_date").notNull(),
    payType: text("pay_type").notNull(),
    rateCents: integer("rate_cents").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [unique().on(t.employeeId, t.effectiveDate)],
);
export const payrollRuns = sqliteTable(
  "hr_payroll_runs",
  {
    id: integer("id").primaryKey(),
    fromDate: text("from_date").notNull(),
    toDate: text("to_date").notNull(),
    snapshot: text("snapshot").notNull(),
    totalCents: integer("total_cents").notNull(),
    expenseId: integer("expense_id"),
    closedBy: integer("closed_by").notNull(),
    closedAt: integer("closed_at").notNull(),
  },
  (t) => [unique().on(t.fromDate, t.toDate)],
);
export const timeCorrections = sqliteTable("hr_time_corrections", {
  id: integer("id").primaryKey(),
  timeEntryId: integer("time_entry_id").notNull(),
  invoiceId: integer("invoice_id"),
  userId: integer("user_id").notNull(),
  minutesDelta: integer("minutes_delta").notNull(),
  effectiveDate: text("effective_date").notNull(),
  rateCents: integer("rate_cents").notNull(),
  reason: text("reason").notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const authEnrollment = sqliteTable("auth_enrollment", {
  userId: integer("user_id").primaryKey(),
  secret: text("secret").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const authTotpUsed = sqliteTable(
  "auth_totp_used",
  {
    userId: integer("user_id").notNull(),
    counter: integer("counter").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.counter] })],
);
export const authRecoveryCodes = sqliteTable(
  "auth_recovery_codes",
  {
    userId: integer("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);
export const leadReceipts = sqliteTable("web_lead_receipts", {
  submissionId: text("submission_id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
