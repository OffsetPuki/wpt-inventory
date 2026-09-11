import { projects, users } from "./schema";
import { pmTasks } from "./pm-schema";
// Catalog of additive suite tables. Runtime migrations live with their modules.
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const suiteChangeBills = sqliteTable("suite_change_bills", {
  changeOrderId: integer("change_order_id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`unixepoch()*1000`),
});

export const suiteComments = sqliteTable(
  "suite_comments",
  {
    id: integer("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: integer("task_id").references(() => pmTasks.id),
    parentId: integer("parent_id"),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    visibility: text("visibility")
      .notNull()
      .default(sql`'team'`),
    attachments: text("attachments")
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
  },
  (t) => [index("suite_comments_project").on(t.projectId, t.id)],
);

export const suiteCostProposals = sqliteTable(
  "suite_cost_proposals",
  {
    id: integer("id").primaryKey(),
    receiptId: integer("receipt_id"),
    itemId: integer("item_id").notNull(),
    materialKey: text("material_key"),
    supplier: text("supplier"),
    unit: text("unit").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    status: text("status")
      .notNull()
      .default(sql`'pending'`),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
    reviewedAt: integer("reviewed_at"),
  },
  (t) => [unique().on(t.receiptId)],
);

export const suiteCostStart = sqliteTable("suite_cost_start", {
  id: integer("id").primaryKey(),
  transactionId: integer("transaction_id").notNull(),
});

export const suiteFiles = sqliteTable(
  "suite_files",
  {
    id: integer("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    url: text("url").notNull(),
    kind: text("kind")
      .notNull()
      .default(sql`'photo'`),
    replacesId: integer("replaces_id"),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
  },
  (t) => [index("suite_files_project").on(t.projectId, t.id)],
);

export const suiteJobRules = sqliteTable("suite_job_rules", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id),
  depositRequired: integer("deposit_required")
    .notNull()
    .default(sql`0`),
  documentsRequired: text("documents_required")
    .notNull()
    .default(sql`'[]'`),
  tools: text("tools")
    .notNull()
    .default(sql`'[]'`),
  overrideReason: text("override_reason"),
  overrideBy: integer("override_by"),
  overrideAt: integer("override_at"),
});

export const suiteMail = sqliteTable("suite_mail", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  firstAttemptAt: integer("first_attempt_at"),
  acceptedAt: integer("accepted_at"),
  providerId: text("provider_id"),
});

export const suiteNotifications = sqliteTable(
  "suite_notifications",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    eventKey: text("event_key").notNull(),
    title: text("title").notNull(),
    href: text("href").notNull(),
    readAt: integer("read_at"),
    resolvedAt: integer("resolved_at"),
    snoozedUntil: integer("snoozed_until"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
  },
  (t) => [
    index("suite_notifications_user").on(t.userId, t.id),
    unique().on(t.userId, t.eventKey),
  ],
);

export const suiteOutbox = sqliteTable(
  "suite_outbox",
  {
    id: integer("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    status: text("status")
      .notNull()
      .default(sql`'pending'`),
    attempts: integer("attempts")
      .notNull()
      .default(sql`0`),
    availableAt: integer("available_at")
      .notNull()
      .default(sql`0`),
    lockedAt: integer("locked_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
    completedAt: integer("completed_at"),
  },
  (t) => [unique().on(t.eventKey)],
);

export const suitePhotoPreviews = sqliteTable("suite_photo_previews", {
  url: text("url").primaryKey(),
  thumbnailUrl: text("thumbnail_url").notNull(),
});

export const suiteRecordVersions = sqliteTable(
  "suite_record_versions",
  {
    entity: text("entity").notNull(),
    id: integer("id").notNull(),
    version: integer("version")
      .notNull()
      .default(sql`1`),
  },
  (t) => [primaryKey({ columns: [t.entity, t.id] })],
);

export const suiteRestoreChecks = sqliteTable("suite_restore_checks", {
  id: integer("id").primaryKey(),
  backupName: text("backup_name").notNull(),
  sha256: text("sha256").notNull(),
  result: text("result").notNull(),
  notes: text("notes").notNull(),
  verifiedBy: integer("verified_by").notNull(),
  verifiedAt: integer("verified_at").notNull(),
});

export const suiteReviewActions = sqliteTable(
  "suite_review_actions",
  {
    id: integer("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    projectId: integer("project_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    href: text("href").notNull(),
    resolvedAt: integer("resolved_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
  },
  (t) => [unique().on(t.eventKey)],
);

export const suiteRevisions = sqliteTable("suite_revisions", {
  topic: text("topic").primaryKey(),
  version: integer("version")
    .notNull()
    .default(sql`0`),
});

export const suiteStockCosts = sqliteTable(
  "suite_stock_costs",
  {
    invoiceId: integer("invoice_id"),
    id: integer("id").primaryKey(),
    transactionId: integer("transaction_id").notNull(),
    lotId: integer("lot_id"),
    projectId: integer("project_id"),
    itemId: integer("item_id").notNull(),
    quantity: real("quantity").notNull(),
    unitCost: real("unit_cost"),
    returned: real("returned")
      .notNull()
      .default(sql`0`),
  },
  (t) => [index("suite_stock_costs_job").on(t.projectId, t.itemId, t.id)],
);

export const suiteStockLots = sqliteTable(
  "suite_stock_lots",
  {
    id: integer("id").primaryKey(),
    itemId: integer("item_id").notNull(),
    receiptId: integer("receipt_id"),
    quantity: real("quantity").notNull(),
    remaining: real("remaining").notNull(),
    unitCost: real("unit_cost"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`unixepoch()*1000`),
  },
  (t) => [
    index("suite_stock_lots_item").on(t.itemId, t.id),
    unique().on(t.receiptId),
  ],
);
