import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";
import path from "path";
import fs from "fs";
import {
  users, items, adjustments, transactions, projects, settings,
  mapLayouts, equipmentPresets, jobTemplates, projectChecklist,
  type User, type Item, type Adjustment, type Transaction,
  type Project, type Settings, type MapLayout, type EquipmentPreset,
  type JobTemplate, type ProjectChecklistRow, type PublicUser,
  type ChecklistRowWithItem,
} from "../shared/schema";
import {
  TEMPLATE_CATALOG, TEMPLATE_CATALOG_VERSION, LEGACY_TEMPLATE_KEYS,
} from "./template-catalog";

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

// Exported so business-module files (crm.ts, hr.ts, pm.ts, finance.ts,
// marketing.ts) can run their own DDL and drizzle queries against the same
// connection instead of threading everything through this file.
export const sqlite: Database.Database = new Database(path.join(dataDir, "inventory.db"));
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

export const db = drizzle(sqlite);

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
    -- Uniqueness on job_number is enforced by the partial index
    -- idx_projects_jobnumber_active (active rows only), NOT a table-level
    -- UNIQUE — reusing a trashed project's job number must be allowed.
    job_number TEXT NOT NULL,
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
    company_name TEXT NOT NULL DEFAULT 'CJM Metals',
    company_tagline TEXT DEFAULT 'Custom metalwork. No shortcuts.',
    logo_url TEXT,
    accent_hue INTEGER NOT NULL DEFAULT 0,
    accent_sat INTEGER NOT NULL DEFAULT 0,
    accent_light INTEGER NOT NULL DEFAULT 9,
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
// Wiring plan, Fix 2 — jobs link to a CRM client by id (soft ref, see schema.ts).
addColumnIfMissing("projects", "client_id", "client_id INTEGER");
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at)");
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at)");
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)");
// job_number must be unique only among ACTIVE projects, so a job number freed
// up by soft-deleting a project can be reused. This partial unique index
// enforces that. NOTE: databases created before the inline `UNIQUE` was removed
// from the projects table still carry an automatic table-level unique index
// spanning soft-deleted rows; dropping it requires a manual table-rebuild
// migration (SQLite can't drop an inline column constraint in place).
sqlite.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_jobnumber_active ON projects(job_number) WHERE deleted_at IS NULL",
);

// ─── CJM job-template catalog sync ───────────────────────────────────────────
// Upserts the code-owned service templates (server/template-catalog.ts) once
// per catalog version, so the owner's edits in Admin → Templates survive
// restarts. Owner-created templates (other keys) are never touched.
addColumnIfMissing("settings", "template_catalog_version", "template_catalog_version INTEGER NOT NULL DEFAULT 0");
{
  sqlite.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)");
  const row = sqlite.prepare(
    "SELECT template_catalog_version AS v FROM settings WHERE id = 1",
  ).get() as { v: number } | undefined;
  if ((row?.v ?? 0) < TEMPLATE_CATALOG_VERSION) {
    const now = Date.now();
    const up = sqlite.prepare(
      "UPDATE job_templates SET label = ?, blurb = ?, icon = ?, params = ?, parts = ?, order_index = ?, enabled = 1, updated_at = ? WHERE key = ?",
    );
    const ins = sqlite.prepare(
      "INSERT INTO job_templates (key, label, blurb, icon, params, parts, order_index, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
    );
    TEMPLATE_CATALOG.forEach((t, i) => {
      const params = JSON.stringify(t.params);
      const parts = JSON.stringify(t.parts);
      const r = up.run(t.label, t.blurb, t.icon, params, parts, i, now, t.key);
      if (r.changes === 0) ins.run(t.key, t.label, t.blurb, t.icon, params, parts, i, now);
    });
    // Pre-CJM industrial templates: hidden from the picker, not deleted —
    // restorable from Admin → Templates if ever wanted.
    const ph = LEGACY_TEMPLATE_KEYS.map(() => "?").join(",");
    sqlite.prepare(`UPDATE job_templates SET enabled = 0, updated_at = ? WHERE key IN (${ph})`)
      .run(now, ...LEGACY_TEMPLATE_KEYS);
    sqlite.prepare("UPDATE settings SET template_catalog_version = ? WHERE id = 1")
      .run(TEMPLATE_CATALOG_VERSION);
    console.log(
      `[templates] CJM catalog v${TEMPLATE_CATALOG_VERSION} synced — ${TEMPLATE_CATALOG.length} service templates, ${LEGACY_TEMPLATE_KEYS.length} legacy disabled`,
    );
  }
}

// ─── Helper: strip pin from user ─────────────────────────────────────────────

function toPublicUser(u: User): PublicUser {
  const { pin, ...pub } = u;
  return pub;
}

