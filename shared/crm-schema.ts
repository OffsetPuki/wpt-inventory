import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./schema";
import { campaigns } from "./marketing-schema";

// ─── Enums ───────────────────────────────────────────────────────────────────

// Funnel stages — shared language between CRM and the Marketing control
// center: new lead → contacted → quote sent → follow-up → won / lost.
export const LEAD_STAGES = [
  "new",
  "contacted",
  "quote_sent",
  "follow_up",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SOURCES = [
  "website",
  "facebook",
  "instagram",
  "google_business",
  "marketplace",
  "referral",
  "yard_sign",
  "repeat_customer",
  "phone",
  "walk_in",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const WIN_LOSS_REASONS = [
  "price",
  "no_response",
  "lost_to_competitor",
  "timing",
  "scope_changed",
  "good_fit",
  "referral_trust",
  "other",
] as const;
export type WinLossReason = (typeof WIN_LOSS_REASONS)[number];

export const DEAL_STAGES = [
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const ESTIMATE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const CLIENT_STATUSES = ["active", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const ACTIVITY_KINDS = ["call", "email", "meeting", "note"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

export const clients = sqliteTable("crm_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  status: text("status", { enum: CLIENT_STATUSES }).notNull().default("active"),
  tags: text("tags"), // JSON string[]
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const leads = sqliteTable("crm_leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source", { enum: LEAD_SOURCES }).notNull().default("other"),
  campaignId: integer("campaign_id").references(() => campaigns.id, {
    onDelete: "set null",
  }),
  serviceRequested: text("service_requested"),
  serviceArea: text("service_area"), // ZIP or city
  estimatedValueCents: integer("estimated_value_cents").notNull().default(0),
  stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
  assignedTo: integer("assigned_to").references(() => users.id, {
    onDelete: "set null",
  }),
  clientId: integer("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  lastContactAt: integer("last_contact_at"), // unix ms
  nextFollowUpAt: integer("next_follow_up_at"), // unix ms
  // Automation flag — set by the marketing sweep when a lead has had no
  // contact for the configured number of days; cleared on any new activity.
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  winLossReason: text("win_loss_reason", { enum: WIN_LOSS_REASONS }),
  revenueClosedCents: integer("revenue_closed_cents").notNull().default(0),
  // Raw first-touch UTM params from the website intake — `source` above is the
  // mapped CRM enum; these keep the unmapped strings for attribution reporting.
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  photos: text("photos"), // JSON string[] of /uploads URLs
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const deals = sqliteTable("crm_deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  clientId: integer("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  valueCents: integer("value_cents").notNull().default(0),
  stage: text("stage", { enum: DEAL_STAGES }).notNull().default("qualified"),
  ownerId: integer("owner_id").references(() => users.id, {
    onDelete: "set null",
  }),
  expectedCloseDate: text("expected_close_date"), // "YYYY-MM-DD"
  winLossReason: text("win_loss_reason", { enum: WIN_LOSS_REASONS }),
  closedAt: integer("closed_at"), // unix ms, set when stage becomes won/lost
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const products = sqliteTable("crm_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku"),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  unit: text("unit"), // "each", "hour", "ft", …
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const estimates = sqliteTable("crm_estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(), // "EST-2026-0001"
  title: text("title").notNull(),
  clientId: integer("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  dealId: integer("deal_id").references(() => deals.id, {
    onDelete: "set null",
  }),
  status: text("status", { enum: ESTIMATE_STATUSES }).notNull().default("draft"),
  items: text("items").notNull().default("[]"), // JSON LineItem[]
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxRateBp: integer("tax_rate_bp").notNull().default(0), // basis points (825 = 8.25%)
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  validUntil: text("valid_until"), // "YYYY-MM-DD"
  sentAt: integer("sent_at"), // unix ms
  decidedAt: integer("decided_at"), // unix ms — accepted or declined
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

// Touch log for leads / clients / deals — powers "last contact" and the
// activity feed on detail views.
export const crmActivities = sqliteTable("crm_activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type", { enum: ["lead", "client", "deal"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ACTIVITY_KINDS }).notNull().default("note"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
  stale: true,
});

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
  closedAt: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  number: true, // server-assigned
  createdAt: true,
  deletedAt: true,
  sentAt: true,
  decidedAt: true,
  // Server-derived from items + taxRateBp — accepting them would let a stale
  // or malicious client desync the stored totals from the line items.
  subtotalCents: true,
  taxCents: true,
  totalCents: true,
});

export const insertCrmActivitySchema = z.object({
  entityType: z.enum(["lead", "client", "deal"]),
  entityId: z.number().int(),
  kind: z.enum(ACTIVITY_KINDS),
  notes: z.string().optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Client = typeof clients.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Estimate = typeof estimates.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;

// ─── Label maps (client display) ─────────────────────────────────────────────

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quote_sent: "Quote Sent",
  follow_up: "Follow-up",
  won: "Won",
  lost: "Lost",
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  google_business: "Google Business",
  marketplace: "Marketplace",
  referral: "Referral",
  yard_sign: "Yard Sign",
  repeat_customer: "Repeat Customer",
  phone: "Phone",
  walk_in: "Walk-in",
  other: "Other",
};

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export const WIN_LOSS_REASON_LABELS: Record<WinLossReason, string> = {
  price: "Too expensive",
  no_response: "No response",
  lost_to_competitor: "Lost to competitor",
  timing: "Bad timing",
  scope_changed: "Scope changed",
  good_fit: "Good fit",
  referral_trust: "Referral / trust",
  other: "Other",
};

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};
