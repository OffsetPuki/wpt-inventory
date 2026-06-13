import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, like, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { encryptSecret, decryptSecret } from "./crypto";
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
// Standard SQLite perf tuning. NORMAL is the recommended companion to WAL —
// still durable across app crashes, just not across OS-level power loss
// (which is fine for this app). The cache/temp/mmap pragmas keep more of the
// working set in memory so common reads avoid disk hits.
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("temp_store = MEMORY");
sqlite.pragma("cache_size = -65536");      // ~64 MB page cache
sqlite.pragma("mmap_size = 268435456");    // 256 MB memory map
sqlite.pragma("busy_timeout = 5000");      // wait up to 5s on lock contention

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

  -- Per-account login throttling. IP-based rate limit lives in memory and
  -- can be bypassed via VPN/Tor; this table tracks failures per username
  -- (lowercased) so a brute-forcer can't just rotate IPs.
  CREATE TABLE IF NOT EXISTS login_attempts (
    name_lc TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    last_failed_at INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
  );

  -- Forensic trail of who did what. Inventory moves stay in the transactions
  -- and adjustments tables; this one covers destructive / privileged actions
  -- (item delete, user create/delete, settings change, login outcomes, etc).
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    role TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    target_name TEXT,
    ip TEXT,
    details TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

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
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    -- Soft delete: NULL = active. Reaper hard-purges after 30 days.
    deleted_at INTEGER
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
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    -- Soft delete: NULL = active. Reaper hard-purges after 30 days.
    deleted_at INTEGER
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
  -- Composite indexes lead with deleted_at so a single index lookup satisfies the
  -- "active rows + filter" pattern that drives Find Items and the dashboard.
  CREATE INDEX IF NOT EXISTS idx_items_area ON items(area);
  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_items_low_stock ON items(low_stock_threshold, quantity);
  CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
  CREATE INDEX IF NOT EXISTS idx_items_deleted_category ON items(deleted_at, category);
  CREATE INDEX IF NOT EXISTS idx_items_deleted_area ON items(deleted_at, area);
  CREATE INDEX IF NOT EXISTS idx_items_deleted_created ON items(deleted_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_item ON transactions(item_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
  CREATE INDEX IF NOT EXISTS idx_adjustments_item ON adjustments(item_id);
  CREATE INDEX IF NOT EXISTS idx_adjustments_created ON adjustments(created_at);
  CREATE INDEX IF NOT EXISTS idx_checklist_project ON project_checklist(project_id);
`);

// ─── Idempotent column additions ─────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS doesn't add columns to pre-existing tables, so
// new columns on shipped tables go here. Each addition checks PRAGMA first
// so it only runs when the column is actually missing.

function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

addColumnIfMissing("items", "deleted_at", "deleted_at INTEGER");
addColumnIfMissing("projects", "deleted_at", "deleted_at INTEGER");
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at)");
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at)");

// ─── QuickBooks Online integration tables ────────────────────────────────────
// QBO is the financial system of record (the bookkeeper enters POs and Bills
// there); this app is the shop-floor system of record (receive/issue/adjust).
// These tables cache pulled QBO entities, hold the item/project mappings, and
// queue outbound pushes so a flaky connection never loses an event.

sqlite.exec(`
  -- Single-row OAuth connection (client id/secret live in env, not here).
  CREATE TABLE IF NOT EXISTS qb_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    realm_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    refresh_expires_at INTEGER NOT NULL,
    environment TEXT NOT NULL DEFAULT 'sandbox',
    connected_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_sync_at INTEGER
  );

  -- QBO Item cache + mapping to our items. map_status: unmatched|matched|ignored.
  CREATE TABLE IF NOT EXISTS qb_items (
    qb_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT,
    type TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    map_status TEXT NOT NULL DEFAULT 'unmatched',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  -- QBO Customer/Project cache + mapping to our projects.
  CREATE TABLE IF NOT EXISTS qb_customers (
    qb_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_project INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  -- Purchase orders pulled from QBO (read-only here; bookkeeper owns them).
  -- qty_received is OURS — physical receipts happen in this app.
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qb_id TEXT NOT NULL UNIQUE,
    doc_number TEXT,
    vendor_name TEXT,
    txn_date TEXT,
    qb_status TEXT,
    memo TEXT,
    synced_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS po_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    qb_line_id TEXT,
    qb_item_id TEXT,
    description TEXT,
    qty REAL NOT NULL DEFAULT 0,
    unit_cost REAL,
    qty_received REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_po_lines_po ON po_lines(po_id);
  CREATE INDEX IF NOT EXISTS idx_po_lines_item ON po_lines(qb_item_id);

  -- Outbound events (issues, returns, adjustments). local_ref is unique so a
  -- retried request can't double-enqueue. status: pending|done|error|manual.
  CREATE TABLE IF NOT EXISTS qb_push_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    local_ref TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    qb_doc_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    processed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_qb_queue_status ON qb_push_queue(status);
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
    // Revoke any active sessions BEFORE deleting the user — otherwise a fired
    // worker stays signed in until the next /api/auth/me round-trip notices
    // their user row is gone. With this, the next protected request returns
    // 401 immediately and they're booted to the login screen.
    sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    // Also clear lockout state so re-creating an account with the same name
    // doesn't inherit the old lockout counter.
    const u = db.select().from(users).where(eq(users.id, id)).get();
    if (u) sqlite.prepare("DELETE FROM login_attempts WHERE name_lc = ?").run(u.name.toLowerCase());
    db.delete(users).where(eq(users.id, id)).run();
  },

  // Used by the explicit "log this user out everywhere" flow without removing
  // the account — handy for ending a stolen session after a password reset.
  revokeAllSessionsForUser(id: number): number {
    const info = sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    return Number(info.changes ?? 0);
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

  // ── Login attempts (per-account lockout) ─────────────────────────────────
  getLoginAttempt(name: string): { failedCount: number; lockedUntil: number } | null {
    const row = sqlite.prepare(
      "SELECT failed_count as failedCount, locked_until as lockedUntil FROM login_attempts WHERE name_lc = ?"
    ).get(name.toLowerCase()) as any;
    return row || null;
  },

  recordLoginFailure(name: string, now: number, threshold: number, lockMs: number): { lockedUntil: number; failedCount: number } {
    const nameLc = name.toLowerCase();
    sqlite.prepare(
      "INSERT INTO login_attempts (name_lc, failed_count, last_failed_at) VALUES (?, 1, ?) " +
      "ON CONFLICT(name_lc) DO UPDATE SET failed_count = failed_count + 1, last_failed_at = excluded.last_failed_at"
    ).run(nameLc, now);
    const row = sqlite.prepare(
      "SELECT failed_count as failedCount FROM login_attempts WHERE name_lc = ?"
    ).get(nameLc) as any;
    let lockedUntil = 0;
    if (row.failedCount >= threshold) {
      lockedUntil = now + lockMs;
      sqlite.prepare(
        "UPDATE login_attempts SET locked_until = ?, failed_count = 0 WHERE name_lc = ?"
      ).run(lockedUntil, nameLc);
    }
    return { lockedUntil, failedCount: row.failedCount };
  },

  clearLoginAttempts(name: string): void {
    sqlite.prepare("DELETE FROM login_attempts WHERE name_lc = ?").run(name.toLowerCase());
  },

  purgeStaleLoginAttempts(now: number): void {
    // Drop rows that are neither currently locked nor recently failed.
    sqlite.prepare(
      "DELETE FROM login_attempts WHERE locked_until < ? AND last_failed_at < ?"
    ).run(now, now - 24 * 60 * 60 * 1000);
  },

  // ── Audit log ────────────────────────────────────────────────────────────
  appendAudit(entry: {
    userId?: number | null;
    userName?: string | null;
    role?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: number | null;
    targetName?: string | null;
    ip?: string | null;
    details?: Record<string, unknown> | null;
  }): void {
    sqlite.prepare(
      "INSERT INTO audit_log (user_id, user_name, role, action, target_type, target_id, target_name, ip, details) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      entry.userId ?? null,
      entry.userName ?? null,
      entry.role ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.targetName ?? null,
      entry.ip ?? null,
      entry.details ? JSON.stringify(entry.details) : null
    );
  },

  getAuditLog(opts: { limit?: number; action?: string; userId?: number } = {}): any[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    const conditions: string[] = [];
    const params: any[] = [];
    if (opts.action) { conditions.push("action = ?"); params.push(opts.action); }
    if (opts.userId) { conditions.push("user_id = ?"); params.push(opts.userId); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    return sqlite.prepare(
      `SELECT id, user_id as userId, user_name as userName, role, action,
              target_type as targetType, target_id as targetId, target_name as targetName,
              ip, details, created_at as createdAt
       FROM audit_log ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params);
  },

  // ── Items ────────────────────────────────────────────────────────────────
  // All read paths filter out soft-deleted rows (deleted_at IS NOT NULL) so
  // a deletion immediately disappears from the active UI. The Trash page
  // reads via getDeletedItems() to surface them for restore.
  getItems(opts: {
    q?: string;
    category?: string;
    area?: string;
    lowStockOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Item[] {
    const conditions: any[] = [sql`${items.deletedAt} IS NULL`];

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

    // Default cap so a growing inventory doesn't quietly blow up Find Items.
    // Clamp into a sane window — 1..1000 — so a bad query string can't ask
    // for the whole table either.
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
    const offset = Math.max(opts.offset ?? 0, 0);

    return db.select().from(items)
      .where(and(...conditions))
      .orderBy(desc(items.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
  },

  // For active-page lookups; the trash page uses getDeletedItemById instead.
  getItemById(id: number): Item | undefined {
    return db.select().from(items).where(and(eq(items.id, id), sql`${items.deletedAt} IS NULL`)).get();
  },

  // Used by restore + audit-trail callers that need to look up a deleted item.
  getItemByIdIncludingDeleted(id: number): Item | undefined {
    return db.select().from(items).where(eq(items.id, id)).get();
  },

  getDeletedItems(): Item[] {
    return db.select().from(items).where(sql`${items.deletedAt} IS NOT NULL`)
      .orderBy(desc(items.deletedAt)).all();
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
    sqlite.prepare("UPDATE items SET deleted_at = ? WHERE id = ?").run(Date.now(), id);
  },

  restoreItem(id: number): void {
    sqlite.prepare("UPDATE items SET deleted_at = NULL WHERE id = ?").run(id);
  },

  // Hard-delete rows that have been soft-deleted longer than the retention
  // window. Cascading foreign keys clean up adjustments + transactions.
  purgeOldDeletedItems(cutoff: number): number {
    const info = sqlite.prepare("DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff);
    return Number(info.changes ?? 0);
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

  getRecentAdjustments(opts: { limit?: number; userId?: number; itemId?: number; q?: string } = {}):
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
    if (opts.q) {
      query += " AND (i.name LIKE ? OR u.name LIKE ?)";
      const pat = `%${opts.q}%`;
      params.push(pat, pat);
    }
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
    type?: "check_out" | "check_in";
    q?: string;
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
    if (opts.type) { query += " AND t.type = ?"; params.push(opts.type); }
    if (opts.q) {
      query += " AND (i.name LIKE ? OR u.name LIKE ?)";
      const pat = `%${opts.q}%`;
      params.push(pat, pat);
    }
    query += " ORDER BY t.created_at DESC";
    if (opts.limit) { query += " LIMIT ?"; params.push(opts.limit); }

    return sqlite.prepare(query).all(...params) as any[];
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  // Soft-deletes mirror the items table: read paths exclude rows with
  // deleted_at set; Trash page surfaces them for restore.
  getProjects(): Project[] {
    return db.select().from(projects).where(sql`${projects.deletedAt} IS NULL`)
      .orderBy(desc(projects.createdAt)).all();
  },

  getProjectById(id: number): Project | undefined {
    return db.select().from(projects).where(and(eq(projects.id, id), sql`${projects.deletedAt} IS NULL`)).get();
  },

  getProjectByIdIncludingDeleted(id: number): Project | undefined {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  },

  getDeletedProjects(): Project[] {
    return db.select().from(projects).where(sql`${projects.deletedAt} IS NOT NULL`)
      .orderBy(desc(projects.deletedAt)).all();
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
    sqlite.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?").run(Date.now(), id);
  },

  restoreProject(id: number): void {
    sqlite.prepare("UPDATE projects SET deleted_at = NULL WHERE id = ?").run(id);
  },

  purgeOldDeletedProjects(cutoff: number): number {
    const info = sqlite.prepare("DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff);
    return Number(info.changes ?? 0);
  },

  getProjectUsage(projectId: number) {
    // Project page only renders the recent transaction list with a single
    // thumbnail per row. Pulling the full photos JSON array across the join is
    // wasted bytes — extract the first photo in SQL and only return that.
    // json_valid() guards against legacy / corrupt rows so the query never
    // explodes on a bad photos blob.
    const transactions = sqlite.prepare(`
      SELECT t.*, i.name as item_name,
             COALESCE(
               CASE WHEN json_valid(i.photos) THEN json_extract(i.photos, '$[0]') END,
               i.photo_url
             ) as item_photo,
             u.name as user_name
      FROM transactions t
      LEFT JOIN items i ON t.item_id = i.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.project_id = ?
      ORDER BY t.created_at DESC
      LIMIT 20
    `).all(projectId) as any[];
    return { transactions };
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
    const eightWeeksAgo = now - 56 * 24 * 60 * 60 * 1000;

    // All item/project stats exclude soft-deleted rows so the dashboard
    // matches what's actually visible in Find Items / Projects.
    //
    // The four cheap scalars (item-table counts/sums + active projects) used
    // to be four separate prepares. Collapse them into one round-trip — SQLite
    // happily evaluates correlated subqueries in a single statement.
    const scalars = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL) as totalItems,
        (SELECT COALESCE(SUM(quantity),0) FROM items WHERE deleted_at IS NULL) as totalQty,
        (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND low_stock_threshold > 0 AND quantity <= low_stock_threshold) as lowStock,
        (SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL AND status = 'active') as activeProjects,
        (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND created_at >= ?) as itemsAdded7d,
        (SELECT COALESCE(SUM(quantity),0) FROM transactions WHERE type = 'check_out' AND created_at >= ?) as checkouts7d,
        (SELECT COALESCE(SUM(ABS(delta)),0) FROM adjustments WHERE delta < 0 AND created_at >= ?) as shrinkage7d
    `).get(sevenDaysAgo, sevenDaysAgo, sevenDaysAgo) as any;

    // Items per category
    const byCategory = sqlite.prepare(
      "SELECT category, COUNT(*) as count FROM items WHERE deleted_at IS NULL GROUP BY category"
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
    `).all(eightWeeksAgo) as any[];

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
      "SELECT id, name, quantity, low_stock_threshold, category FROM items WHERE deleted_at IS NULL AND low_stock_threshold > 0 AND quantity <= low_stock_threshold ORDER BY (quantity - low_stock_threshold) ASC LIMIT 20"
    ).all() as any[];

    return {
      totalItems: scalars.totalItems,
      totalQty: scalars.totalQty,
      lowStock: scalars.lowStock,
      activeProjects: scalars.activeProjects,
      itemsAdded7d: scalars.itemsAdded7d,
      checkouts7d: scalars.checkouts7d,
      shrinkage7d: scalars.shrinkage7d,
      byCategory,
      weeklyCheckouts,
      topWorkers,
      topItems,
      lowStockItems,
    };
  },

  // ── QuickBooks: connection ─────────────────────────────────────────────────
  // Tokens + realm id are encrypted at rest (AES-256-GCM) per Intuit's security
  // requirements; decrypted transparently on read so callers see plaintext.
  qbGetConnection(): any | undefined {
    const row = sqlite.prepare("SELECT * FROM qb_connection WHERE id = 1").get() as any;
    if (!row) return undefined;
    row.realm_id = decryptSecret(row.realm_id);
    row.access_token = decryptSecret(row.access_token);
    row.refresh_token = decryptSecret(row.refresh_token);
    return row;
  },

  qbSaveConnection(c: {
    realmId: string;
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
    environment: string;
  }): void {
    sqlite.prepare(`
      INSERT INTO qb_connection (id, realm_id, access_token, refresh_token, access_expires_at, refresh_expires_at, environment, connected_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        realm_id = excluded.realm_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        access_expires_at = excluded.access_expires_at,
        refresh_expires_at = excluded.refresh_expires_at,
        environment = excluded.environment,
        connected_at = excluded.connected_at
    `).run(
      encryptSecret(c.realmId), encryptSecret(c.accessToken), encryptSecret(c.refreshToken),
      c.accessExpiresAt, c.refreshExpiresAt, c.environment, Date.now()
    );
  },

  // Refresh-token rotation: QBO returns a NEW refresh token on every refresh
  // and the old one stops working, so both tokens must be persisted together.
  qbUpdateTokens(t: { accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number }): void {
    sqlite.prepare(`
      UPDATE qb_connection SET access_token = ?, refresh_token = ?, access_expires_at = ?, refresh_expires_at = ? WHERE id = 1
    `).run(encryptSecret(t.accessToken), encryptSecret(t.refreshToken), t.accessExpiresAt, t.refreshExpiresAt);
  },

  qbClearConnection(): void {
    sqlite.prepare("DELETE FROM qb_connection WHERE id = 1").run();
  },

  qbTouchLastSync(): void {
    sqlite.prepare("UPDATE qb_connection SET last_sync_at = ? WHERE id = 1").run(Date.now());
  },

  // ── QuickBooks: item cache + mapping ───────────────────────────────────────
  qbUpsertItem(i: { qbId: string; name: string; sku: string | null; type: string | null; active: boolean }): void {
    // Mapping fields (item_id, map_status) survive re-syncs.
    sqlite.prepare(`
      INSERT INTO qb_items (qb_id, name, sku, type, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(qb_id) DO UPDATE SET
        name = excluded.name, sku = excluded.sku, type = excluded.type,
        active = excluded.active, updated_at = excluded.updated_at
    `).run(i.qbId, i.name, i.sku, i.type, i.active ? 1 : 0, Date.now());
  },

  qbListItems(): any[] {
    return sqlite.prepare(`
      SELECT q.*, i.name as local_item_name
      FROM qb_items q LEFT JOIN items i ON q.item_id = i.id
      WHERE q.active = 1
      ORDER BY q.map_status = 'unmatched' DESC, q.name COLLATE NOCASE
    `).all() as any[];
  },

  qbMapItem(qbId: string, itemId: number | null, status: "matched" | "ignored" | "unmatched"): void {
    sqlite.prepare("UPDATE qb_items SET item_id = ?, map_status = ?, updated_at = ? WHERE qb_id = ?")
      .run(itemId, status, Date.now(), qbId);
  },

  // Conservative auto-match: exact SKU ↔ part number first, then exact name.
  // Anything ambiguous stays unmatched for a human to resolve.
  qbAutoMatchItems(): number {
    const unmatched = sqlite.prepare(
      "SELECT qb_id, name, sku FROM qb_items WHERE map_status = 'unmatched' AND active = 1"
    ).all() as any[];
    const bySku = sqlite.prepare(
      "SELECT id FROM items WHERE deleted_at IS NULL AND LOWER(part_number) = LOWER(?)"
    );
    const byName = sqlite.prepare(
      "SELECT id FROM items WHERE deleted_at IS NULL AND LOWER(name) = LOWER(?)"
    );
    let matched = 0;
    for (const q of unmatched) {
      let hits: any[] = q.sku ? (bySku.all(q.sku) as any[]) : [];
      if (hits.length !== 1) hits = byName.all(q.name) as any[];
      if (hits.length === 1) {
        this.qbMapItem(q.qb_id, hits[0].id, "matched");
        matched++;
      }
    }
    return matched;
  },

  qbItemIdForLocal(itemId: number): string | undefined {
    // active = 1: never push documents referencing an item deactivated in
    // QBO — those creates fail business validation every time.
    const row = sqlite.prepare(
      "SELECT qb_id FROM qb_items WHERE item_id = ? AND map_status = 'matched' AND active = 1 LIMIT 1"
    ).get(itemId) as any;
    return row?.qb_id;
  },

  // ── QuickBooks: customer/project cache + mapping ──────────────────────────
  qbUpsertCustomer(c: { qbId: string; displayName: string; isProject: boolean; active: boolean }): void {
    sqlite.prepare(`
      INSERT INTO qb_customers (qb_id, display_name, is_project, active, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(qb_id) DO UPDATE SET
        display_name = excluded.display_name, is_project = excluded.is_project,
        active = excluded.active, updated_at = excluded.updated_at
    `).run(c.qbId, c.displayName, c.isProject ? 1 : 0, c.active ? 1 : 0, Date.now());
  },

  qbListCustomers(): any[] {
    return sqlite.prepare(`
      SELECT q.*, p.name as project_name, p.job_number
      FROM qb_customers q LEFT JOIN projects p ON q.project_id = p.id
      WHERE q.active = 1
      ORDER BY q.display_name COLLATE NOCASE
    `).all() as any[];
  },

  qbMapCustomer(qbId: string, projectId: number | null): void {
    sqlite.prepare("UPDATE qb_customers SET project_id = ?, updated_at = ? WHERE qb_id = ?")
      .run(projectId, Date.now(), qbId);
  },

  // Match QBO customers/projects to our projects by exact name or job number
  // appearing as a whole segment of the QBO display name (bookkeepers often
  // name projects "Customer:WPT-2026-OVEN" or similar). Token-boundary
  // comparison + a minimum job-number length keep a blank or short job
  // number ("101") from substring-matching every customer in the file.
  qbAutoMatchProjects(): number {
    const unmapped = sqlite.prepare(
      "SELECT qb_id, display_name FROM qb_customers WHERE project_id IS NULL AND active = 1"
    ).all() as any[];
    const projects = sqlite.prepare(
      "SELECT id, name, job_number FROM projects WHERE deleted_at IS NULL"
    ).all() as any[];
    let matched = 0;
    for (const c of unmapped) {
      const dn = String(c.display_name).toLowerCase();
      const segments = dn.split(/[:\s,]+/).filter(Boolean);
      const hits = projects.filter((p) => {
        const name = String(p.name ?? "").toLowerCase();
        const jn = String(p.job_number ?? "").toLowerCase();
        return (name.length > 0 && dn === name) || (jn.length >= 3 && segments.includes(jn));
      });
      if (hits.length === 1) {
        this.qbMapCustomer(c.qb_id, hits[0].id);
        matched++;
      }
    }
    return matched;
  },

  qbCustomerIdForProject(projectId: number): string | undefined {
    const row = sqlite.prepare(
      "SELECT qb_id FROM qb_customers WHERE project_id = ? AND active = 1 LIMIT 1"
    ).get(projectId) as any;
    return row?.qb_id;
  },

  // ── QuickBooks: purchase orders ────────────────────────────────────────────
  qbUpsertPO(po: {
    qbId: string; docNumber: string | null; vendorName: string | null;
    txnDate: string | null; qbStatus: string | null; memo: string | null;
    lines: { qbLineId: string | null; qbItemId: string | null; description: string | null; qty: number; unitCost: number | null }[];
  }): void {
    const upsert = sqlite.transaction(() => {
      sqlite.prepare(`
        INSERT INTO purchase_orders (qb_id, doc_number, vendor_name, txn_date, qb_status, memo, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(qb_id) DO UPDATE SET
          doc_number = excluded.doc_number, vendor_name = excluded.vendor_name,
          txn_date = excluded.txn_date, qb_status = excluded.qb_status,
          memo = excluded.memo, synced_at = excluded.synced_at
      `).run(po.qbId, po.docNumber, po.vendorName, po.txnDate, po.qbStatus, po.memo, Date.now());

      const poId = (sqlite.prepare("SELECT id FROM purchase_orders WHERE qb_id = ?").get(po.qbId) as any).id;

      // Re-sync line details while preserving our local qty_received. Lines
      // are matched by QBO line id; lines the bookkeeper deleted go away
      // (their receipts already exist as transactions, nothing is lost).
      const existing = sqlite.prepare("SELECT id, qb_line_id FROM po_lines WHERE po_id = ?").all(poId) as any[];
      const byQbLine = new Map(existing.map((l) => [l.qb_line_id, l.id]));
      const seen = new Set<number>();
      for (const line of po.lines) {
        const existingId = line.qbLineId != null ? byQbLine.get(line.qbLineId) : undefined;
        if (existingId !== undefined) {
          sqlite.prepare(
            "UPDATE po_lines SET qb_item_id = ?, description = ?, qty = ?, unit_cost = ? WHERE id = ?"
          ).run(line.qbItemId, line.description, line.qty, line.unitCost, existingId);
          seen.add(existingId);
        } else {
          const info = sqlite.prepare(
            "INSERT INTO po_lines (po_id, qb_line_id, qb_item_id, description, qty, unit_cost) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(poId, line.qbLineId, line.qbItemId, line.description, line.qty, line.unitCost);
          seen.add(Number(info.lastInsertRowid));
        }
      }
      for (const l of existing) {
        if (!seen.has(l.id)) sqlite.prepare("DELETE FROM po_lines WHERE id = ?").run(l.id);
      }
    });
    upsert();
  },

  qbListPOs(opts: { includeClosed?: boolean } = {}): any[] {
    const pos = sqlite.prepare(`
      SELECT * FROM purchase_orders
      ${opts.includeClosed ? "" : "WHERE qb_status = 'Open'"}
      ORDER BY txn_date DESC, id DESC
      LIMIT 100
    `).all() as any[];
    if (pos.length === 0) return [];
    const lineStmt = sqlite.prepare(`
      SELECT l.*, qi.name as qb_item_name, qi.item_id as local_item_id, i.name as local_item_name
      FROM po_lines l
      LEFT JOIN qb_items qi ON l.qb_item_id = qi.qb_id
      LEFT JOIN items i ON qi.item_id = i.id
      WHERE l.po_id = ?
      ORDER BY l.id
    `);
    return pos.map((po) => ({ ...po, lines: lineStmt.all(po.id) }));
  },

  qbGetPoLine(lineId: number): any | undefined {
    return sqlite.prepare(`
      SELECT l.*, p.doc_number, p.qb_status, qi.item_id as local_item_id
      FROM po_lines l
      JOIN purchase_orders p ON l.po_id = p.id
      LEFT JOIN qb_items qi ON l.qb_item_id = qi.qb_id
      WHERE l.id = ?
    `).get(lineId) as any;
  },

  qbReceivePoLine(lineId: number, qty: number): void {
    sqlite.prepare("UPDATE po_lines SET qty_received = qty_received + ? WHERE id = ?").run(qty, lineId);
  },

  // POs that vanished from QBO query results were deleted there — flag them
  // so the Open filters (PO page, on-order counts, receive guard) drop them.
  qbMarkMissingPOs(presentQbIds: string[]): void {
    if (presentQbIds.length === 0) {
      sqlite.prepare("UPDATE purchase_orders SET qb_status = 'Deleted' WHERE qb_status != 'Deleted'").run();
      return;
    }
    const placeholders = presentQbIds.map(() => "?").join(",");
    sqlite.prepare(
      `UPDATE purchase_orders SET qb_status = 'Deleted' WHERE qb_id NOT IN (${placeholders}) AND qb_status != 'Deleted'`
    ).run(...presentQbIds);
  },

  // Open-PO quantity still expected for one of our items ("on order" badge).
  getItemOnOrder(itemId: number): number {
    const row = sqlite.prepare(`
      SELECT COALESCE(SUM(MAX(l.qty - l.qty_received, 0)), 0) as c
      FROM po_lines l
      JOIN purchase_orders p ON l.po_id = p.id
      JOIN qb_items qi ON qi.qb_id = l.qb_item_id
      WHERE qi.item_id = ? AND p.qb_status = 'Open'
    `).get(itemId) as any;
    return row?.c ?? 0;
  },

  // ── QuickBooks: push queue ─────────────────────────────────────────────────
  qbEnqueue(e: { kind: string; localRef: string; payload: unknown }): void {
    // OR IGNORE: the unique local_ref makes re-enqueueing a no-op.
    sqlite.prepare(
      "INSERT OR IGNORE INTO qb_push_queue (kind, local_ref, payload) VALUES (?, ?, ?)"
    ).run(e.kind, e.localRef, JSON.stringify(e.payload));
  },

  qbQueueList(limit = 50): any[] {
    return sqlite.prepare(
      "SELECT * FROM qb_push_queue ORDER BY id DESC LIMIT ?"
    ).all(limit) as any[];
  },

  qbQueuePending(): any[] {
    return sqlite.prepare(
      "SELECT * FROM qb_push_queue WHERE status = 'pending' ORDER BY id LIMIT 25"
    ).all() as any[];
  },

  // countAttempt=false for "waiting on mapping" marks — those shouldn't eat
  // into the transient-retry budget while a human gets around to mapping.
  qbQueueMark(id: number, status: string, extra: { error?: string; qbDocId?: string; countAttempt?: boolean } = {}): void {
    sqlite.prepare(`
      UPDATE qb_push_queue
      SET status = ?, attempts = attempts + ?, last_error = ?, qb_doc_id = COALESCE(?, qb_doc_id), processed_at = ?
      WHERE id = ?
    `).run(status, extra.countAttempt === false ? 0 : 1, extra.error ?? null, extra.qbDocId ?? null, Date.now(), id);
  },

  qbQueueRetry(id: number): void {
    // attempts resets so a job that exhausted its transient-retry budget gets
    // a fresh one after a human explicitly asks for it.
    sqlite.prepare(
      "UPDATE qb_push_queue SET status = 'pending', last_error = NULL, attempts = 0 WHERE id = ? AND status IN ('error', 'manual')"
    ).run(id);
  },

  qbQueueCounts(): { pending: number; error: number; manual: number } {
    const rows = sqlite.prepare(
      "SELECT status, COUNT(*) as c FROM qb_push_queue GROUP BY status"
    ).all() as any[];
    const out = { pending: 0, error: 0, manual: 0 };
    for (const r of rows) if (r.status in out) (out as any)[r.status] = r.c;
    return out;
  },

  qbUnmappedCounts(): { items: number; projects: number } {
    const items = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM qb_items WHERE map_status = 'unmatched' AND active = 1"
    ).get() as any).c;
    const projects = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM qb_customers WHERE project_id IS NULL AND active = 1 AND is_project = 1"
    ).get() as any).c;
    return { items, projects };
  },
};
