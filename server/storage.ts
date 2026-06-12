import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, like, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs";
import {
  users, items, adjustments, transactions, projects, settings,
  mapLayouts, equipmentPresets, jobTemplates, projectChecklist,
  type User, type Item, type Adjustment, type Transaction,
  type Project, type Settings, type MapLayout, type EquipmentPreset,
  type JobTemplate, type ProjectChecklistRow, type PublicUser,
  type InsertItem, type ChecklistRowWithItem,
  CATEGORIES, AREAS, ROLES,
} from "../shared/schema";

// ─── Database initialization ─────────────────────────────────────────────────

// DATA_DIR lets a host point storage at a persistent volume (e.g. /data on Railway).
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.resolve(dataDir, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const sqlite = new Database(path.join(dataDir, "inventory.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

// ─── Table creation (synchronous DDL) ────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    pin TEXT NOT NULL, -- bcrypt hash; pre-migration installs may contain plaintext
    role TEXT NOT NULL DEFAULT 'worker',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  -- Persistent sessions so a restart doesn't log everyone out.
  -- expires_at is updated on each authenticated request (sliding TTL).
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'tools',
    photo_url TEXT,
    photos TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    area TEXT,
    rack_letter TEXT,
    rack_level INTEGER,
    sub_location TEXT,
    shelf TEXT,
    bin TEXT,
    low_stock_threshold INTEGER NOT NULL DEFAULT 0,
    part_number TEXT,
    mfg_part_number TEXT,
    item_type TEXT NOT NULL DEFAULT 'stock',
    quantity_reserved INTEGER NOT NULL DEFAULT 0,
    equipment_type TEXT,
    custom_attrs TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    notes TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    customer TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL DEFAULT 'Webber Pressure Technologies',
    company_tagline TEXT DEFAULT 'ASME Certified Pressure Equipment',
    logo_url TEXT,
    accent_hue INTEGER NOT NULL DEFAULT 24,
    accent_sat INTEGER NOT NULL DEFAULT 90,
    accent_light INTEGER NOT NULL DEFAULT 50,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS map_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    area TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    nodes TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS equipment_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    blurb TEXT,
    icon TEXT NOT NULL DEFAULT 'box',
    default_category TEXT NOT NULL DEFAULT 'tools',
    examples TEXT NOT NULL DEFAULT '[]',
    custom_fields TEXT NOT NULL DEFAULT '[]',
    order_index INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS job_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    blurb TEXT,
    icon TEXT NOT NULL DEFAULT 'clipboard-list',
    params TEXT NOT NULL DEFAULT '[]',
    parts TEXT NOT NULL DEFAULT '[]',
    order_index INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS project_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    qty TEXT NOT NULL DEFAULT '1',
    unit TEXT,
    equipment_type TEXT,
    category TEXT,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  -- Indexes for hot read paths (Find Items filters, Dashboard stats, item history).
  CREATE INDEX IF NOT EXISTS idx_items_area ON items(area);
  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_items_low_stock ON items(low_stock_threshold, quantity);
  CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_item ON transactions(item_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
  CREATE INDEX IF NOT EXISTS idx_adjustments_item ON adjustments(item_id);
  CREATE INDEX IF NOT EXISTS idx_adjustments_created ON adjustments(created_at);
  CREATE INDEX IF NOT EXISTS idx_checklist_project ON project_checklist(project_id);
`);

// ─── Helper: strip pin from user ─────────────────────────────────────────────

function toPublicUser(u: User): PublicUser {
  const { pin, ...pub } = u;
  return pub;
}

// ─── Helper: parse JSON fields safely ────────────────────────────────────────

function parseJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// ─── Storage API ─────────────────────────────────────────────────────────────

export const storage = {
  // ── Users ────────────────────────────────────────────────────────────────
  getUsers(): PublicUser[] {
    return db.select().from(users).all().map(toPublicUser);
  },

  getUserByName(name: string): User | undefined {
    // Case-insensitive so "manager", "Manager", "MANAGER" all sign in.
    return db.select().from(users).where(sql`lower(${users.name}) = lower(${name})`).get();
  },

  getUserById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  },

  createUser(data: { name: string; pin: string; role: string }): PublicUser {
    const result = db.insert(users).values({
      name: data.name,
      pin: data.pin,
      role: data.role as any,
    }).returning().get();
    return toPublicUser(result);
  },

  setUserPin(id: number, pinHash: string): void {
    sqlite.prepare("UPDATE users SET pin = ? WHERE id = ?").run(pinHash, id);
  },

  getAllUsersWithPin(): User[] {
    return db.select().from(users).all();
  },

  // One-time cleanup of the auto-prefixed "Template: X\nParams: ..." block
  // that the from-template endpoint used to dump into project notes. The
  // block surfaced as an unhelpful box on the project page. Strips just
  // the leading header; any user-entered notes underneath are kept. If
  // nothing is left after the strip, the notes column is set to NULL so
  // the project page's notes card hides entirely.
  stripTemplateAuditFromProjectNotes(): number {
    const rows = sqlite.prepare(
      "SELECT id, notes FROM projects WHERE notes LIKE 'Template:%' OR notes LIKE 'Template:%' || char(10) || 'Params:%'"
    ).all() as { id: number; notes: string }[];
    let changed = 0;
    const update = sqlite.prepare("UPDATE projects SET notes = ? WHERE id = ?");
    for (const row of rows) {
      const cleaned = row.notes.replace(/^Template:[^\n]*\nParams:[^\n]*\n?/, "").trim();
      const next = cleaned.length > 0 ? cleaned : null;
      if (next !== row.notes) {
        update.run(next, row.id);
        changed++;
      }
    }
    return changed;
  },

  // One-time rename of the old "manager" role (which was the operational
  // power-user role) to its new name "technician". Returns rows affected.
  // Also updates already-issued sessions so active tokens reflect the new
  // role without forcing every user to sign in again.
  //
  // GATE: only runs if there are no technician users yet. Once the very
  // first run completes, at least one technician exists (the migrated user),
  // so subsequent boots skip this — protecting any newly-created Manager
  // users from being re-flipped to technicians.
  renameManagerRoleToTechnician(): number {
    const techCount = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM users WHERE role = 'technician'"
    ).get() as any).c;
    if (techCount > 0) return 0;
    const info = sqlite.prepare(
      "UPDATE users SET role = 'technician' WHERE role = 'manager'"
    ).run();
    sqlite.prepare("UPDATE sessions SET role = 'technician' WHERE role = 'manager'").run();
    return Number(info.changes ?? 0);
  },

  deleteUser(id: number): void {
    db.delete(users).where(eq(users.id, id)).run();
  },

  listUserNames(): string[] {
    return db.select({ name: users.name }).from(users).all().map((r) => r.name);
  },

  getUserCount(): number {
    const row = sqlite.prepare("SELECT COUNT(*) as count FROM users").get() as any;
    return row?.count ?? 0;
  },

  // ── Sessions ─────────────────────────────────────────────────────────────
  // Persisted so a server restart doesn't sign everyone out, with a sliding
  // TTL so a long-stale token can't be reused indefinitely.
  insertSession(token: string, userId: number, role: string, name: string, expiresAt: number): void {
    sqlite.prepare(
      "INSERT INTO sessions (token, user_id, role, name, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(token, userId, role, name, expiresAt);
  },

  getSession(token: string): { userId: number; role: string; name: string; expiresAt: number } | null {
    const row = sqlite.prepare(
      "SELECT user_id as userId, role, name, expires_at as expiresAt FROM sessions WHERE token = ?"
    ).get(token) as any;
    return row || null;
  },

  touchSession(token: string, expiresAt: number): void {
    sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(expiresAt, token);
  },

  deleteSession(token: string): void {
    sqlite.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  },

  purgeExpiredSessions(now: number): void {
    sqlite.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  },

  // ── Items ────────────────────────────────────────────────────────────────
  getItems(opts: {
    q?: string;
    category?: string;
    area?: string;
    lowStockOnly?: boolean;
  } = {}): Item[] {
    const conditions: any[] = [];

    if (opts.q) {
      const pattern = `%${opts.q}%`;
      conditions.push(
        or(
          like(items.name, pattern),
          like(items.partNumber, pattern),
          like(items.mfgPartNumber, pattern)
        )
      );
    }
    if (opts.category) {
      conditions.push(eq(items.category, opts.category as any));
    }
    if (opts.area) {
      conditions.push(eq(items.area, opts.area as any));
    }
    if (opts.lowStockOnly) {
      conditions.push(
        sql`${items.lowStockThreshold} > 0 AND ${items.quantity} <= ${items.lowStockThreshold}`
      );
    }

    const query = conditions.length > 0
      ? db.select().from(items).where(and(...conditions)).orderBy(desc(items.createdAt))
      : db.select().from(items).orderBy(desc(items.createdAt));

    return query.all();
  },

  getItemById(id: number): Item | undefined {
    return db.select().from(items).where(eq(items.id, id)).get();
  },

  getItemDuplicates(name: string, category?: string): Item[] {
    const conditions = [like(items.name, `%${name}%`)];
    if (category) {
      conditions.push(eq(items.category, category as any));
    }
    return db.select().from(items).where(and(...conditions)).all();
  },

  createItem(data: any): Item {
    const vals: any = {
      name: data.name,
      category: data.category || "tools",
      photoUrl: data.photoUrl || null,
      photos: data.photos ? JSON.stringify(data.photos) : null,
      quantity: data.quantity ?? 0,
      notes: data.notes || null,
      area: data.area || null,
      rackLetter: data.rackLetter || null,
      rackLevel: data.rackLevel ?? null,
      subLocation: data.subLocation || null,
      shelf: data.shelf || null,
      bin: data.bin || null,
      lowStockThreshold: data.lowStockThreshold ?? 0,
      partNumber: data.partNumber || null,
      mfgPartNumber: data.mfgPartNumber || null,
      itemType: data.itemType || "stock",
      quantityReserved: data.quantityReserved ?? 0,
      equipmentType: data.equipmentType || null,
      customAttrs: data.customAttrs ? JSON.stringify(data.customAttrs) : null,
    };
    return db.insert(items).values(vals).returning().get();
  },

  updateItem(id: number, data: any): Item | undefined {
    const vals: any = {};
    const fields = [
      "name", "category", "photoUrl", "quantity", "notes",
      "area", "rackLetter", "rackLevel", "subLocation", "shelf", "bin",
      "lowStockThreshold", "partNumber", "mfgPartNumber", "itemType",
      "quantityReserved", "equipmentType",
    ];
    for (const f of fields) {
      if (data[f] !== undefined) vals[f] = data[f];
    }
    if (data.photos !== undefined) {
      vals.photos = JSON.stringify(data.photos);
    }
    if (data.customAttrs !== undefined) {
      vals.customAttrs = JSON.stringify(data.customAttrs);
    }
    if (Object.keys(vals).length === 0) return this.getItemById(id);
    const result = db.update(items).set(vals).where(eq(items.id, id)).returning().get();
    return result;
  },

  deleteItem(id: number): void {
    db.delete(items).where(eq(items.id, id)).run();
  },

  // ── Adjustments ──────────────────────────────────────────────────────────
  createAdjustment(itemId: number, userId: number, data: { delta: number; reason: string; notes?: string }): Adjustment {
    // Update item quantity
    sqlite.prepare("UPDATE items SET quantity = quantity + ? WHERE id = ?").run(data.delta, itemId);
    return db.insert(adjustments).values({
      itemId,
      userId,
      delta: data.delta,
      reason: data.reason as any,
      notes: data.notes || null,
    }).returning().get();
  },

  getAdjustments(itemId: number): Adjustment[] {
    return db.select().from(adjustments)
      .where(eq(adjustments.itemId, itemId))
      .orderBy(desc(adjustments.createdAt))
      .all();
  },

  getRecentAdjustments(opts: { limit?: number; userId?: number; itemId?: number } = {}):
    (Adjustment & { userName?: string; itemName?: string })[] {
    let query = `
      SELECT a.*, u.name as user_name, i.name as item_name
      FROM adjustments a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN items i ON a.item_id = i.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (opts.userId) { query += " AND a.user_id = ?"; params.push(opts.userId); }
    if (opts.itemId) { query += " AND a.item_id = ?"; params.push(opts.itemId); }
    query += " ORDER BY a.created_at DESC";
    if (opts.limit) { query += " LIMIT ?"; params.push(opts.limit); }
    return sqlite.prepare(query).all(...params) as any[];
  },

  // ── Transactions ─────────────────────────────────────────────────────────
  createTransaction(
    itemId: number,
    userId: number,
    type: "check_out" | "check_in",
    data: { quantity: number; notes?: string; projectId?: number }
  ): Transaction {
    const delta = type === "check_out" ? -data.quantity : data.quantity;
    sqlite.prepare("UPDATE items SET quantity = quantity + ? WHERE id = ?").run(delta, itemId);
    return db.insert(transactions).values({
      itemId,
      userId,
      type,
      quantity: data.quantity,
      notes: data.notes || null,
      projectId: data.projectId ?? null,
    }).returning().get();
  },

  getTransactions(opts: {
    limit?: number;
    userId?: number;
    itemId?: number;
    projectId?: number;
  } = {}): (Transaction & { userName?: string; itemName?: string })[] {
    let query = `
      SELECT t.*, u.name as user_name, i.name as item_name
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN items i ON t.item_id = i.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (opts.userId) { query += " AND t.user_id = ?"; params.push(opts.userId); }
    if (opts.itemId) { query += " AND t.item_id = ?"; params.push(opts.itemId); }
    if (opts.projectId) { query += " AND t.project_id = ?"; params.push(opts.projectId); }
    query += " ORDER BY t.created_at DESC";
    if (opts.limit) { query += " LIMIT ?"; params.push(opts.limit); }

    return sqlite.prepare(query).all(...params) as any[];
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  getProjects(): Project[] {
    return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
  },

  getProjectById(id: number): Project | undefined {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  },

  createProject(data: { jobNumber: string; name: string; customer?: string; status?: string; notes?: string }): Project {
    return db.insert(projects).values({
      jobNumber: data.jobNumber,
      name: data.name,
      customer: data.customer || null,
      status: (data.status as any) || "active",
      notes: data.notes || null,
    }).returning().get();
  },

  updateProject(id: number, data: any): Project | undefined {
    const vals: any = {};
    if (data.name !== undefined) vals.name = data.name;
    if (data.customer !== undefined) vals.customer = data.customer;
    if (data.status !== undefined) vals.status = data.status;
    if (data.notes !== undefined) vals.notes = data.notes;
    if (data.jobNumber !== undefined) vals.jobNumber = data.jobNumber;
    if (Object.keys(vals).length === 0) return this.getProjectById(id);
    return db.update(projects).set(vals).where(eq(projects.id, id)).returning().get();
  },

  deleteProject(id: number): void {
    db.delete(projects).where(eq(projects.id, id)).run();
  },

  getProjectUsage(projectId: number) {
    const txns = sqlite.prepare(`
      SELECT t.*, i.name as item_name, i.category as item_category,
             i.photo_url as item_photo_url, i.photos as item_photos,
             u.name as user_name
      FROM transactions t
      LEFT JOIN items i ON t.item_id = i.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.project_id = ?
      ORDER BY t.created_at DESC
    `).all(projectId) as any[];

    const byCategory: Record<string, number> = {};
    let totalItems = 0;
    for (const t of txns) {
      if (t.type === "check_out") {
        totalItems += t.quantity;
        const cat = t.item_category || "other";
        byCategory[cat] = (byCategory[cat] || 0) + t.quantity;
      }
    }

    // Top items
    const itemCounts: Record<number, { name: string; count: number }> = {};
    for (const t of txns) {
      if (t.type === "check_out") {
        if (!itemCounts[t.item_id]) itemCounts[t.item_id] = { name: t.item_name, count: 0 };
        itemCounts[t.item_id].count += t.quantity;
      }
    }
    const topItems = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      totalItems,
      byCategory,
      topItems,
      transactions: txns.slice(0, 20),
    };
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings(): Settings {
    let row = db.select().from(settings).where(eq(settings.id, 1)).get();
    if (!row) {
      row = db.insert(settings).values({}).returning().get();
    }
    return row;
  },

  updateSettings(data: any): Settings {
    const vals: any = { updatedAt: new Date() };
    if (data.companyName !== undefined) vals.companyName = data.companyName;
    if (data.companyTagline !== undefined) vals.companyTagline = data.companyTagline;
    if (data.logoUrl !== undefined) vals.logoUrl = data.logoUrl;
    if (data.accentHue !== undefined) vals.accentHue = data.accentHue;
    if (data.accentSat !== undefined) vals.accentSat = data.accentSat;
    if (data.accentLight !== undefined) vals.accentLight = data.accentLight;
    return db.update(settings).set(vals).where(eq(settings.id, 1)).returning().get();
  },

  // ── Map Layouts ──────────────────────────────────────────────────────────
  getMapLayouts(): MapLayout[] {
    return db.select().from(mapLayouts).orderBy(asc(mapLayouts.orderIndex)).all();
  },

  getMapLayoutByKey(key: string): MapLayout | undefined {
    return db.select().from(mapLayouts).where(eq(mapLayouts.key, key)).get();
  },

  createMapLayout(data: any): MapLayout {
    return db.insert(mapLayouts).values({
      key: data.key,
      label: data.label,
      area: data.area,
      orderIndex: data.orderIndex ?? 0,
      nodes: JSON.stringify(data.nodes || []),
    }).returning().get();
  },

  updateMapLayout(key: string, data: any): MapLayout | undefined {
    const vals: any = { updatedAt: new Date() };
    if (data.label !== undefined) vals.label = data.label;
    if (data.area !== undefined) vals.area = data.area;
    if (data.orderIndex !== undefined) vals.orderIndex = data.orderIndex;
    if (data.nodes !== undefined) vals.nodes = JSON.stringify(data.nodes);
    return db.update(mapLayouts).set(vals).where(eq(mapLayouts.key, key)).returning().get();
  },

  deleteMapLayout(key: string): void {
    db.delete(mapLayouts).where(eq(mapLayouts.key, key)).run();
  },

  getMapLayoutCount(): number {
    const row = sqlite.prepare("SELECT COUNT(*) as count FROM map_layouts").get() as any;
    return row?.count ?? 0;
  },

  // ── Equipment Presets ────────────────────────────────────────────────────
  getPresets(): EquipmentPreset[] {
    return db.select().from(equipmentPresets).orderBy(asc(equipmentPresets.orderIndex)).all();
  },

  getPresetByKey(key: string): EquipmentPreset | undefined {
    return db.select().from(equipmentPresets).where(eq(equipmentPresets.key, key)).get();
  },

  createPreset(data: any): EquipmentPreset {
    return db.insert(equipmentPresets).values({
      key: data.key,
      label: data.label,
      blurb: data.blurb || null,
      icon: data.icon || "box",
      defaultCategory: data.defaultCategory || "tools",
      examples: JSON.stringify(data.examples || []),
      customFields: JSON.stringify(data.customFields || []),
      orderIndex: data.orderIndex ?? 0,
      enabled: data.enabled !== false,
    }).returning().get();
  },

  updatePreset(key: string, data: any): EquipmentPreset | undefined {
    const vals: any = { updatedAt: new Date() };
    if (data.label !== undefined) vals.label = data.label;
    if (data.blurb !== undefined) vals.blurb = data.blurb;
    if (data.icon !== undefined) vals.icon = data.icon;
    if (data.defaultCategory !== undefined) vals.defaultCategory = data.defaultCategory;
    if (data.examples !== undefined) vals.examples = JSON.stringify(data.examples);
    if (data.customFields !== undefined) vals.customFields = JSON.stringify(data.customFields);
    if (data.orderIndex !== undefined) vals.orderIndex = data.orderIndex;
    if (data.enabled !== undefined) vals.enabled = data.enabled;
    return db.update(equipmentPresets).set(vals).where(eq(equipmentPresets.key, key)).returning().get();
  },

  deletePreset(key: string): void {
    db.delete(equipmentPresets).where(eq(equipmentPresets.key, key)).run();
  },

  getPresetCount(): number {
    const row = sqlite.prepare("SELECT COUNT(*) as count FROM equipment_presets").get() as any;
    return row?.count ?? 0;
  },

  // ── Job Templates ────────────────────────────────────────────────────────
  getTemplates(): JobTemplate[] {
    return db.select().from(jobTemplates).orderBy(asc(jobTemplates.orderIndex)).all();
  },

  getTemplateByKey(key: string): JobTemplate | undefined {
    return db.select().from(jobTemplates).where(eq(jobTemplates.key, key)).get();
  },

  createTemplate(data: any): JobTemplate {
    return db.insert(jobTemplates).values({
      key: data.key,
      label: data.label,
      blurb: data.blurb || null,
      icon: data.icon || "clipboard-list",
      params: JSON.stringify(data.params || []),
      parts: JSON.stringify(data.parts || []),
      orderIndex: data.orderIndex ?? 0,
      enabled: data.enabled !== false,
    }).returning().get();
  },

  updateTemplate(key: string, data: any): JobTemplate | undefined {
    const vals: any = { updatedAt: new Date() };
    if (data.label !== undefined) vals.label = data.label;
    if (data.blurb !== undefined) vals.blurb = data.blurb;
    if (data.icon !== undefined) vals.icon = data.icon;
    if (data.params !== undefined) vals.params = JSON.stringify(data.params);
    if (data.parts !== undefined) vals.parts = JSON.stringify(data.parts);
    if (data.orderIndex !== undefined) vals.orderIndex = data.orderIndex;
    if (data.enabled !== undefined) vals.enabled = data.enabled;
    return db.update(jobTemplates).set(vals).where(eq(jobTemplates.key, key)).returning().get();
  },

  deleteTemplate(key: string): void {
    db.delete(jobTemplates).where(eq(jobTemplates.key, key)).run();
  },

  getTemplateCount(): number {
    const row = sqlite.prepare("SELECT COUNT(*) as count FROM job_templates").get() as any;
    return row?.count ?? 0;
  },

  // ── Project Checklist ────────────────────────────────────────────────────
  getChecklist(projectId: number): ChecklistRowWithItem[] {
    const rows = db.select().from(projectChecklist)
      .where(eq(projectChecklist.projectId, projectId))
      .orderBy(asc(projectChecklist.orderIndex))
      .all();

    return rows.map((row) => {
      let item: Item | null = null;
      if (row.itemId) {
        item = db.select().from(items).where(eq(items.id, row.itemId)).get() ?? null;
      }
      return { ...row, item };
    });
  },

  createChecklistRow(projectId: number, data: any): ProjectChecklistRow {
    const maxOrder = sqlite.prepare(
      "SELECT MAX(order_index) as m FROM project_checklist WHERE project_id = ?"
    ).get(projectId) as any;

    return db.insert(projectChecklist).values({
      projectId,
      label: data.label,
      qty: String(data.qty ?? "1"),
      unit: data.unit || null,
      equipmentType: data.equipmentType || null,
      category: data.category || null,
      itemId: data.itemId || null,
      status: data.status || "pending",
      notes: data.notes || null,
      orderIndex: data.orderIndex ?? ((maxOrder?.m ?? 0) + 1),
    }).returning().get();
  },

  updateChecklistRow(id: number, data: any): ProjectChecklistRow | undefined {
    const vals: any = {};
    if (data.status !== undefined) vals.status = data.status;
    if (data.qty !== undefined) vals.qty = String(data.qty);
    if (data.itemId !== undefined) vals.itemId = data.itemId;
    if (data.label !== undefined) vals.label = data.label;
    if (data.notes !== undefined) vals.notes = data.notes;
    if (data.unit !== undefined) vals.unit = data.unit;
    if (Object.keys(vals).length === 0) return undefined;
    return db.update(projectChecklist).set(vals).where(eq(projectChecklist.id, id)).returning().get();
  },

  deleteChecklistRow(id: number): void {
    db.delete(projectChecklist).where(eq(projectChecklist.id, id)).run();
  },

  // ── Stats ────────────────────────────────────────────────────────────────
  getStats() {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalItems = (sqlite.prepare("SELECT COUNT(*) as c FROM items").get() as any).c;
    const totalQty = (sqlite.prepare("SELECT COALESCE(SUM(quantity),0) as c FROM items").get() as any).c;
    const lowStock = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM items WHERE low_stock_threshold > 0 AND quantity <= low_stock_threshold"
    ).get() as any).c;
    const activeProjects = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active'"
    ).get() as any).c;
    const itemsAdded7d = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM items WHERE created_at >= ?"
    ).get(sevenDaysAgo) as any).c;
    const checkouts7d = (sqlite.prepare(
      "SELECT COALESCE(SUM(quantity),0) as c FROM transactions WHERE type = 'check_out' AND created_at >= ?"
    ).get(sevenDaysAgo) as any).c;
    const shrinkage7d = (sqlite.prepare(
      "SELECT COALESCE(SUM(ABS(delta)),0) as c FROM adjustments WHERE delta < 0 AND created_at >= ?"
    ).get(sevenDaysAgo) as any).c;

    // Items per category
    const byCategory = sqlite.prepare(
      "SELECT category, COUNT(*) as count FROM items GROUP BY category"
    ).all() as any[];

    // Weekly checkouts (last 8 weeks)
    const weeklyCheckouts = sqlite.prepare(`
      SELECT
        CAST((created_at / (7 * 24 * 3600 * 1000)) AS INTEGER) as week,
        SUM(quantity) as total
      FROM transactions
      WHERE type = 'check_out' AND created_at >= ?
      GROUP BY week
      ORDER BY week
    `).all(now - 56 * 24 * 60 * 60 * 1000) as any[];

    // Top workers by checkouts
    const topWorkers = sqlite.prepare(`
      SELECT u.name, SUM(t.quantity) as total
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.type = 'check_out' AND t.created_at >= ?
      GROUP BY t.user_id
      ORDER BY total DESC
      LIMIT 10
    `).all(sevenDaysAgo) as any[];

    // Top items by usage
    const topItems = sqlite.prepare(`
      SELECT i.name, SUM(t.quantity) as total
      FROM transactions t
      JOIN items i ON t.item_id = i.id
      WHERE t.type = 'check_out' AND t.created_at >= ?
      GROUP BY t.item_id
      ORDER BY total DESC
      LIMIT 10
    `).all(sevenDaysAgo) as any[];

    // Low stock items for reorder list
    const lowStockItems = sqlite.prepare(
      "SELECT id, name, quantity, low_stock_threshold, category FROM items WHERE low_stock_threshold > 0 AND quantity <= low_stock_threshold ORDER BY (quantity - low_stock_threshold) ASC LIMIT 20"
    ).all() as any[];

    return {
      totalItems,
      totalQty,
      lowStock,
      activeProjects,
      itemsAdded7d,
      checkouts7d,
      shrinkage7d,
      byCategory,
      weeklyCheckouts,
      topWorkers,
      topItems,
      lowStockItems,
    };
  },
};
