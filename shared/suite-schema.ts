import { projects, users } from "./schema";
import {clients as crmClients} from './crm-schema';
import {quotes} from './quote-schema';
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
  uniqueIndex,
  check,
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

export const crmLeadIntake = sqliteTable('crm_lead_intake', {
 leadId:integer('lead_id').primaryKey(), context:text('context').notNull().default('{}'), firstContactAt:integer('first_contact_at'), qualifiedAt:integer('qualified_at'), surveyAt:integer('survey_at'), updatedAt:integer('updated_at').notNull(),
});
export const webLeadAccess = sqliteTable('web_lead_access', {
 tokenHash:text('token_hash').primaryKey(), leadId:integer('lead_id').notNull(), site:text('site').notNull(), expiresAt:integer('expires_at').notNull(),
},t=>[index('idx_web_lead_access_lead').on(t.leadId)]);
export const webLeadSupplements = sqliteTable('web_lead_supplements', {
 submissionId:text('submission_id').primaryKey(), tokenHash:text('token_hash').notNull(), payloadHash:text('payload_hash').notNull(), createdAt:integer('created_at').notNull(),
});

// Roadmap additions remain in the schema-tool catalog as well as additive
// runtime migrations; schema maintenance must never drop their saved history.
export const crmAccountContacts=sqliteTable('crm_account_contacts',{
 contactId:integer('contact_id').primaryKey(),accountId:integer('account_id').notNull(),primaryBilling:integer('primary_billing').notNull().default(0),
},t=>[index('crm_account_contacts_account').on(t.accountId),uniqueIndex('crm_account_primary_billing').on(t.accountId).where(sql`${t.primaryBilling}=1`),check('crm_account_distinct',sql`${t.contactId}!=${t.accountId}`)]);
export const suiteJobCompletion=sqliteTable('suite_job_completion',{
 projectId:integer('project_id').notNull().references(()=>projects.id),item:text('item').notNull(),state:text('state').notNull(),note:text('note').notNull(),updatedAt:integer('updated_at').notNull(),updatedBy:integer('updated_by').notNull().references(()=>users.id),
},t=>[primaryKey({columns:[t.projectId,t.item]})]);
export const suiteTemplateRuns=sqliteTable('suite_template_runs',{
 projectId:integer('project_id').primaryKey(),templateKey:text('template_key').notNull(),templateVersion:text('template_version').notNull(),definitionJson:text('definition_json').notNull(),parametersJson:text('parameters_json').notNull(),createdAt:integer('created_at').notNull(),
});
export const suiteServiceHealth=sqliteTable('suite_service_health',{
 name:text('name').primaryKey(),startedAt:integer('started_at'),completedAt:integer('completed_at'),lastError:text('last_error'),
});
export const suiteErrorEvents=sqliteTable('suite_error_events',{
 id:text('id').primaryKey(),method:text('method').notNull(),route:text('route').notNull(),status:integer('status').notNull(),release:text('release').notNull(),durationMs:integer('duration_ms').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('suite_error_age').on(t.createdAt)]);
export const mkPageImprovements=sqliteTable('mk_page_improvements',{
 taskId:integer('task_id').primaryKey(),site:text('site').notNull(),path:text('path').notNull(),hypothesis:text('hypothesis').notNull(),period:text('period'),evidence:text('evidence'),createdAt:integer('created_at').notNull(),campaign:text('campaign').notNull().default(''),changeDate:text('change_date'),changeNote:text('change_note'),version:integer('version').notNull().default(1),
},t=>[index('mk_page_improvements_page').on(t.site,t.path,t.createdAt)]);
export const suiteDesigns=sqliteTable('suite_designs',{
 id:integer('id').primaryKey({autoIncrement:true}),name:text('name').notNull(),modelKey:text('model_key').notNull(),modelRevision:text('model_revision').notNull(),
 projectId:integer('project_id').references(()=>projects.id),clientId:integer('client_id').references(()=>crmClients.id),quoteId:integer('quote_id').references(()=>quotes.id),
 approvedAt:integer('approved_at'),approvedBy:integer('approved_by').references(()=>users.id),archivedAt:integer('archived_at'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[index('suite_designs_job').on(t.projectId,t.archivedAt,t.updatedAt)]);
export const suiteDesignHistory=sqliteTable('suite_design_history',{
 id:integer('id').primaryKey({autoIncrement:true}),designId:integer('design_id').notNull().references(()=>suiteDesigns.id),snapshotJson:text('snapshot_json').notNull(),createdAt:integer('created_at').notNull(),createdBy:integer('created_by').notNull().references(()=>users.id),
});
export const suiteDesignMeasurements=sqliteTable('suite_design_measurements',{
 id:integer('id').primaryKey({autoIncrement:true}),designId:integer('design_id').notNull().references(()=>suiteDesigns.id),modelRevision:text('model_revision').notNull(),part:text('part').notNull(),dimension:text('dimension').notNull(),valueMm:real('value_mm').notNull(),toleranceMm:real('tolerance_mm').notNull(),enteredUnit:text('entered_unit').notNull(),datum:text('datum').notNull(),source:text('source').notNull(),reference:text('reference').notNull(),measuredDate:text('measured_date').notNull(),sourceFileId:integer('source_file_id').references(()=>suiteFiles.id),verifiedById:integer('verified_by_id').notNull().references(()=>users.id),verifiedAt:integer('verified_at').notNull(),
},t=>[unique().on(t.designId,t.modelRevision,t.part,t.dimension)]);
export const suiteJobForecasts=sqliteTable('suite_job_forecasts',{
 projectId:integer('project_id').primaryKey().references(()=>projects.id),revenueCents:integer('revenue_cents'),materialCents:integer('material_cents'),laborCents:integer('labor_cents'),otherCents:integer('other_cents'),note:text('note').notNull(),sourceVersion:text('source_version').notNull(),reviewedBy:integer('reviewed_by').notNull().references(()=>users.id),reviewedAt:integer('reviewed_at').notNull(),
});
export const suiteJobForecastHistory=sqliteTable('suite_job_forecast_history',{
 id:integer('id').primaryKey({autoIncrement:true}),projectId:integer('project_id').notNull().references(()=>projects.id),snapshotJson:text('snapshot_json').notNull(),createdAt:integer('created_at').notNull(),createdBy:integer('created_by').notNull().references(()=>users.id),
},t=>[index('suite_job_forecast_history_job').on(t.projectId,t.id)]);