// Escape LIKE metacharacters (\, %, _) in a user-supplied search term so they
// match literally instead of acting as wildcards. Backslash must be escaped
// first. Pair with `ESCAPE '\'` on every LIKE clause that uses the result.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
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
      const pattern = `%${escapeLike(opts.q)}%`;
      conditions.push(
        or(
          sql`${items.name} LIKE ${pattern} ESCAPE '\\'`,
          sql`${items.partNumber} LIKE ${pattern} ESCAPE '\\'`,
          sql`${items.mfgPartNumber} LIKE ${pattern} ESCAPE '\\'`
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
    // Stock mutation + ledger row must commit together or not at all — a failed
    // INSERT must never leave the quantity changed with no adjustment record.
    return db.transaction((tx) => {
      // Verify the item exists AND is active before touching stock. Done inside
      // the transaction so a concurrent soft-delete can't race the check.
      const item = tx.select().from(items)
        .where(and(eq(items.id, itemId), sql`${items.deletedAt} IS NULL`)).get();
      if (!item) throw new Error("Item not found");
      sqlite.prepare("UPDATE items SET quantity = quantity + ? WHERE id = ?").run(data.delta, itemId);
      return tx.insert(adjustments).values({
        itemId,
        userId,
        delta: data.delta,
        reason: data.reason as any,
        notes: data.notes || null,
      }).returning().get();
    });
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
      query += " AND (i.name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')";
      const pat = `%${escapeLike(opts.q)}%`;
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
    // Stock mutation + ledger row must commit together or not at all — a failed
    // INSERT (e.g. a bad projectId FK with foreign_keys=ON) must never leave the
    // quantity changed with no transaction record.
    return db.transaction((tx) => {
      // Verify the item exists AND is active before touching stock. Done inside
      // the transaction so a concurrent soft-delete can't race the check.
      const item = tx.select().from(items)
        .where(and(eq(items.id, itemId), sql`${items.deletedAt} IS NULL`)).get();
      if (!item) throw new Error("Item not found");
      sqlite.prepare("UPDATE items SET quantity = quantity + ? WHERE id = ?").run(delta, itemId);
      return tx.insert(transactions).values({
        itemId,
        userId,
        type,
        quantity: data.quantity,
        notes: data.notes || null,
        projectId: data.projectId ?? null,
      }).returning().get();
    });
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
      query += " AND (i.name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')";
      const pat = `%${escapeLike(opts.q)}%`;
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

  // Wiring plan, Fix 2 — resolve a CRM client's display name for the
  // denormalized `customer` column. Raw SQL: crm_clients belongs to crm.ts,
  // which bootstraps after this module loads; the query only runs at request
  // time, and try/catch covers a missing table just in case.
  crmClientName(clientId: number): string | null {
    try {
      const row = sqlite.prepare(
        "SELECT name FROM crm_clients WHERE id = ? AND deleted_at IS NULL",
      ).get(clientId) as { name?: string } | undefined;
      return row?.name ?? null;
    } catch {
      return null;
    }
  },

  createProject(data: { jobNumber: string; name: string; customer?: string; clientId?: number | null; status?: string; notes?: string }): Project {
    const clientId = data.clientId ?? null;
    return db.insert(projects).values({
      jobNumber: data.jobNumber,
      name: data.name,
      // clientId set but no customer text → denormalize the client's name.
      customer: data.customer || (clientId != null ? this.crmClientName(clientId) : null),
      clientId,
      status: (data.status as any) || "active",
      notes: data.notes || null,
    }).returning().get();
  },

  updateProject(id: number, data: any): Project | undefined {
    const vals: any = {};
    if (data.name !== undefined) vals.name = data.name;
    if (data.customer !== undefined) vals.customer = data.customer;
    if (data.clientId !== undefined) {
      vals.clientId = data.clientId; // null unlinks; customer text stays as the snapshot
      if (data.clientId != null && data.customer === undefined) {
        vals.customer = this.crmClientName(data.clientId) ?? undefined;
      }
    }
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

    // Weekly checkouts (last 8 weeks). Join items so checkouts of soft-deleted
    // items are excluded, matching the scalar stats' deleted_at filter.
    const weeklyCheckouts = sqlite.prepare(`
      SELECT
        CAST((t.created_at / (7 * 24 * 3600 * 1000)) AS INTEGER) as week,
        SUM(t.quantity) as total
      FROM transactions t
      JOIN items i ON t.item_id = i.id
      WHERE t.type = 'check_out' AND t.created_at >= ? AND i.deleted_at IS NULL
      GROUP BY week
      ORDER BY week
    `).all(eightWeeksAgo) as any[];

    // Top workers by checkouts. Join items so checkouts of soft-deleted items
    // don't inflate a worker's total. (users are hard-deleted, so there's no
    // deleted_at column to filter on the users side.)
    const topWorkers = sqlite.prepare(`
      SELECT u.name, SUM(t.quantity) as total
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN items i ON t.item_id = i.id
      WHERE t.type = 'check_out' AND t.created_at >= ? AND i.deleted_at IS NULL
      GROUP BY t.user_id
      ORDER BY total DESC
      LIMIT 10
    `).all(sevenDaysAgo) as any[];

    // Top items by usage. Exclude soft-deleted items so the dashboard matches
    // what's visible in Find Items.
    const topItems = sqlite.prepare(`
      SELECT i.name, SUM(t.quantity) as total
      FROM transactions t
      JOIN items i ON t.item_id = i.id
      WHERE t.type = 'check_out' AND t.created_at >= ? AND i.deleted_at IS NULL
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
};
