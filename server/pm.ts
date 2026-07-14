import type { Express, Request } from "express";
import { z } from "zod";
import { eq, and, or, desc, asc, isNull, like, gte, lt, sql, getTableColumns } from "drizzle-orm";
import { sqlite, db } from "./storage";
import { auditQuiet as audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import { users, projects } from "../shared/schema";
import {
  pmTasks, timeEntries, timesheets, contracts, kbArticles,
  insertPmTaskSchema, insertTimeEntrySchema, insertContractSchema, insertKbArticleSchema,
  TASK_STATUSES,
} from "../shared/pm-schema";
import { clients } from "../shared/crm-schema";

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

// ─── Request helpers ─────────────────────────────────────────────────────────

/** Express types req.query values loosely; narrow to a non-empty string. */
function qstr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isElevated(req: Request): boolean {
  const role = req.user?.role;
  return role === "manager" || role === "technician";
}

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
  // Express types req.params.* as string | string[]; narrow to number.
  const pid = (v: string | string[]): number => parseInt(v as string, 10);

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

  app.delete("/api/pm/tasks/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(pmTasks)
      .where(and(eq(pmTasks.id, id), isNull(pmTasks.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Task not found" });
    db.update(pmTasks).set({ deletedAt: Date.now() }).where(eq(pmTasks.id, id)).run();
    audit(req, "pm.task_delete", { targetType: "pm_task", targetId: id, targetName: existing.title });
    res.json({ ok: true });
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

  app.delete("/api/pm/contracts/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(contracts)
      .where(and(eq(contracts.id, id), isNull(contracts.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Contract not found" });
    db.update(contracts).set({ deletedAt: Date.now() }).where(eq(contracts.id, id)).run();
    audit(req, "pm.contract_delete", { targetType: "pm_contract", targetId: id, targetName: existing.title });
    res.json({ ok: true });
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

  app.delete("/api/pm/kb/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(kbArticles)
      .where(and(eq(kbArticles.id, id), isNull(kbArticles.deletedAt))).get();
    if (!existing) return res.status(404).json({ message: "Article not found" });
    db.update(kbArticles).set({ deletedAt: Date.now() }).where(eq(kbArticles.id, id)).run();
    audit(req, "pm.kb_delete", { targetType: "pm_kb_article", targetId: id, targetName: existing.title });
    res.json({ ok: true });
  });
}
