import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// NOTE: leads live in crm-schema.ts (crm_leads) — the Marketing control
// center reads them for its source/attribution reporting rather than keeping
// a duplicate list. This file owns campaigns (FK-retained), reviews, the
// portfolio, and the automation settings. Tasks moved to pm_tasks
// (shared/pm-schema.ts) in Package C.

// ─── Enums ───────────────────────────────────────────────────────────────────

export const CAMPAIGN_CHANNELS = [
  "facebook",
  "instagram",
  "google_ads",
  "google_business",
  "marketplace",
  "email",
  "sms",
  "yard_signs",
  "print",
  "referral_program",
  "other",
] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_STATUSES = ["active", "paused", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const REVIEW_SOURCES = ["google", "yelp", "facebook", "website", "other"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

// Retained for the crm_leads.campaign_id FK only — the campaigns CRUD
// endpoints and UI are gone (Package C).
export const campaigns = sqliteTable("mk_campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  channel: text("channel", { enum: CAMPAIGN_CHANNELS }).notNull().default("other"),
  status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("active"),
  startDate: text("start_date"), // "YYYY-MM-DD"
  endDate: text("end_date"), // "YYYY-MM-DD"
  budgetCents: integer("budget_cents").notNull().default(0),
  spendCents: integer("spend_cents").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const reviews = sqliteTable("mk_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source", { enum: REVIEW_SOURCES }).notNull().default("google"),
  author: text("author"),
  rating: integer("rating").notNull().default(5), // 1–5
  text: text("text"),
  reviewDate: text("review_date"), // "YYYY-MM-DD"
  responded: integer("responded", { mode: "boolean" }).notNull().default(false),
  respondedAt: integer("responded_at"), // unix ms
  // Published reviews appear on the public testimonials feed that
  // www.cjmmetals.com renders — opt-in per review.
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  // Phase B #12: who reviewed us. Soft refs (ALTER'd columns) — client_id
  // points at crm_clients, request_id at the review_requests invitation the
  // website submit came through. NULL on manually logged reviews.
  clientId: integer("client_id"),
  requestId: integer("request_id"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// mk_tasks: the drizzle export is gone (Package C) — tasks live in pm_tasks.
// The table's DDL stays in server/marketing.ts (existing installs; migration
// source for the one-shot copy in server/pm.ts, which reads it via raw SQL).

// "Recent work" gallery published to www.cjmmetals.com — photos uploaded via
// the normal /api/upload flow, curated and ordered here.
export const portfolioItems = sqliteTable("mk_portfolio", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category"), // "Gates", "Fencing", … (free text)
  photoUrl: text("photo_url").notNull(), // /uploads/… path
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Singleton row (id=1) with the automation knobs.
export const marketingSettings = sqliteTable("mk_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  staleLeadDays: integer("stale_lead_days").notNull().default(7),
  quoteFollowUpDays: integer("quote_follow_up_days").notNull().default(3),
  // Alert in the Overview when a campaign's cost-per-lead rises above this.
  cplAlertCents: integer("cpl_alert_cents").notNull().default(15000),
  autoReviewRequest: integer("auto_review_request", { mode: "boolean" })
    .notNull()
    .default(true),
  // Current shop lead time in weeks, shown as a banner on www.cjmmetals.com
  // (via GET /api/public/site-info). NULL = unset → the site hides the banner.
  leadTimeWeeks: integer("lead_time_weeks"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  createdAt: true,
  respondedAt: true,
});

export const insertPortfolioItemSchema = createInsertSchema(portfolioItems).omit({
  id: true,
  createdAt: true,
});

export const updateMarketingSettingsSchema = z.object({
  staleLeadDays: z.number().int().min(1).max(365).optional(),
  quoteFollowUpDays: z.number().int().min(1).max(90).optional(),
  cplAlertCents: z.number().int().min(0).optional(),
  autoReviewRequest: z.boolean().optional(),
  leadTimeWeeks: z.number().int().min(0).max(52).nullable().optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Review = typeof reviews.$inferSelect;
export type MarketingSettings = typeof marketingSettings.$inferSelect;
export type PortfolioItem = typeof portfolioItems.$inferSelect;
export type InsertPortfolioItem = z.infer<typeof insertPortfolioItemSchema>;

export type InsertReview = z.infer<typeof insertReviewSchema>;

// ─── Label maps ──────────────────────────────────────────────────────────────

export const REVIEW_SOURCE_LABELS: Record<ReviewSource, string> = {
  google: "Google",
  yelp: "Yelp",
  facebook: "Facebook",
  website: "Website",
  other: "Other",
};
