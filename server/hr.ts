import type { Express } from "express";
import { z } from "zod";
import { eq, and, desc, isNull, sql, getTableColumns } from "drizzle-orm";
import { sqlite, db } from "./storage";
import { auditQuiet as audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import { expenses } from "../shared/finance-schema";
import {
  employees, leaveRequests,
  insertEmployeeSchema, insertLeaveRequestSchema,
  type Employee,
} from "../shared/hr-schema";
import {
  pid, todayLocal, elevatedRole, registerSoftDelete,
} from "./http-util";

// ─── HR module ───────────────────────────────────────────────────────────────
// Self-contained: DDL runs at import time against the shared connection, and
// registerHrRoutes() mounts everything under /api/hr. Money is integer cents
// (salary = cents/year, hourly = cents/hour); calendar dates are TEXT
// "YYYY-MM-DD". Hours come from pm_time_entries — the one clock.

// ─── Table creation (synchronous DDL) ────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS hr_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Optional link to a login account: joins this employee to their
    -- pm_time_entries hours and "my time off". NULL for staff without access.
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    job_title TEXT,
    department TEXT,
    employment_type TEXT NOT NULL DEFAULT 'full_time',
    status TEXT NOT NULL DEFAULT 'active',
    hire_date TEXT,
    end_date TEXT,
    pay_type TEXT NOT NULL DEFAULT 'hourly',
    -- salary -> cents per year; hourly -> cents per hour.
    pay_rate_cents INTEGER NOT NULL DEFAULT 0,
    emergency_contact TEXT,
    photo_url TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    -- Soft delete: NULL = active.
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_hr_employees_user ON hr_employees(user_id);
  CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON hr_employees(status);
  CREATE INDEX IF NOT EXISTS idx_hr_employees_department ON hr_employees(department);
  CREATE INDEX IF NOT EXISTS idx_hr_employees_created ON hr_employees(created_at);

  CREATE TABLE IF NOT EXISTS hr_leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'vacation',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL DEFAULT 1,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_leave_employee ON hr_leave_requests(employee_id);
  CREATE INDEX IF NOT EXISTS idx_hr_leave_status ON hr_leave_requests(status);
  CREATE INDEX IF NOT EXISTS idx_hr_leave_created ON hr_leave_requests(created_at);
`);

// One-time: the approve/deny workflow is gone — time off filed is fact, so
// anything still "pending" from the old world counts as approved.
try {
  sqlite.exec("UPDATE hr_leave_requests SET status = 'approved' WHERE status = 'pending'");
} catch {
  /* best-effort */
}

// ─── Local helpers ───────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

// `pid` (req.params → number) and `todayLocal` (local YYYY-MM-DD; payroll
// periods are wall-clock concepts, so comparing against UTC would flip the
// answer near midnight) both live in ./http-util.

// "YYYY-MM-DD" → unix ms at local midnight (start) / end-of-day (end).
// Returns NaN on garbage input so callers can just skip the filter.
function dayStartMs(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}
function dayEndMs(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}

function fullName(e: Pick<Employee, "firstName" | "lastName">): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

// SQL fragment used wherever a list row needs the employee's display name.
const employeeNameSql = sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`;

// The employee row backing the signed-in user, if any. Soft-deleted employees
// don't count.
function employeeForUser(userId: number): Employee | undefined {
  return db.select().from(employees)
    .where(and(eq(employees.userId, userId), isNull(employees.deletedAt)))
    .get();
}

function getEmployee(id: number): Employee | undefined {
  return db.select().from(employees)
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    .get();
}

// `elevatedRole` (manager|technician role check) lives in ./http-util.

// ─── Request-body schemas (module-local; entity schemas live in hr-schema) ───

const recordExpenseSchema = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
  amountCents: z.number().int().positive(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerHrRoutes(app: Express): void {
  // ─── Stats ────────────────────────────────────────────────────────────────

  app.get("/api/hr/stats", requireElevated, (_req, res) => {
    const count = (c: unknown): number => Number(c ?? 0);

    const activeEmployees = count(db.select({ c: sql<number>`count(*)` }).from(employees)
      .where(and(eq(employees.status, "active"), isNull(employees.deletedAt))).get()?.c);

    // Running PM timers — the one clock. pm module owns that table, so raw
    // SQL + try/catch; absent module degrades to 0.
    let clockedInNow = 0;
    try {
      clockedInNow = count((sqlite.prepare(
        "SELECT count(*) AS c FROM pm_time_entries WHERE ended_at IS NULL",
      ).get() as { c: number } | undefined)?.c);
    } catch { /* pm module absent */ }

    res.json({ activeEmployees, clockedInNow });
  });

  // ─── Self-service: my employee profile ────────────────────────────────────
  // Returns null (not 404) when no profile is linked — the client uses this to
  // decide whether self-service forms can be filed at all.

  app.get("/api/hr/me", requireAuth, (req, res) => {
    const me = employeeForUser(req.user!.userId);
    if (!me) return res.json(null);
    // Every other hr_employees read is elevated-only; `notes` is where
    // managers keep private remarks, so it never rides along on the
    // self-service endpoint.
    const { notes, ...publicMe } = me;
    res.json(publicMe);
  });

  // ─── Employees ────────────────────────────────────────────────────────────

  app.get("/api/hr/employees", requireElevated, (req, res) => {
    const conds = [isNull(employees.deletedAt)];
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q) {
      const term = `%${q.toLowerCase()}%`;
      conds.push(sql`(
        lower(${employees.firstName} || ' ' || ${employees.lastName}) LIKE ${term}
        OR lower(coalesce(${employees.email}, '')) LIKE ${term}
        OR lower(coalesce(${employees.jobTitle}, '')) LIKE ${term}
      )`);
    }
    if (typeof req.query.department === "string" && req.query.department) {
      conds.push(eq(employees.department, req.query.department));
    }
    if (typeof req.query.status === "string" && req.query.status) {
      conds.push(eq(employees.status, req.query.status as Employee["status"]));
    }
    res.json(
      db.select().from(employees).where(and(...conds))
        .orderBy(employees.lastName, employees.firstName).all()
    );
  });

  app.post("/api/hr/employees", requireElevated, (req, res) => {
    try {
      const data = insertEmployeeSchema.parse(req.body);
      const row = db.insert(employees).values(data).returning().get();
      audit(req, "hr.employee_create", {
        targetType: "employee", targetId: row.id, targetName: fullName(row),
        details: { department: row.department, payType: row.payType },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Combined detail payload: one round-trip for the employee page instead of
  // two (mirrors /api/items/:id/detail).
  app.get("/api/hr/employees/:id/detail", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const employee = getEmployee(id);
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json({
      employee,
      leave: db.select().from(leaveRequests)
        .where(eq(leaveRequests.employeeId, id))
        .orderBy(desc(leaveRequests.createdAt)).all(),
    });
  });

  app.get("/api/hr/employees/:id", requireElevated, (req, res) => {
    const employee = getEmployee(pid(req.params.id));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  });

  app.patch("/api/hr/employees/:id", requireElevated, (req, res) => {
    try {
      const data = insertEmployeeSchema.partial().parse(req.body);
      const row = db.update(employees).set(data)
        .where(and(eq(employees.id, pid(req.params.id)), isNull(employees.deletedAt)))
        .returning().get();
      if (!row) return res.status(404).json({ message: "Employee not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  registerSoftDelete(app, "/api/hr/employees/:id", requireElevated, {
    table: employees, notFound: "Employee not found",
    action: "hr.employee_delete", targetType: "employee",
    name: (e) => fullName(e), audit,
  });

  // ─── Time off ─────────────────────────────────────────────────────────────
  // A plain list — filed time off is fact, not a request. Rows insert as
  // "approved" so the Schedule/Gantt leave-clash markers (which filter on
  // status "approved") keep working unchanged.

  app.get("/api/hr/leave", requireAuth, (req, res) => {
    // userId (the employee's linked login) rides along so the Gantt can match
    // task assignees against time off (Phase D #24c).
    if (elevatedRole(req)) {
      return res.json(
        db.select({
          ...getTableColumns(leaveRequests),
          employeeName: employeeNameSql,
          userId: employees.userId,
        })
          .from(leaveRequests)
          .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
          .orderBy(desc(leaveRequests.createdAt)).all()
      );
    }
    // Non-elevated users only see their own entries, via the linked profile.
    const emp = employeeForUser(req.user!.userId);
    if (!emp) return res.json([]);
    res.json(
      db.select().from(leaveRequests)
        .where(eq(leaveRequests.employeeId, emp.id))
        .orderBy(desc(leaveRequests.createdAt)).all()
        .map((r) => ({ ...r, userId: req.user!.userId }))
    );
  });

  app.post("/api/hr/leave", requireAuth, (req, res) => {
    try {
      const data = insertLeaveRequestSchema.parse(req.body);
      const emp = getEmployee(data.employeeId);
      if (!emp) {
        return res.status(400).json({ message: "Employee not found" });
      }
      // Workers may only file for themselves; managers can file for anyone.
      if (!elevatedRole(req)) {
        const mine = employeeForUser(req.user!.userId);
        if (!mine || mine.id !== data.employeeId) {
          return res.status(403).json({ message: "You may only file time off for yourself" });
        }
      }
      const row = db.insert(leaveRequests).values({ ...data, status: "approved" })
        .returning().get();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Elevated can delete anything; a worker only their own entries.
  app.delete("/api/hr/leave/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const row = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get();
    if (!row) return res.status(404).json({ message: "Time off entry not found" });
    if (!elevatedRole(req)) {
      const mine = employeeForUser(req.user!.userId);
      if (!mine || mine.id !== row.employeeId) {
        return res.status(403).json({ message: "You may only delete your own time off" });
      }
    }
    db.delete(leaveRequests).where(eq(leaveRequests.id, id)).run();
    res.json({ ok: true });
  });

  // ─── Payroll ──────────────────────────────────────────────────────────────
  // No runs, no payslips — an hours×rate summary over pm_time_entries plus a
  // one-click "record as expense". Cutting the check happens at the bank.

  app.get("/api/hr/payroll/summary", requireElevated, (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ message: "from and to must be YYYY-MM-DD" });
    }
    const startMs = dayStartMs(from);
    const endMs = dayEndMs(to);
    if (endMs < startMs) {
      return res.status(400).json({ message: "to must be on or after from" });
    }

    const active = db.select().from(employees)
      .where(and(eq(employees.status, "active"), isNull(employees.deletedAt)))
      .orderBy(employees.lastName, employees.firstName).all();

    // pm module owns pm_time_entries → raw SQL + try/catch; absent module
    // degrades to 0 hours.
    let minutesStmt: any = null;
    try {
      minutesStmt = sqlite.prepare(
        `SELECT COALESCE(SUM(duration_min), 0) AS m FROM pm_time_entries
         WHERE user_id = ? AND ended_at IS NOT NULL AND started_at >= ? AND started_at <= ?`,
      );
    } catch { /* pm module absent */ }

    // Inclusive calendar days in the range, for pro-rating salaries
    // (cents/year ÷ 365). Round handles DST edges.
    const days = Math.round((dayStartMs(to) - startMs) / MS_PER_DAY) + 1;

    res.json(active.map((e) => {
      let hours = 0;
      if (minutesStmt && e.userId != null) {
        try {
          const min = (minutesStmt.get(e.userId, startMs, endMs) as { m: number }).m;
          hours = Math.round((min / 60) * 100) / 100;
        } catch { /* best-effort */ }
      }
      const grossCents = e.payType === "hourly"
        ? Math.round(hours * e.payRateCents)
        : Math.round((e.payRateCents * days) / 365);
      return {
        employeeId: e.id,
        name: fullName(e),
        payType: e.payType,
        payRateCents: e.payRateCents,
        hours,
        grossCents,
        linkedLogin: e.userId != null,
      };
    }));
  });

  // Books the period's labor as one Finance expense. `auto:payroll:<from>:<to>`
  // in notes is the idempotency key — same period twice gets a 409.
  app.post("/api/hr/payroll/record-expense", requireElevated, (req, res) => {
    try {
      const body = recordExpenseSchema.parse(req.body);
      const key = `auto:payroll:${body.from}:${body.to}`;
      const dupe = sqlite.prepare(
        "SELECT id FROM fin_expenses WHERE deleted_at IS NULL AND notes LIKE ?",
      ).get(`${key}%`);
      if (dupe) {
        return res.status(409).json({
          message: `Payroll for ${body.from} → ${body.to} is already on the books`,
        });
      }
      const row = db.insert(expenses).values({
        date: todayLocal(),
        vendor: "Payroll",
        category: "payroll",
        amountCents: body.amountCents,
        paymentMethod: "other",
        billable: false,
        notes: `${key} — labor`,
      }).returning().get();
      audit(req, "hr.payroll_expense_post", {
        targetType: "expense", targetId: row.id,
        targetName: `Payroll ${body.from} → ${body.to}`,
        details: { amountCents: body.amountCents },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
}
