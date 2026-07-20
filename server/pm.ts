import type { Express } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { eq, and, or, desc, asc, isNull, like, gte, lt, sql, getTableColumns } from "drizzle-orm";
import { sqlite, db } from "./storage";
import { auditQuiet as audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import { users, projects } from "../shared/schema";
import {
  pmTasks, timeEntries, timesheets, contracts, changeOrders, pmDocuments, kbArticles,
  insertPmTaskSchema, insertTimeEntrySchema, insertContractSchema,
  insertChangeOrderSchema, insertKbArticleSchema,
  TASK_STATUSES, DOCUMENT_KINDS,
} from "../shared/pm-schema";
import { clients } from "../shared/crm-schema";
import { pid, qstr, isElevated, registerSoftDelete } from "./http-util";

// ─── Table creation (synchronous DDL) ────────────────────────────────────────
// Mirrors shared/pm-schema.ts exactly. pm_contracts.client_id is a soft
// reference into the CRM module (crm_clients) — no REFERENCES clause so this
// module never depends on another module's DDL having run first.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS pm_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    start_date TEXT,
    due_date TEXT,
    estimate_hours REAL,
    order_index INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  -- Leading with deleted_at lets one index satisfy the kanban query
  -- (active rows, grouped by column, ordered within the column).
  CREATE INDEX IF NOT EXISTS idx_pm_tasks_deleted_status ON pm_tasks(deleted_at, status, order_index);
  CREATE INDEX IF NOT EXISTS idx_pm_tasks_project ON pm_tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_pm_tasks_assignee ON pm_tasks(assignee_id);
  CREATE INDEX IF NOT EXISTS idx_pm_tasks_due ON pm_tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_pm_tasks_created ON pm_tasks(created_at);

  CREATE TABLE IF NOT EXISTS pm_time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES pm_tasks(id) ON DELETE SET NULL,
    description TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_min INTEGER NOT NULL DEFAULT 0,
    billable INTEGER NOT NULL DEFAULT 1,
    -- "Billed on" stamp (wiring plan, Fix 4) — soft ref to fin_invoices.id.
    invoice_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  -- (user_id, started_at) covers both "my entries in range" and the
  -- weekly timesheet rollup; ended_at finds the running timer fast.
  CREATE INDEX IF NOT EXISTS idx_pm_time_user_started ON pm_time_entries(user_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_pm_time_project ON pm_time_entries(project_id);
  CREATE INDEX IF NOT EXISTS idx_pm_time_task ON pm_time_entries(task_id);
  CREATE INDEX IF NOT EXISTS idx_pm_time_ended ON pm_time_entries(ended_at);
  CREATE INDEX IF NOT EXISTS idx_pm_time_created ON pm_time_entries(created_at);

  CREATE TABLE IF NOT EXISTS pm_timesheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    submitted_at INTEGER,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_pm_timesheets_user_week ON pm_timesheets(user_id, week_start);
  CREATE INDEX IF NOT EXISTS idx_pm_timesheets_week ON pm_timesheets(week_start);
  CREATE INDEX IF NOT EXISTS idx_pm_timesheets_status ON pm_timesheets(status);

  CREATE TABLE IF NOT EXISTS pm_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'contract',
    -- Soft cross-module reference to crm_clients(id); no FK on purpose.
    client_id INTEGER,
    client_name TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    value_cents INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    -- Per-kind structured fields (JSON) — see shared/pm-schema.ts.
    fields TEXT NOT NULL DEFAULT '{}',
    body TEXT,
    file_url TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pm_contracts_deleted_status ON pm_contracts(deleted_at, status);
  CREATE INDEX IF NOT EXISTS idx_pm_contracts_project ON pm_contracts(project_id);
  CREATE INDEX IF NOT EXISTS idx_pm_contracts_client ON pm_contracts(client_id);
  CREATE INDEX IF NOT EXISTS idx_pm_contracts_created ON pm_contracts(created_at);

  -- Phase G #1: change orders. contract_id is a soft ref (no FK on purpose).
  CREATE TABLE IF NOT EXISTS pm_change_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    contract_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    approved_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pm_change_orders_project ON pm_change_orders(project_id, deleted_at, status);

  -- Phase G #4: compliance documents. project_id NULL = company-level.
  CREATE TABLE IF NOT EXISTS pm_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    expires_at TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pm_documents_project ON pm_documents(project_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_pm_documents_expires ON pm_documents(expires_at);

  CREATE TABLE IF NOT EXISTS pm_kb_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deleted_at INTEGER
  );
  -- List order is pinned-first / recently-updated — one composite index.
  CREATE INDEX IF NOT EXISTS idx_pm_kb_deleted_pinned_updated ON pm_kb_articles(deleted_at, pinned, updated_at);
  CREATE INDEX IF NOT EXISTS idx_pm_kb_category ON pm_kb_articles(category);
  CREATE INDEX IF NOT EXISTS idx_pm_kb_created ON pm_kb_articles(created_at);
`);

// Additive migration (wiring plan, Fix 4): pm_time_entries.invoice_id arrived
// after installs existed. SQLite has no IF NOT EXISTS for columns — the throw
// on re-run is expected.
try {
  sqlite.exec("ALTER TABLE pm_time_entries ADD COLUMN invoice_id INTEGER");
} catch {
  /* column already exists */
}
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_pm_time_invoice ON pm_time_entries(invoice_id)");

// Additive migration: pm_contracts.fields (per-kind structured contract
// fields, JSON) arrived after installs existed — same deal.
try {
  sqlite.exec("ALTER TABLE pm_contracts ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'");
} catch {
  /* column already exists */
}

// Phase D #21/#22: quote_ref (soft ref to quotes.number — the quote this
// contract was drawn from) and warranty_months (warranty window from the
// linked job's completion; consumed by the automations warranty sweep).
for (const ddl of [
  "ALTER TABLE pm_contracts ADD COLUMN quote_ref TEXT",
  "ALTER TABLE pm_contracts ADD COLUMN warranty_months INTEGER",
]) {
  try {
    sqlite.exec(ddl);
  } catch {
    /* column already exists */
  }
}

// ─── Document uploads (Phase G #4) ───────────────────────────────────────────
// Same DATA_DIR/uploads dir + timestamp-random filename style as the multer
// photo flow in routes.ts, extended to accept PDFs (COIs/W-9s are PDFs). PDFs
// are deliberately NOT servable via the public /uploads static handler (it
// only serves image extensions), so document files are only reachable through
// the authed GET /api/pm/documents/:id/file below — a W-9 carries an EIN/SSN
// and must not sit behind an unauthenticated URL.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
const docUploadDir = path.resolve(dataDir, "uploads");
if (!fs.existsSync(docUploadDir)) fs.mkdirSync(docUploadDir, { recursive: true });

// Extension → safe Content-Type, doubling as the accept allowlist (same
// stance as routes.ts EXT_TO_MIME: never let the browser sniff HTML/JS).
const DOC_EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};
const DOC_ALLOWED_MIME = new Set(Object.values(DOC_EXT_TO_MIME));

const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, docUploadDir),
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname).toLowerCase();
      const ext = DOC_EXT_TO_MIME[rawExt] ? rawExt : ".pdf";
      cb(null, `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB, same as photos
  fileFilter: (_req, file, cb) => {
    if (DOC_ALLOWED_MIME.has(file.mimetype.toLowerCase())) return cb(null, true);
    cb(new Error("Only PDF or image uploads are allowed"));
  },
});

