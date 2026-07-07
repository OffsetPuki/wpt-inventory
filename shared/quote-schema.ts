import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Quote builder (ported CJM Quote app) ────────────────────────────────────
// A quote is the full builder session stored as one JSON payload — the
// configurator state, per-item overrides, markups, customer card, notes. The
// payload shape is owned by client/src/quote (it evolved through the .exe
// versions and carries its own migration in QuoteBuilder.migrateSession), so
// the columns here are just the identity + list-view fields.

export const QUOTE_TYPES = ["fence", "gate", "carport", "railing", "pergola"] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

// Share/accept lifecycle: draft (builder only) → sent (share link created) →
// accepted / declined. Mirrors crm_estimates' statuses minus "expired".
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(), // "Q-2026-0001", server-assigned
  type: text("type", { enum: QUOTE_TYPES }).notNull(),
  customerName: text("customer_name"),
  designRef: text("design_ref"), // website design code ("CJM-F7K2") if started from one
  // Display metadata for the list view. Computed by the builder's pricing
  // engine, which lives client-side — unlike crm_estimates this is not a
  // server-verified financial total.
  totalCents: integer("total_cents").notNull().default(0),
  payload: text("payload").notNull().default("{}"), // JSON: full builder session
  // Customer-facing share link (cjmmetals.com/quote/<token>). NULL until the
  // owner shares the quote; 48 hex chars, server-generated, never reused.
  shareToken: text("share_token"),
  status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
  sentAt: integer("sent_at"), // unix ms — first share
  acceptedAt: integer("accepted_at"), // unix ms — customer accepted via the link
  acceptNote: text("accept_note"), // optional message left when accepting
  acceptIp: text("accept_ip"), // where the acceptance came from (dispute trail)
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at"), // unix ms
  deletedAt: integer("deleted_at"),
});

// Singleton row (id = 1): the shop's price book + identity block for the
// printed quote. Managed via raw SQL in server/quotes.ts, but the definition
// must stay in this schema file — drizzle-kit db:push diffs against it and
// would otherwise propose DROP TABLE quote_settings (the live price book).
export const quoteSettings = sqliteTable("quote_settings", {
  id: integer("id").primaryKey(),
  priceBook: text("price_book").notNull().default("{}"), // JSON object
  shop: text("shop").notNull().default("{}"), // JSON { name, location, phone, email }
  updatedAt: integer("updated_at"), // unix ms
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  number: true, // server-assigned
  // Share/accept lifecycle is server-managed (POST /:id/share + the public
  // accept endpoint) — a client write could forge an acceptance.
  shareToken: true,
  status: true,
  sentAt: true,
  acceptedAt: true,
  acceptNote: true,
  acceptIp: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const quoteSettingsSchema = z.object({
  priceBook: z.record(z.unknown()),
  shop: z.record(z.unknown()),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Quote = typeof quotes.$inferSelect;

// ─── Label maps (client display) ─────────────────────────────────────────────

export const QUOTE_TYPE_LABELS: Record<QuoteType, string> = {
  fence: "Fence",
  gate: "Gate",
  carport: "Carport",
  railing: "Railing",
  pergola: "Pergola",
};
