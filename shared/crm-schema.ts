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

// Which family website a lead arrived from — all four sites share the one
// intake endpoint; 'metals' is the original cjmmetals.com.
export const LEAD_SITES = ["metals", "concrete", "insulation", "trades"] as const;
export type LeadSite = (typeof LEAD_SITES)[number];

// Public domain per family site. It lives here beside LEAD_SITES rather than in
// one route file because more than one place has to name the sending shop: the
// lead's "From <domain>" note, the audit userName and the owner email
// (public-api.ts), and the per-site dead-pipe alarm (automations.ts, which
// deliberately imports no other server module — a shared schema is fine).
export const SITE_DOMAINS: Record<LeadSite, string> = {
  metals: "cjmmetals.com",
  concrete: "cjm-concrete.com",
  insulation: "cjminsulation.com",
  trades: "cjmtrades.com",
};

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
  // Which family website sent the lead (see LEAD_SITES).
  site: text("site", { enum: LEAD_SITES }).notNull().default("metals"),
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

// Touch log for leads / clients — powers "last contact" and the
// activity feed on detail views.
export const crmActivities = sqliteTable("crm_activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type", { enum: ["lead", "client"] }).notNull(),
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

export const insertCrmActivitySchema = z.object({
  entityType: z.enum(["lead", "client"]),
  entityId: z.number().int(),
  kind: z.enum(ACTIVITY_KINDS),
  notes: z.string().optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Client = typeof clients.$inferSelect;
export type Lead = typeof leads.$inferSelect;
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

export const leadSiteLabel: Record<LeadSite, string> = {
  metals: "CJM Metals",
  concrete: "CJM Concrete",
  insulation: "CJM Insulation",
  trades: "CJM Trades",
};

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};