// ─── Local date helpers ──────────────────────────────────────────────────────
// Calendar dates are TEXT "YYYY-MM-DD" in the shop's local timezone; instants
// are unix ms. Weeks run Monday→Sunday to match the timesheet cycle.

function ymdLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight of a "YYYY-MM-DD" string, as unix ms. */
function ymdToLocalMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return ymdLocal(new Date(y, m - 1, d + days));
}

/** Monday of the week containing `d`, as "YYYY-MM-DD". */
function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // getDay(): Sun=0 … Sat=6
  return ymdLocal(x);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accept either unix ms or "YYYY-MM-DD" (→ local midnight) in query params. */
function parseWhen(v: string): number | undefined {
  if (YMD_RE.test(v)) return ymdToLocalMs(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// `qstr` (req.query → non-empty string) and `isElevated` (manager|technician
// role check) live in ./http-util.

// ─── Body schemas local to this module ───────────────────────────────────────

const reorderSchema = z.object({
  moves: z.array(z.object({
    id: z.number().int(),
    status: z.enum(TASK_STATUSES),
    orderIndex: z.number().int(),
  })).min(1),
});

const timerStartSchema = z.object({
  projectId: z.number().int().optional(),
  taskId: z.number().int().optional(),
  description: z.string().optional(),
});

const timesheetSubmitSchema = z.object({
  weekStart: z.string().regex(YMD_RE),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerPmRoutes(app: Express): void {
  // `pid` (req.params → number) lives in ./http-util.

  // ── Stats ──────────────────────────────────────────────────────────────────

  app.get("/api/pm/stats", requireAuth, (_req, res) => {
    const today = ymdLocal(new Date());
    const weekStart = mondayOf(new Date());
    const weekStartMs = ymdToLocalMs(weekStart);
    const weekEndMs = ymdToLocalMs(addDaysYmd(weekStart, 7));

    const openTasks = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
      .where(and(isNull(pmTasks.deletedAt), sql`${pmTasks.status} != 'done'`)).get()!.n;
    const inProgress = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
      .where(and(isNull(pmTasks.deletedAt), eq(pmTasks.status, "in_progress"))).get()!.n;
    // NULL due_date never compares less-than, so undated tasks are excluded.
    const overdueTasks = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
      .where(and(
        isNull(pmTasks.deletedAt),
        sql`${pmTasks.status} != 'done'`,
        sql`${pmTasks.dueDate} < ${today}`,
      )).get()!.n;
    const hoursThisWeekMin = db.select({ n: sql<number>`coalesce(sum(${timeEntries.durationMin}), 0)` })
      .from(timeEntries)
      .where(and(gte(timeEntries.startedAt, weekStartMs), lt(timeEntries.startedAt, weekEndMs)))
      .get()!.n;
    const activeContractsValueCents = db.select({ n: sql<number>`coalesce(sum(${contracts.valueCents}), 0)` })
      .from(contracts)
      .where(and(isNull(contracts.deletedAt), or(eq(contracts.status, "signed"), eq(contracts.status, "active"))))
      .get()!.n;
    const kbCount = db.select({ n: sql<number>`count(*)` }).from(kbArticles)
      .where(isNull(kbArticles.deletedAt)).get()!.n;
    // Powers the dashboard's completion ring: done ÷ (open + done).
    const doneTasks = db.select({ n: sql<number>`count(*)` }).from(pmTasks)
      .where(and(isNull(pmTasks.deletedAt), eq(pmTasks.status, "done"))).get()!.n;

    res.json({ openTasks, inProgress, overdueTasks, hoursThisWeekMin, activeContractsValueCents, kbCount, doneTasks });
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────
  // Literal /tasks/reorder is registered before the parameterized /tasks/:id
  // handlers so "reorder" is never parsed as an id.

  app.get("/api/pm/tasks", requireAuth, (req, res) => {
    const conditions: any[] = [isNull(pmTasks.deletedAt)];
    const projectId = qstr(req.query.projectId);
    const status = qstr(req.query.status);
    const assigneeId = qstr(req.query.assigneeId);
    const q = qstr(req.query.q);
    if (projectId) conditions.push(eq(pmTasks.projectId, parseInt(projectId, 10)));
    if (status) conditions.push(eq(pmTasks.status, status as any));
    if (assigneeId) conditions.push(eq(pmTasks.assigneeId, parseInt(assigneeId, 10)));
    if (q) {
      const pat = `%${q}%`;
      conditions.push(or(like(pmTasks.title, pat), like(pmTasks.description, pat)));
    }
    const rows = db.select({
      ...getTableColumns(pmTasks),
      projectName: projects.name,
      assigneeName: users.name,
      // Phase D #24b: actual time logged against the task — the client shows
      // "Logged Xh / est Yh" so estimates finally meet reality.
      loggedMin: sql<number>`coalesce((
        SELECT sum(te.duration_min) FROM pm_time_entries te WHERE te.task_id = ${pmTasks.id}
      ), 0)`,
    })
      .from(pmTasks)
      .leftJoin(projects, eq(pmTasks.projectId, projects.id))
      .leftJoin(users, eq(pmTasks.assigneeId, users.id))
      .where(and(...conditions))
      .orderBy(asc(pmTasks.status), asc(pmTasks.orderIndex), asc(pmTasks.id))
      .all();
    res.json(rows);
  });

  app.post("/api/pm/tasks", requireAuth, (req, res) => {
    let body;
    try {
      body = insertPmTaskSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    // New cards land at the bottom of their kanban column unless the client
    // supplies an explicit position.
    let orderIndex = body.orderIndex;
    if (orderIndex === undefined || orderIndex === null) {
      const status = body.status ?? "todo";
      const row = db.select({ max: sql<number | null>`max(${pmTasks.orderIndex})` }).from(pmTasks)
        .where(and(isNull(pmTasks.deletedAt), eq(pmTasks.status, status))).get();
      orderIndex = (row?.max ?? -1) + 1;
    }
    // Logging already-finished work (created straight into "done") follows the
    // same completed_at rule as PATCH/reorder transitions into done.
    const completedAt = body.status === "done" ? Date.now() : undefined;
    const task = db.insert(pmTasks).values({ ...body, orderIndex, completedAt }).returning().get();
    audit(req, "pm.task_create", { targetType: "pm_task", targetId: task.id, targetName: task.title });
    res.status(201).json(task);
  });

  app.post("/api/pm/tasks/reorder", requireAuth, (req, res) => {
    let body;
    try {
      body = reorderSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    // A drag-drop reshuffle touches many rows; apply atomically so a crash
    // mid-loop can't leave the board half-reordered. Column moves follow the
    // same completed_at rule as PATCH: entering done stamps it (once),
    // leaving done clears it.
    const stmt = sqlite.prepare(`
      UPDATE pm_tasks
      SET status = @status,
          order_index = @orderIndex,
          completed_at = CASE WHEN @status = 'done' THEN COALESCE(completed_at, @now) ELSE NULL END
      WHERE id = @id AND deleted_at IS NULL
    `);
    const applyMoves = sqlite.transaction((moves: typeof body.moves) => {
      const now = Date.now();
      for (const m of moves) stmt.run({ id: m.id, status: m.status, orderIndex: m.orderIndex, now });
    });
    applyMoves(body.moves);
    audit(req, "pm.tasks_reorder", { targetType: "pm_task", details: { count: body.moves.length } });
    res.json({ ok: true });
  });

  app.patch("/api/pm/tasks/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(pmTasks)
      .where(and(eq(pmTasks.id, id), isNull(pmTasks.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Task not found" });
    let patch;
    try {
      patch = insertPmTaskSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    const set: Partial<typeof pmTasks.$inferInsert> = { ...patch };
    if (patch.status && patch.status !== existing.status) {
      // Completion timestamp follows the done column: stamped on entry,
      // cleared when the card is pulled back into an active column.
      if (patch.status === "done") set.completedAt = Date.now();
      else if (existing.status === "done") set.completedAt = null;
      audit(req, "pm.task_status", {
        targetType: "pm_task", targetId: id, targetName: existing.title,
        details: { from: existing.status, to: patch.status },
      });
    }
    const updated = db.update(pmTasks).set(set).where(eq(pmTasks.id, id)).returning().get();
    res.json(updated);
  });

  registerSoftDelete(app, "/api/pm/tasks/:id", requireAuth, {
    table: pmTasks, notFound: "Task not found",
    action: "pm.task_delete", targetType: "pm_task", name: (t) => t.title, audit,
  });

  // ── Time tracking ──────────────────────────────────────────────────────────
  // Literal /time/start, /time/stop, /time/running before /time/:id.

  app.get("/api/pm/time", requireAuth, (req, res) => {
    const conditions: any[] = [];
    // Workers only ever see their own hours; managers/technicians may filter
    // by any user (or none, for the whole shop).
    if (!isElevated(req)) {
      conditions.push(eq(timeEntries.userId, req.user!.userId));
    } else {
      const userId = qstr(req.query.userId);
      if (userId) conditions.push(eq(timeEntries.userId, parseInt(userId, 10)));
    }
    const projectId = qstr(req.query.projectId);
    if (projectId) conditions.push(eq(timeEntries.projectId, parseInt(projectId, 10)));
    const from = qstr(req.query.from);
    const to = qstr(req.query.to);
    if (from) {
      const ms = parseWhen(from);
      if (ms !== undefined) conditions.push(gte(timeEntries.startedAt, ms));
    }
    if (to) {
      // A calendar-date upper bound is inclusive of that whole day.
      const ms = YMD_RE.test(to) ? ymdToLocalMs(addDaysYmd(to, 1)) : parseWhen(to);
      if (ms !== undefined) conditions.push(lt(timeEntries.startedAt, ms));
    }
    // pm_time_entries grows a row per shift per user forever — an unbounded
    // default would make the Time page's initial load scan the whole table.
    // 500 covers months of a small shop's entries; callers paging further back
    // narrow with from/to or raise ?limit explicitly.
    const rawLimit = parseInt(qstr(req.query.limit) ?? "", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 500;
    const rows = db.select({
      ...getTableColumns(timeEntries),
      projectName: projects.name,
      taskTitle: pmTasks.title,
    })
      .from(timeEntries)
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .leftJoin(pmTasks, eq(timeEntries.taskId, pmTasks.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(timeEntries.startedAt))
      .limit(limit)
      .all();
    res.json(rows);
  });

  app.get("/api/pm/time/running", requireAuth, (req, res) => {
    const row = db.select().from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user!.userId), isNull(timeEntries.endedAt)))
      .get();
    res.json(row ?? null);
  });

  app.post("/api/pm/time/start", requireAuth, (req, res) => {
    let body;
    try {
      body = timerStartSchema.parse(req.body ?? {});
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    // One running timer per user — stop the old one before starting another.
    const running = db.select().from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user!.userId), isNull(timeEntries.endedAt)))
      .get();
    if (running) {
      return res.status(409).json({ message: "A timer is already running — stop it first." });
    }
    const entry = db.insert(timeEntries).values({
      userId: req.user!.userId,
      projectId: body.projectId ?? null,
      taskId: body.taskId ?? null,
      description: body.description ?? null,
      startedAt: Date.now(),
      durationMin: 0,
    }).returning().get();
    res.status(201).json(entry);
  });

  app.post("/api/pm/time/stop", requireAuth, (req, res) => {
    const running = db.select().from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user!.userId), isNull(timeEntries.endedAt)))
      .get();
    if (!running) return res.status(404).json({ message: "No running timer" });
    const now = Date.now();
    const updated = db.update(timeEntries)
      .set({ endedAt: now, durationMin: Math.max(0, Math.round((now - running.startedAt) / 60000)) })
      .where(eq(timeEntries.id, running.id))
      .returning().get();
    res.json(updated);
  });

  // Manual entry — needs enough of {startedAt, endedAt, durationMin} to derive
  // the rest; the missing member is computed server-side.
  app.post("/api/pm/time", requireAuth, (req, res) => {
    let body;
    try {
      body = insertTimeEntrySchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    let { startedAt, endedAt, durationMin } = body;
    if (startedAt != null && endedAt != null) {
      if (endedAt < startedAt) return res.status(400).json({ message: "endedAt must be after startedAt" });
      durationMin ??= Math.round((endedAt - startedAt) / 60000);
    } else if (startedAt != null && durationMin != null) {
      endedAt = startedAt + durationMin * 60000;
    } else if (endedAt != null && durationMin != null) {
      startedAt = endedAt - durationMin * 60000;
    } else {
      return res.status(400).json({ message: "Provide startedAt + endedAt, or durationMin with one of them" });
    }
    const entry = db.insert(timeEntries).values({
      userId: req.user!.userId,
      projectId: body.projectId ?? null,
      taskId: body.taskId ?? null,
      description: body.description ?? null,
      startedAt,
      endedAt,
      durationMin,
      billable: body.billable ?? true,
    }).returning().get();
    res.status(201).json(entry);
  });

  app.patch("/api/pm/time/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
    if (!existing) return res.status(404).json({ message: "Time entry not found" });
    if (existing.userId !== req.user!.userId && !isElevated(req)) {
      return res.status(403).json({ message: "You can only edit your own time entries" });
    }
    let patch;
    try {
      patch = insertTimeEntrySchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    const set: Partial<typeof timeEntries.$inferInsert> = { ...patch };
    // Keep durationMin consistent when the interval shifts and the caller
    // didn't supply an explicit override.
    const nextStart = patch.startedAt ?? existing.startedAt;
    const nextEnd = patch.endedAt !== undefined ? patch.endedAt : existing.endedAt;
    if (patch.durationMin === undefined
      && (patch.startedAt !== undefined || patch.endedAt !== undefined)
      && nextEnd != null) {
      set.durationMin = Math.max(0, Math.round((nextEnd - nextStart) / 60000));
    }
    const updated = db.update(timeEntries).set(set).where(eq(timeEntries.id, id)).returning().get();
    res.json(updated);
  });

  app.delete("/api/pm/time/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
    if (!existing) return res.status(404).json({ message: "Time entry not found" });
    if (existing.userId !== req.user!.userId && !isElevated(req)) {
      return res.status(403).json({ message: "You can only delete your own time entries" });
    }
    // No deleted_at column on time entries — hard delete.
    db.delete(timeEntries).where(eq(timeEntries.id, id)).run();
    res.json({ ok: true });
  });

  // ── Timesheets ─────────────────────────────────────────────────────────────
  // Hours are always computed from pm_time_entries; the pm_timesheets row is
  // only the weekly sign-off wrapper (open → submitted → approved).

  app.get("/api/pm/timesheets", requireAuth, (req, res) => {
    const wsQ = qstr(req.query.weekStart);
    // Normalize any supplied date to its Monday so off-by-a-day clients still
    // land on the right week.
    const weekStart = wsQ && YMD_RE.test(wsQ)
      ? mondayOf(new Date(ymdToLocalMs(wsQ)))
      : mondayOf(new Date());
    const startMs = ymdToLocalMs(weekStart);
    const endMs = ymdToLocalMs(addDaysYmd(weekStart, 7));
    const elevated = isElevated(req);

    const entryConds: any[] = [gte(timeEntries.startedAt, startMs), lt(timeEntries.startedAt, endMs)];
    const sheetConds: any[] = [eq(timesheets.weekStart, weekStart)];
    if (!elevated) {
      entryConds.push(eq(timeEntries.userId, req.user!.userId));
      sheetConds.push(eq(timesheets.userId, req.user!.userId));
    }

    const entries = db.select({
      userId: timeEntries.userId,
      userName: users.name,
      startedAt: timeEntries.startedAt,
      durationMin: timeEntries.durationMin,
      billable: timeEntries.billable,
    })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(...entryConds))
      .all();

    const sheets = db.select({
      id: timesheets.id,
      userId: timesheets.userId,
      userName: users.name,
      status: timesheets.status,
    })
      .from(timesheets)
      .innerJoin(users, eq(timesheets.userId, users.id))
      .where(and(...sheetConds))
      .all();

    interface SheetRow {
      userId: number;
      userName: string;
      days: number[]; // 7 buckets, Mon..Sun, minutes
      totalMin: number;
      billableMin: number;
      status: string;
      timesheetId: number | null;
    }
    const byUser = new Map<number, SheetRow>();
    const rowFor = (userId: number, userName: string): SheetRow => {
      let row = byUser.get(userId);
      if (!row) {
        row = { userId, userName, days: [0, 0, 0, 0, 0, 0, 0], totalMin: 0, billableMin: 0, status: "open", timesheetId: null };
        byUser.set(userId, row);
      }
      return row;
    };
    for (const e of entries) {
      const row = rowFor(e.userId, e.userName);
      // Clamp so a DST hour shift can't push an entry outside the 7 buckets.
      const day = Math.min(6, Math.max(0, Math.floor((e.startedAt - startMs) / 86400000)));
      row.days[day] += e.durationMin;
      row.totalMin += e.durationMin;
      if (e.billable) row.billableMin += e.durationMin;
    }
    for (const s of sheets) {
      const row = rowFor(s.userId, s.userName);
      row.status = s.status;
      row.timesheetId = s.id;
    }
    const rows = Array.from(byUser.values()).sort((a, b) => a.userName.localeCompare(b.userName));
    res.json(rows);
  });

  app.post("/api/pm/timesheets/submit", requireAuth, (req, res) => {
    let body;
    try {
      body = timesheetSubmitSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    const weekStart = mondayOf(new Date(ymdToLocalMs(body.weekStart)));
    const now = Date.now();
    const existing = db.select().from(timesheets)
      .where(and(eq(timesheets.userId, req.user!.userId), eq(timesheets.weekStart, weekStart)))
      .get();
    // Re-submitting resets the approval — the approver re-reviews the change.
    const row = existing
      ? db.update(timesheets)
        .set({ status: "submitted", submittedAt: now, approvedBy: null, approvedAt: null })
        .where(eq(timesheets.id, existing.id)).returning().get()
      : db.insert(timesheets).values({
        userId: req.user!.userId,
        weekStart,
        status: "submitted",
        submittedAt: now,
      }).returning().get();
    audit(req, "pm.timesheet_submit", { targetType: "pm_timesheet", targetId: row.id, targetName: weekStart });
    res.json(row);
  });

  app.post("/api/pm/timesheets/:id/approve", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(timesheets).where(eq(timesheets.id, id)).get();
    if (!existing) return res.status(404).json({ message: "Timesheet not found" });
    const updated = db.update(timesheets)
      .set({ status: "approved", approvedBy: req.user!.userId, approvedAt: Date.now() })
      .where(eq(timesheets.id, id))
      .returning().get();
    audit(req, "pm.timesheet_approve", {
      targetType: "pm_timesheet", targetId: id, targetName: existing.weekStart,
      details: { userId: existing.userId },
    });
    res.json(updated);
  });

  // ── Contracts ──────────────────────────────────────────────────────────────
  // Reads are open to everyone signed in; mutations are manager/technician.

  app.get("/api/pm/contracts", requireAuth, (req, res) => {
    const conditions: any[] = [isNull(contracts.deletedAt)];
    const kind = qstr(req.query.kind);
    const status = qstr(req.query.status);
    const projectId = qstr(req.query.projectId);
    const q = qstr(req.query.q);
    if (kind) conditions.push(eq(contracts.kind, kind as any));
    if (status) conditions.push(eq(contracts.status, status as any));
    if (projectId) conditions.push(eq(contracts.projectId, parseInt(projectId, 10)));
    if (q) {
      const pat = `%${q}%`;
      conditions.push(or(like(contracts.title, pat), like(contracts.clientName, pat), like(clients.name, pat)));
    }
    const rows = db.select({
      ...getTableColumns(contracts),
      // The linked CRM client wins; the free-text fallback covers contracts
      // that never got attached to a client record.
      clientName: sql<string | null>`coalesce(${clients.name}, ${contracts.clientName})`,
      projectName: projects.name,
    })
      .from(contracts)
      .leftJoin(clients, eq(contracts.clientId, clients.id))
      .leftJoin(projects, eq(contracts.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(contracts.createdAt))
      .all();
    res.json(rows);
  });

  app.get("/api/pm/contracts/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const row = db.select({
      ...getTableColumns(contracts),
      clientName: sql<string | null>`coalesce(${clients.name}, ${contracts.clientName})`,
      projectName: projects.name,
    })
      .from(contracts)
      .leftJoin(clients, eq(contracts.clientId, clients.id))
      .leftJoin(projects, eq(contracts.projectId, projects.id))
      .where(and(eq(contracts.id, id), isNull(contracts.deletedAt)))
      .get();
    if (!row) return res.status(404).json({ message: "Contract not found" });
    res.json(row);
  });

  app.post("/api/pm/contracts", requireElevated, (req, res) => {
    let body;
    try {
      body = insertContractSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    const row = db.insert(contracts).values(body).returning().get();
    audit(req, "pm.contract_create", { targetType: "pm_contract", targetId: row.id, targetName: row.title });
    res.status(201).json(row);
  });

  app.patch("/api/pm/contracts/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(contracts)
      .where(and(eq(contracts.id, id), isNull(contracts.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Contract not found" });
    let patch;
    try {
      patch = insertContractSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    if (patch.status && patch.status !== existing.status) {
      audit(req, "pm.contract_status", {
        targetType: "pm_contract", targetId: id, targetName: existing.title,
        details: { from: existing.status, to: patch.status },
      });
    }
    const updated = db.update(contracts).set(patch).where(eq(contracts.id, id)).returning().get();
    res.json(updated);
  });

  registerSoftDelete(app, "/api/pm/contracts/:id", requireElevated, {
    table: contracts, notFound: "Contract not found",
    action: "pm.contract_delete", targetType: "pm_contract", name: (c) => c.title, audit,
  });

  // ── Change orders (Phase G #1) ─────────────────────────────────────────────
  // Same auth tiers as contracts: reads open to everyone signed in, mutations
  // manager/technician. Approved COs feed the job's effective contract total
  // (finance.ts project summary).

  app.get("/api/pm/change-orders", requireAuth, (req, res) => {
    const conditions: any[] = [isNull(changeOrders.deletedAt)];
    const projectId = qstr(req.query.projectId);
    const status = qstr(req.query.status);
    if (projectId) conditions.push(eq(changeOrders.projectId, parseInt(projectId, 10)));
    if (status) conditions.push(eq(changeOrders.status, status as any));
    const rows = db.select({
      ...getTableColumns(changeOrders),
      projectName: projects.name,
    })
      .from(changeOrders)
      .leftJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(changeOrders.createdAt), desc(changeOrders.id))
      .all();
    res.json(rows);
  });

  app.post("/api/pm/change-orders", requireElevated, (req, res) => {
    let body;
    try {
      body = insertChangeOrderSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    // Logging an already-approved CO stamps approved_at, same rule as PATCH.
    const approvedAt = body.status === "approved" ? Date.now() : undefined;
    const row = db.insert(changeOrders).values({ ...body, approvedAt }).returning().get();
    audit(req, "pm.change_order_create", {
      targetType: "pm_change_order", targetId: row.id, targetName: row.title,
      details: { projectId: row.projectId, amountCents: row.amountCents },
    });
    res.status(201).json(row);
  });

  app.patch("/api/pm/change-orders/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(changeOrders)
      .where(and(eq(changeOrders.id, id), isNull(changeOrders.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Change order not found" });
    let patch;
    try {
      patch = insertChangeOrderSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    // An approved CO is money the customer signed off on — amount edits after
    // approval would silently move the job's effective contract total.
    if (patch.amountCents !== undefined && patch.amountCents !== existing.amountCents
      && existing.status === "approved") {
      return res.status(400).json({ message: "Approved change orders are locked — void it and add a new one." });
    }
    const set: Partial<typeof changeOrders.$inferInsert> = { ...patch };
    if (patch.status && patch.status !== existing.status) {
      if (patch.status === "approved") set.approvedAt = Date.now();
      audit(req, "pm.change_order_status", {
        targetType: "pm_change_order", targetId: id, targetName: existing.title,
        details: { from: existing.status, to: patch.status, amountCents: existing.amountCents },
      });
    }
    const updated = db.update(changeOrders).set(set).where(eq(changeOrders.id, id)).returning().get();
    res.json(updated);
  });

  registerSoftDelete(app, "/api/pm/change-orders/:id", requireElevated, {
    table: changeOrders, notFound: "Change order not found",
    action: "pm.change_order_delete", targetType: "pm_change_order", name: (c) => c.title, audit,
  });

  // ── Compliance documents (Phase G #4) ──────────────────────────────────────
  // ?projectId=N → that job's docs; ?company=1 → company-level (project_id
  // NULL — the owner's own COI/W-9 for sending to GCs); neither → all.

  app.get("/api/pm/documents", requireAuth, (req, res) => {
    const conditions: any[] = [isNull(pmDocuments.deletedAt)];
    const projectId = qstr(req.query.projectId);
    if (projectId) conditions.push(eq(pmDocuments.projectId, parseInt(projectId, 10)));
    else if (qstr(req.query.company)) conditions.push(isNull(pmDocuments.projectId));
    const rows = db.select({
      ...getTableColumns(pmDocuments),
      projectName: projects.name,
    })
      .from(pmDocuments)
      .leftJoin(projects, eq(pmDocuments.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(pmDocuments.createdAt), desc(pmDocuments.id))
      .all();
    res.json(rows);
  });

  app.post(
    "/api/pm/documents",
    requireElevated,
    (req, res, next) => {
      docUpload.single("file")(req, res, (err: any) => {
        if (err) return res.status(400).json({ message: err.message || "Upload rejected" });
        next();
      });
    },
    (req, res) => {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      // multipart fields arrive as strings — parse by hand.
      const kind = DOCUMENT_KINDS.includes(req.body?.kind) ? req.body.kind : "other";
      const title = String(req.body?.title ?? "").trim()
        || req.file.originalname.replace(/\.[^.]+$/, "")
        || "Document";
      const expiresAt = YMD_RE.test(String(req.body?.expiresAt ?? "")) ? req.body.expiresAt : null;
      const projectIdRaw = parseInt(String(req.body?.projectId ?? ""), 10);
      const projectId = Number.isFinite(projectIdRaw) ? projectIdRaw : null;
      const row = db.insert(pmDocuments).values({
        projectId, kind, title, expiresAt,
        filePath: req.file.filename,
      }).returning().get();
      audit(req, "pm.document_upload", {
        targetType: "pm_document", targetId: row.id, targetName: row.title,
        details: { kind: row.kind, projectId: row.projectId, expiresAt: row.expiresAt },
      });
      res.status(201).json(row);
    },
  );

  // Authed download — safe Content-Type from the stored extension, nosniff,
  // no long-lived cache (the file may hold an EIN/SSN).
  app.get("/api/pm/documents/:id/file", requireAuth, (req, res) => {
    const row = db.select().from(pmDocuments)
      .where(and(eq(pmDocuments.id, pid(req.params.id)), isNull(pmDocuments.deletedAt)))
      .get();
    if (!row) return res.status(404).json({ message: "Document not found" });
    const safeName = path.basename(row.filePath); // strips any traversal
    const ext = path.extname(safeName).toLowerCase();
    const mime = DOC_EXT_TO_MIME[ext];
    const filePath = path.join(docUploadDir, safeName);
    if (!mime || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File missing from storage" });
    }
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    const dlName = `${row.title.replace(/[^\w .-]+/g, "_")}${ext}`;
    res.setHeader("Content-Disposition", `attachment; filename="${dlName}"`);
    res.sendFile(filePath);
  });

  registerSoftDelete(app, "/api/pm/documents/:id", requireElevated, {
    table: pmDocuments, notFound: "Document not found",
    action: "pm.document_delete", targetType: "pm_document", name: (d) => d.title, audit,
  });

  // ── Knowledge base ─────────────────────────────────────────────────────────

  app.get("/api/pm/kb", requireAuth, (req, res) => {
    const conditions: any[] = [isNull(kbArticles.deletedAt)];
    const q = qstr(req.query.q);
    const category = qstr(req.query.category);
    const tag = qstr(req.query.tag);
    if (q) {
      const pat = `%${q}%`;
      conditions.push(or(like(kbArticles.title, pat), like(kbArticles.content, pat)));
    }
    if (category) conditions.push(eq(kbArticles.category, category));
    // tags is a JSON string[] column; matching the quoted token is exact
    // enough without pulling every row into JS.
    if (tag) conditions.push(like(kbArticles.tags, `%"${tag}"%`));
    const rows = db.select({
      ...getTableColumns(kbArticles),
      authorName: users.name,
    })
      .from(kbArticles)
      .leftJoin(users, eq(kbArticles.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(kbArticles.pinned), desc(kbArticles.updatedAt))
      .all();
    res.json(rows);
  });

  app.get("/api/pm/kb/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const row = db.select({
      ...getTableColumns(kbArticles),
      authorName: users.name,
    })
      .from(kbArticles)
      .leftJoin(users, eq(kbArticles.authorId, users.id))
      .where(and(eq(kbArticles.id, id), isNull(kbArticles.deletedAt)))
      .get();
    if (!row) return res.status(404).json({ message: "Article not found" });
    res.json(row);
  });

  app.post("/api/pm/kb", requireAuth, (req, res) => {
    let body;
    try {
      body = insertKbArticleSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    // Authorship is server-assigned — clients can't publish as someone else.
    const row = db.insert(kbArticles).values({ ...body, authorId: req.user!.userId }).returning().get();
    audit(req, "pm.kb_create", { targetType: "pm_kb_article", targetId: row.id, targetName: row.title });
    res.status(201).json(row);
  });

  app.patch("/api/pm/kb/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(kbArticles)
      .where(and(eq(kbArticles.id, id), isNull(kbArticles.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Article not found" });
    let patch;
    try {
      patch = insertKbArticleSchema.partial().parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }
    const updated = db.update(kbArticles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(kbArticles.id, id))
      .returning().get();
    res.json(updated);
  });

  registerSoftDelete(app, "/api/pm/kb/:id", requireElevated, {
    table: kbArticles, notFound: "Article not found",
    action: "pm.kb_delete", targetType: "pm_kb_article", name: (a) => a.title, audit,
  });
}
