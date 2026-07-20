import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, projects } from "./schema";
import { clients } from "./crm-schema";

// Project Management builds ON TOP of the existing `projects` table — tasks,
// time entries, timesheets, contracts, and the knowledge base all hang off
// the projects the shop already runs.

// ─── Enums ───────────────────────────────────────────────────────────────────

export const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const CONTRACT_KINDS = ["contract", "sow", "nda", "msa", "other"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_STATUSES = [
  "draft",
  "sent",
  "signed",
  "active",
  "expired",
  "terminated",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const TIMESHEET_STATUSES = ["open", "submitted", "approved"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

// Phase G: commercial-work toolkit.
export const CHANGE_ORDER_STATUSES = ["draft", "approved", "void"] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export const DOCUMENT_KINDS = ["coi", "w9", "lien_waiver", "contract", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

export const pmTasks = sqliteTable("pm_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
  priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("medium"),
  assigneeId: integer("assignee_id").references(() => users.id, {
    onDelete: "set null",
  }),
  startDate: text("start_date"), // "YYYY-MM-DD" — used by the Gantt view
  dueDate: text("due_date"), // "YYYY-MM-DD"
  estimateHours: real("estimate_hours"),
  orderIndex: integer("order_index").notNull().default(0), // position within kanban column
  completedAt: integer("completed_at"), // unix ms
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const timeEntries = sqliteTable("pm_time_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  taskId: integer("task_id").references(() => pmTasks.id, {
    onDelete: "set null",
  }),
  description: text("description"),
  startedAt: integer("started_at").notNull(), // unix ms
  endedAt: integer("ended_at"), // unix ms, null = timer running
  durationMin: integer("duration_min").notNull().default(0), // set on stop / manual entry
  billable: integer("billable", { mode: "boolean" }).notNull().default(true),
  // "Billed on" stamp (wiring plan, Fix 4) — soft ref to fin_invoices.id, set
  // when the entry is pulled onto a draft invoice, cleared on void/delete.
  // Server-managed only; insertTimeEntrySchema deliberately excludes it.
  invoiceId: integer("invoice_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Weekly approval wrapper over time entries. Hours themselves are computed
// from pm_time_entries for the week; this row just tracks the sign-off state.
export const timesheets = sqliteTable("pm_timesheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  weekStart: text("week_start").notNull(), // Monday, "YYYY-MM-DD"
  status: text("status", { enum: TIMESHEET_STATUSES }).notNull().default("open"),
  submittedAt: integer("submitted_at"), // unix ms
  approvedBy: integer("approved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  approvedAt: integer("approved_at"), // unix ms
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const contracts = sqliteTable("pm_contracts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  kind: text("kind", { enum: CONTRACT_KINDS }).notNull().default("contract"),
  clientId: integer("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  clientName: text("client_name"), // fallback when not linked to a CRM client
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("draft"),
  valueCents: integer("value_cents").notNull().default(0),
  startDate: text("start_date"), // "YYYY-MM-DD"
  endDate: text("end_date"), // "YYYY-MM-DD"
  // Phase D #21: the quote this contract was drawn from — soft ref to
  // quotes.number (the accept-created job's jobNumber equals it too).
  quoteRef: text("quote_ref"),
  // Phase D #22: warranty window in months from the linked job's completion;
  // the automations sweep turns it into a pre-expiry callback task.
  warrantyMonths: integer("warranty_months"),
  // Per-kind structured fields (JSON Record<string,string>) — a job contract
  // stores scope/payment/warranty, an NDA stores purpose/term, etc. The field
  // definitions live in the contracts page (KIND_FIELDS); the PDF renders
  // them as numbered sections. `body` below stays as free-form extra terms.
  fields: text("fields").notNull().default("{}"),
  body: text("body"), // additional free-form terms appended after the sections
  fileUrl: text("file_url"), // uploaded signed copy
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

// Phase G #1: commercial change orders — scope/price changes on a job after
// the contract is signed. amount_cents is SIGNED (deductive COs are negative);
// only APPROVED rows count toward the job's effective contract total.
export const changeOrders = sqliteTable("pm_change_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Soft ref to pm_contracts.id — informational only, no FK on purpose.
  contractId: integer("contract_id"),
  title: text("title").notNull(),
  description: text("description"),
  amountCents: integer("amount_cents").notNull().default(0), // signed
  status: text("status", { enum: CHANGE_ORDER_STATUSES }).notNull().default("draft"),
  approvedAt: integer("approved_at"), // unix ms
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

// Phase G #4: compliance documents (COI / W-9 / lien waivers / signed
// contracts). project_id NULL = company-level (the owner's own COI/W-9 sent to
// GCs). file_path is the stored filename in DATA_DIR/uploads; served through
// an authed endpoint (PDFs are deliberately not reachable via public /uploads).
export const pmDocuments = sqliteTable("pm_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  kind: text("kind", { enum: DOCUMENT_KINDS }).notNull().default("other"),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  expiresAt: text("expires_at"), // "YYYY-MM-DD" — feeds the renewal sweep
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const kbArticles = sqliteTable("pm_kb_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category"),
  content: text("content").notNull().default(""), // markdown
  tags: text("tags"), // JSON string[]
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  authorId: integer("author_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertPmTaskSchema = createInsertSchema(pmTasks).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
  completedAt: true,
});

export const insertTimeEntrySchema = z.object({
  // Nullable so a PATCH can CLEAR a link/description — undefined (dropped by
  // JSON) means "unchanged", null means "remove".
  projectId: z.number().int().nullable().optional(),
  taskId: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  // Manual entry: pass both; timer: server stamps startedAt, stop stamps endedAt.
  startedAt: z.number().int().optional(),
  endedAt: z.number().int().optional(),
  durationMin: z.number().int().nonnegative().optional(),
  billable: z.boolean().optional(),
});

export const insertContractSchema = createInsertSchema(contracts).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertChangeOrderSchema = createInsertSchema(changeOrders, {
  amountCents: z.number().int(), // signed — deductive COs are negative
}).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
  approvedAt: true, // server-stamped on the draft→approved transition
});

export const insertKbArticleSchema = createInsertSchema(kbArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type PmTask = typeof pmTasks.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Timesheet = typeof timesheets.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type ChangeOrder = typeof changeOrders.$inferSelect;
export type PmDocument = typeof pmDocuments.$inferSelect;
export type KbArticle = typeof kbArticles.$inferSelect;

export type InsertPmTask = z.infer<typeof insertPmTaskSchema>;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type InsertChangeOrder = z.infer<typeof insertChangeOrderSchema>;
export type InsertKbArticle = z.infer<typeof insertKbArticleSchema>;

// ─── Label maps ──────────────────────────────────────────────────────────────

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  contract: "Contract",
  sow: "SOW",
  nda: "NDA",
  msa: "MSA",
  other: "Other",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  approved: "Approved",
};

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  void: "Void",
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  coi: "COI",
  w9: "W-9",
  lien_waiver: "Lien waiver",
  contract: "Contract",
  other: "Other",
};
