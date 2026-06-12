import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  "electric",
  "welder",
  "it",
  "raw_materials",
  "tools",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const AREAS = [
  "main_shop",
  "machine_shop",
  "panel_shop",
  "concrete_pad",
  "shipping_container_1",
  "shipping_container_2",
] as const;
export type Area = (typeof AREAS)[number];

export const SHOP_AREAS = ["main_shop", "machine_shop", "panel_shop"] as const;
export type ShopArea = (typeof SHOP_AREAS)[number];

// "manager"   = high-level oversight (projects, users, dashboard) — simpler UI
// "technician" = full operational control (edit items, adjust stock, map, settings)
// "worker"    = floor user (find/add items, check in/out, view projects)
export const ROLES = ["manager", "technician", "worker"] as const;
export type Role = (typeof ROLES)[number];

export const TRANSACTION_TYPES = ["check_out", "check_in"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PROJECT_STATUSES = ["active", "done", "on_hold"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ITEM_TYPES = [
  "stock",
  "raw_material",
  "tool",
  "consumable",
  "service_spare",
  "job_reserved",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ADJUSTMENT_REASONS = [
  "damaged",
  "consumed",
  "scrap",
  "install_on_job",
  "missing",
  "count_correction",
  "returned_from_field",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const CHECKLIST_STATUS = [
  "pending",
  "ordered",
  "done",
  "skipped",
] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUS)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  pin: text("pin").notNull(),
  role: text("role", { enum: ROLES }).notNull().default("worker"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category", { enum: CATEGORIES }).notNull().default("tools"),
  photoUrl: text("photo_url"),
  photos: text("photos"), // JSON string[]
  quantity: integer("quantity").notNull().default(0),
  notes: text("notes"),
  // Location
  area: text("area", { enum: AREAS }),
  rackLetter: text("rack_letter"),
  rackLevel: integer("rack_level"),
  subLocation: text("sub_location"),
  shelf: text("shelf"),
  bin: text("bin"),
  // Tracking
  lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
  partNumber: text("part_number"),
  mfgPartNumber: text("mfg_part_number"),
  itemType: text("item_type", { enum: ITEM_TYPES }).notNull().default("stock"),
  quantityReserved: integer("quantity_reserved").notNull().default(0),
  // Equipment preset linkage
  equipmentType: text("equipment_type"),
  customAttrs: text("custom_attrs"), // JSON Record<string, string|number|null>
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  // Soft delete — null = active, otherwise the unix-ms when DELETE was called.
  // Hard purge runs in the reaper after a 30-day retention window.
  deletedAt: integer("deleted_at"),
});

export const adjustments = sqliteTable("adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  delta: integer("delta").notNull(),
  reason: text("reason", { enum: ADJUSTMENT_REASONS }).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: TRANSACTION_TYPES }).notNull(),
  quantity: integer("quantity").notNull(),
  notes: text("notes"),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobNumber: text("job_number").notNull().unique(),
  name: text("name").notNull(),
  customer: text("customer"),
  status: text("status", { enum: PROJECT_STATUSES })
    .notNull()
    .default("active"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  // Soft delete — see items.deletedAt for the retention behavior.
  deletedAt: integer("deleted_at"),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyName: text("company_name").notNull().default("Webber Pressure Technologies"),
  companyTagline: text("company_tagline").default("ASME Certified Pressure Equipment"),
  logoUrl: text("logo_url"),
  accentHue: integer("accent_hue").notNull().default(24),
  accentSat: integer("accent_sat").notNull().default(90),
  accentLight: integer("accent_light").notNull().default(50),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const mapLayouts = sqliteTable("map_layouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  area: text("area", { enum: AREAS }).notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  nodes: text("nodes").notNull().default("[]"), // JSON MapNode[]
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const equipmentPresets = sqliteTable("equipment_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  blurb: text("blurb"),
  icon: text("icon").notNull().default("box"),
  defaultCategory: text("default_category", { enum: CATEGORIES })
    .notNull()
    .default("tools"),
  examples: text("examples").notNull().default("[]"), // JSON string[]
  customFields: text("custom_fields").notNull().default("[]"), // JSON CustomField[]
  orderIndex: integer("order_index").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const jobTemplates = sqliteTable("job_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  blurb: text("blurb"),
  icon: text("icon").notNull().default("clipboard-list"),
  params: text("params").notNull().default("[]"), // JSON TemplateParam[]
  parts: text("parts").notNull().default("[]"), // JSON TemplatePart[]
  orderIndex: integer("order_index").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projectChecklist = sqliteTable("project_checklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  qty: text("qty").notNull().default("1"),
  unit: text("unit"),
  equipmentType: text("equipment_type"),
  category: text("category", { enum: CATEGORIES }),
  itemId: integer("item_id").references(() => items.id, {
    onDelete: "set null",
  }),
  status: text("status", { enum: CHECKLIST_STATUS })
    .notNull()
    .default("pending"),
  notes: text("notes"),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).pick({
  name: true,
  pin: true,
  role: true,
});

export const insertItemSchema = createInsertSchema(items).omit({
  id: true,
  createdAt: true,
});

export const insertAdjustmentSchema = z.object({
  delta: z.number().int(),
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: z.string().optional(),
});

export const insertTransactionSchema = z.object({
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
  projectId: z.number().int().optional(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
});

export const updateSettingsSchema = createInsertSchema(settings).omit({
  id: true,
  updatedAt: true,
});

export const insertMapLayoutSchema = createInsertSchema(mapLayouts).omit({
  id: true,
  updatedAt: true,
});

export const insertEquipmentPresetSchema = createInsertSchema(equipmentPresets).omit({
  id: true,
  updatedAt: true,
});

export const insertJobTemplateSchema = createInsertSchema(jobTemplates).omit({
  id: true,
  updatedAt: true,
});

export const insertChecklistSchema = z.object({
  label: z.string().min(1),
  qty: z.string().default("1"),
  unit: z.string().optional(),
  equipmentType: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  itemId: z.number().int().optional(),
  status: z.enum(CHECKLIST_STATUS).optional(),
  notes: z.string().optional(),
  orderIndex: z.number().int().optional(),
});

export const fromTemplateSchema = z.object({
  templateKey: z.string().min(1),
  params: z.record(z.any()),
  jobNumber: z.string().min(1),
  name: z.string().min(1),
  customer: z.string().optional(),
  notes: z.string().optional(),
});

export const loginSchema = z.object({
  name: z.string().min(1),
  pin: z.string().length(4),
});

// ─── TypeScript Types ────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type PublicUser = Omit<User, "pin">;

export type Item = typeof items.$inferSelect;
export type InsertItem = z.infer<typeof insertItemSchema>;

export type Adjustment = typeof adjustments.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type Settings = typeof settings.$inferSelect;
export type MapLayout = typeof mapLayouts.$inferSelect;

export type EquipmentPreset = typeof equipmentPresets.$inferSelect;
export type JobTemplate = typeof jobTemplates.$inferSelect;

export type ProjectChecklistRow = typeof projectChecklist.$inferSelect;

// ─── JSON sub-types ──────────────────────────────────────────────────────────

export interface MapNode {
  id: string;
  kind: "rack" | "zone" | "door" | "machine";
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  matchRack?: string;
  matchSubLocation?: string;
}

export interface CustomField {
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  unit?: string;
  options?: string[];
  placeholder?: string;
}

export interface TemplateParam {
  key: string;
  label: string;
  kind: "number" | "text" | "select";
  unit?: string;
  options?: string[];
  defaultValue?: string | number;
  helper?: string;
}

export interface TemplatePart {
  label: string;
  equipmentType?: string;
  category?: Category;
  qty: number | string;
  unit?: string;
  notes?: string;
}

export interface ChecklistRowWithItem extends ProjectChecklistRow {
  item?: Item | null;
}
