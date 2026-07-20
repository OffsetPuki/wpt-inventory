import type { Express, Request } from "express";
import { z } from "zod";
import {
  eq, and, desc, isNull, isNotNull, gte, lte, sql, notInArray, getTableColumns,
} from "drizzle-orm";
import { sqlite, db } from "./storage";
import { auditQuiet as audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import { sendMail, sendOwnerMail } from "./mailer";
import { queueTaskOnce } from "./marketing";
import { expenses } from "../shared/finance-schema";
import {
  employees, payrollRuns, payslips, attendance, leaveRequests,
  jobOpenings, candidates, performanceReviews,
  insertEmployeeSchema, insertLeaveRequestSchema, insertJobOpeningSchema,
  insertCandidateSchema, insertPerformanceReviewSchema, clockSchema,
  PAYROLL_STATUSES,
  type Employee, type PayrollRun, type PayslipDeduction,
} from "../shared/hr-schema";
import {
  pid, todayLocal, elevatedRole, registerSoftDelete, registerGetById,
} from "./http-util";

// ─── HR & Payroll module ─────────────────────────────────────────────────────
// Self-contained: DDL runs at import time against the shared connection, and
// registerHrRoutes() mounts everything under /api/hr. Money is integer cents
// (salary = cents/year, hourly = cents/hour); calendar dates are TEXT
// "YYYY-MM-DD"; instants (clock in/out, decisions) are unix ms.

// ─── Table creation (synchronous DDL) ────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS hr_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Optional link to a login account: powers self-service clock in/out,
    -- "my payslips" and "my leave". NULL for staff without app access.
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

  CREATE TABLE IF NOT EXISTS hr_payroll_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    pay_date TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_payroll_runs_status ON hr_payroll_runs(status);
  CREATE INDEX IF NOT EXISTS idx_hr_payroll_runs_pay_date ON hr_payroll_runs(pay_date);
  CREATE INDEX IF NOT EXISTS idx_hr_payroll_runs_created ON hr_payroll_runs(created_at);

  CREATE TABLE IF NOT EXISTS hr_payslips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    hours_worked REAL NOT NULL DEFAULT 0,
    gross_cents INTEGER NOT NULL DEFAULT 0,
    deductions TEXT NOT NULL DEFAULT '[]',
    deductions_cents INTEGER NOT NULL DEFAULT 0,
    net_cents INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_payslips_run ON hr_payslips(run_id);
  CREATE INDEX IF NOT EXISTS idx_hr_payslips_employee ON hr_payslips(employee_id);

  CREATE TABLE IF NOT EXISTS hr_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    clock_in INTEGER NOT NULL,
    -- NULL while the shift is still open.
    clock_out INTEGER,
    clock_in_lat REAL,
    clock_in_lng REAL,
    clock_out_lat REAL,
    clock_out_lng REAL,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_attendance_employee ON hr_attendance(employee_id);
  CREATE INDEX IF NOT EXISTS idx_hr_attendance_clock_in ON hr_attendance(clock_in);
  CREATE INDEX IF NOT EXISTS idx_hr_attendance_clock_out ON hr_attendance(clock_out);

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

  CREATE TABLE IF NOT EXISTS hr_job_openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    department TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    posted_at TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    -- Soft delete: NULL = active.
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_hr_openings_status ON hr_job_openings(status);
  CREATE INDEX IF NOT EXISTS idx_hr_openings_created ON hr_job_openings(created_at);

  CREATE TABLE IF NOT EXISTS hr_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opening_id INTEGER NOT NULL REFERENCES hr_job_openings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    resume_url TEXT,
    stage TEXT NOT NULL DEFAULT 'applied',
    rating INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_candidates_opening ON hr_candidates(opening_id);
  CREATE INDEX IF NOT EXISTS idx_hr_candidates_stage ON hr_candidates(stage);
  CREATE INDEX IF NOT EXISTS idx_hr_candidates_created ON hr_candidates(created_at);

  CREATE TABLE IF NOT EXISTS hr_performance_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    period_label TEXT NOT NULL,
    overall_rating INTEGER,
    strengths TEXT,
    improvements TEXT,
    goals TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    review_date TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_hr_reviews_employee ON hr_performance_reviews(employee_id);
  CREATE INDEX IF NOT EXISTS idx_hr_reviews_status ON hr_performance_reviews(status);
  CREATE INDEX IF NOT EXISTS idx_hr_reviews_created ON hr_performance_reviews(created_at);
`);

// ─── Local helpers ───────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// `pid` (req.params → number) and `todayLocal` (local YYYY-MM-DD; payroll
// periods and pay dates are wall-clock concepts, so comparing against UTC would
// flip the answer near midnight) both live in ./http-util.

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

/** Parse a payslip's deductions JSON defensively — malformed data yields []. */
function parseDeductions(json: string | null | undefined): PayslipDeduction[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The employee row backing the signed-in user, if any. Soft-deleted employees
// don't count — a terminated + deleted profile must not keep clocking in.
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

// Currently-open shift for an employee (clock_out still NULL).
function openShiftFor(employeeId: number) {
  return db.select().from(attendance)
    .where(and(eq(attendance.employeeId, employeeId), isNull(attendance.clockOut)))
    .get();
}

// `elevatedRole` (manager|technician role check) lives in ./http-util.

// Finance bridge (wiring plan, Fix 1): marking a payroll run PAID posts one
// labor expense to the books — GROSS total, since withheld deductions are
// still labor cost. Deferred + try/catch'd: paying payroll must never fail
// or slow down over bookkeeping (same stance as the portal's accept hooks).
// `auto:payroll-run:<id>` in notes is the idempotency key.
function postPayrollExpense(req: Request, run: PayrollRun): void {
  setImmediate(() => {
    try {
      const dupe = sqlite.prepare(
        "SELECT id FROM fin_expenses WHERE deleted_at IS NULL AND notes LIKE ?",
      ).get(`%auto:payroll-run:${run.id};%`);
      if (dupe) return;
      const gross = db.select({ s: sql<number>`coalesce(sum(${payslips.grossCents}), 0)` })
        .from(payslips).where(eq(payslips.runId, run.id)).get()?.s ?? 0;
      if (gross <= 0) return; // an empty run books nothing
      const row = db.insert(expenses).values({
        date: run.payDate ?? todayLocal(),
        vendor: "Payroll",
        category: "payroll",
        amountCents: gross,
        paymentMethod: "other",
        billable: false,
        notes: `auto:payroll-run:${run.id}; — payroll ${run.periodStart} → ${run.periodEnd}`,
      }).returning().get();
      audit(req, "hr.payroll_expense_post", {
        targetType: "expense", targetId: row.id,
        targetName: `Payroll ${run.periodStart} → ${run.periodEnd}`,
        details: { runId: run.id, amountCents: gross },
      });
    } catch (e) {
      console.error("[hr] payroll→finance expense hook failed", e);
    }
  });
}

// ─── Request-body schemas (module-local; entity schemas live in hr-schema) ───

const createRunSchema = z.object({
  periodStart: z.string().regex(DATE_RE),
  periodEnd: z.string().regex(DATE_RE),
  payDate: z.string().regex(DATE_RE).optional(),
  notes: z.string().optional(),
});

const patchRunSchema = z.object({
  status: z.enum(PAYROLL_STATUSES).optional(),
  payDate: z.string().regex(DATE_RE).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const deductionSchema = z.object({
  label: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
});

const patchPayslipSchema = z.object({
  hoursWorked: z.number().nonnegative().optional(),
  grossCents: z.number().int().nonnegative().optional(),
  deductions: z.array(deductionSchema).optional(),
  notes: z.string().nullable().optional(),
});

const decideLeaveSchema = z.object({
  status: z.enum(["approved", "denied"]),
});

const patchAttendanceSchema = z.object({
  clockIn: z.number().int().positive().optional(),
  clockOut: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerHrRoutes(app: Express): void {
  // ─── Stats ────────────────────────────────────────────────────────────────

  app.get("/api/hr/stats", requireElevated, (_req, res) => {
    const count = (c: unknown): number => Number(c ?? 0);

    const activeEmployees = count(db.select({ c: sql<number>`count(*)` }).from(employees)
      .where(and(eq(employees.status, "active"), isNull(employees.deletedAt))).get()?.c);

    const clockedInNow = count(db.select({ c: sql<number>`count(*)` }).from(attendance)
      .where(isNull(attendance.clockOut)).get()?.c);

    const pendingLeave = count(db.select({ c: sql<number>`count(*)` }).from(leaveRequests)
      .where(eq(leaveRequests.status, "pending")).get()?.c);

    const openPositions = count(db.select({ c: sql<number>`count(*)` }).from(jobOpenings)
      .where(and(eq(jobOpenings.status, "open"), isNull(jobOpenings.deletedAt))).get()?.c);

    const candidatesInPipeline = count(db.select({ c: sql<number>`count(*)` }).from(candidates)
      .where(notInArray(candidates.stage, ["hired", "rejected"])).get()?.c);

    // Soonest scheduled pay date that hasn't passed yet — any run status, so a
    // draft run still shows up as "payroll coming up" on the dashboard.
    const nextPayDate = db.select({ d: sql<string | null>`min(${payrollRuns.payDate})` })
      .from(payrollRuns)
      .where(gte(payrollRuns.payDate, todayLocal()))
      .get()?.d ?? null;

    res.json({ activeEmployees, clockedInNow, pendingLeave, openPositions, candidatesInPipeline, nextPayDate });
  });

  // ─── Self-service: my employee profile ────────────────────────────────────
  // Returns null (not 404) when no profile is linked — the client uses this to
  // decide whether to render the clock in/out card at all.

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
  // five (mirrors /api/items/:id/detail).
  app.get("/api/hr/employees/:id/detail", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const employee = getEmployee(id);
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json({
      employee,
      attendance: db.select().from(attendance)
        .where(eq(attendance.employeeId, id))
        .orderBy(desc(attendance.clockIn)).limit(20).all(),
      leave: db.select().from(leaveRequests)
        .where(eq(leaveRequests.employeeId, id))
        .orderBy(desc(leaveRequests.createdAt)).all(),
      payslips: db.select({
        ...getTableColumns(payslips),
        periodStart: payrollRuns.periodStart,
        periodEnd: payrollRuns.periodEnd,
        payDate: payrollRuns.payDate,
        runStatus: payrollRuns.status,
      }).from(payslips)
        .innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id))
        .where(eq(payslips.employeeId, id))
        .orderBy(desc(payslips.id)).all(),
      reviews: db.select().from(performanceReviews)
        .where(eq(performanceReviews.employeeId, id))
        .orderBy(desc(performanceReviews.createdAt)).all(),
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

  // ─── Attendance ───────────────────────────────────────────────────────────
  // Literal segments (clock-in / clock-out / mine) registered before /:id.

  app.post("/api/hr/attendance/clock-in", requireAuth, (req, res) => {
    try {
      const body = clockSchema.parse(req.body ?? {});
      const emp = employeeForUser(req.user!.userId);
      if (!emp) return res.status(400).json({ message: "No employee profile linked to your account" });
      if (openShiftFor(emp.id)) {
        return res.status(409).json({ message: "You already have an open shift — clock out first" });
      }
      const row = db.insert(attendance).values({
        employeeId: emp.id,
        clockIn: Date.now(),
        clockInLat: body.lat ?? null,
        clockInLng: body.lng ?? null,
        notes: body.notes ?? null,
      }).returning().get();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/hr/attendance/clock-out", requireAuth, (req, res) => {
    try {
      const body = clockSchema.parse(req.body ?? {});
      const emp = employeeForUser(req.user!.userId);
      if (!emp) return res.status(400).json({ message: "No employee profile linked to your account" });
      const open = openShiftFor(emp.id);
      if (!open) return res.status(409).json({ message: "No open shift to clock out of" });
      const row = db.update(attendance).set({
        clockOut: Date.now(),
        clockOutLat: body.lat ?? null,
        clockOutLng: body.lng ?? null,
        // Only overwrite notes when the clock-out supplies some — otherwise
        // keep whatever was entered at clock-in.
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      }).where(eq(attendance.id, open.id)).returning().get();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/hr/attendance/mine", requireAuth, (req, res) => {
    const emp = employeeForUser(req.user!.userId);
    if (!emp) return res.json({ open: null, rows: [] });
    res.json({
      open: openShiftFor(emp.id) ?? null,
      rows: db.select().from(attendance)
        .where(eq(attendance.employeeId, emp.id))
        .orderBy(desc(attendance.clockIn)).limit(30).all(),
    });
  });

  app.get("/api/hr/attendance", requireElevated, (req, res) => {
    const conds = [];
    if (req.query.employeeId) conds.push(eq(attendance.employeeId, pid(req.query.employeeId as string)));
    if (typeof req.query.from === "string" && DATE_RE.test(req.query.from)) {
      conds.push(gte(attendance.clockIn, dayStartMs(req.query.from)));
    }
    if (typeof req.query.to === "string" && DATE_RE.test(req.query.to)) {
      conds.push(lte(attendance.clockIn, dayEndMs(req.query.to)));
    }
    if (req.query.open === "1") conds.push(isNull(attendance.clockOut));
    const limit = req.query.limit ? pid(req.query.limit as string) : 200;
    res.json(
      db.select({ ...getTableColumns(attendance), employeeName: employeeNameSql })
        .from(attendance)
        .innerJoin(employees, eq(attendance.employeeId, employees.id))
        .where(and(...conds))
        .orderBy(desc(attendance.clockIn))
        .limit(limit).all()
    );
  });

  // Manual correction — forgot-to-clock-out fixes, note edits. Elevated only,
  // since this is effectively editing someone's timesheet.
  app.patch("/api/hr/attendance/:id", requireElevated, (req, res) => {
    try {
      const data = patchAttendanceSchema.parse(req.body);
      const existing = db.select().from(attendance)
        .where(eq(attendance.id, pid(req.params.id)))
        .get();
      if (!existing) return res.status(404).json({ message: "Attendance record not found" });

      // Cross-field sanity on the MERGED row — a fat-fingered correction
      // (wrong day on clock-out) would otherwise store a negative shift.
      const mergedIn = data.clockIn ?? existing.clockIn;
      const mergedOut = data.clockOut === undefined ? existing.clockOut : data.clockOut;
      if (mergedOut != null && mergedOut <= mergedIn) {
        return res.status(400).json({ message: "Clock-out must be after clock-in" });
      }
      // Reopening a shift (clockOut → null) while the employee already has a
      // different open shift would leave clock-out ambiguous about which one
      // to close.
      if (existing.clockOut != null && mergedOut == null) {
        const otherOpen = db.select({ id: attendance.id }).from(attendance)
          .where(and(
            eq(attendance.employeeId, existing.employeeId),
            isNull(attendance.clockOut),
          ))
          .get();
        if (otherOpen) {
          return res.status(409).json({ message: "Employee already has an open shift — close it before reopening this one" });
        }
      }

      const row = db.update(attendance).set(data)
        .where(eq(attendance.id, existing.id))
        .returning().get();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/hr/attendance/:id", requireElevated, (req, res) => {
    const row = db.select().from(attendance).where(eq(attendance.id, pid(req.params.id))).get();
    if (!row) return res.status(404).json({ message: "Attendance record not found" });
    db.delete(attendance).where(eq(attendance.id, row.id)).run();
    res.json({ ok: true });
  });

  // ─── Leave ────────────────────────────────────────────────────────────────

  app.get("/api/hr/leave", requireAuth, (req, res) => {
    // userId (the employee's linked login) rides along so the Gantt can match
    // task assignees against approved leave (Phase D #24c).
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
    // Non-elevated users only see their own requests, via the linked profile.
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
          return res.status(403).json({ message: "You may only file leave for yourself" });
        }
      }
      const row = db.insert(leaveRequests).values(data).returning().get();
      // Notify the owner off the response path — sendOwnerMail never throws
      // and no-ops when mail isn't configured.
      const who = fullName(emp);
      setImmediate(() => {
        void sendOwnerMail({
          subject: `[CJM Suite] Leave request — ${who}`,
          text: `${who} requested ${row.type} leave ${row.startDate}–${row.endDate}.`,
        });
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/hr/leave/:id/decide", requireElevated, (req, res) => {
    try {
      const { status } = decideLeaveSchema.parse(req.body);
      const id = pid(req.params.id);
      const existing = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get();
      if (!existing) return res.status(404).json({ message: "Leave request not found" });
      const row = db.update(leaveRequests).set({
        status,
        decidedBy: req.user!.userId,
        decidedAt: Date.now(),
      }).where(eq(leaveRequests.id, id)).returning().get()!;
      audit(req, "hr.leave_decide", {
        targetType: "leave_request", targetId: id,
        details: { status, employeeId: existing.employeeId, type: existing.type },
      });
      // Tell the employee — skipped silently when they have no email on file.
      const emp = getEmployee(existing.employeeId);
      if (emp?.email) {
        const { email, firstName } = emp;
        setImmediate(() => {
          void sendMail({
            to: email,
            subject: `Your leave request was ${status} — CJM Metals`,
            text: `Hi ${firstName},\n\nYour ${existing.type} leave request for ${existing.startDate}–${existing.endDate} was ${status}.`,
          });
        });
      }
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Withdraw: elevated can delete anything; a worker only their own request
  // and only while it's still pending (approved leave is a payroll fact).
  app.delete("/api/hr/leave/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const row = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get();
    if (!row) return res.status(404).json({ message: "Leave request not found" });
    if (!elevatedRole(req)) {
      const mine = employeeForUser(req.user!.userId);
      if (!mine || mine.id !== row.employeeId || row.status !== "pending") {
        return res.status(403).json({ message: "You may only withdraw your own pending requests" });
      }
    }
    db.delete(leaveRequests).where(eq(leaveRequests.id, id)).run();
    res.json({ ok: true });
  });

  // ─── Payroll ──────────────────────────────────────────────────────────────

  app.get("/api/hr/payroll/runs", requireElevated, (_req, res) => {
    res.json(
      db.select({
        ...getTableColumns(payrollRuns),
        payslipCount: sql<number>`count(${payslips.id})`,
        grossTotalCents: sql<number>`coalesce(sum(${payslips.grossCents}), 0)`,
        deductionsTotalCents: sql<number>`coalesce(sum(${payslips.deductionsCents}), 0)`,
        netTotalCents: sql<number>`coalesce(sum(${payslips.netCents}), 0)`,
      }).from(payrollRuns)
        .leftJoin(payslips, eq(payslips.runId, payrollRuns.id))
        .groupBy(payrollRuns.id)
        .orderBy(desc(payrollRuns.id)).all()
    );
  });

  // Creates the run AND generates a payslip per active employee in one
  // transaction — a half-generated run would be worse than no run.
  app.post("/api/hr/payroll/runs", requireElevated, (req, res) => {
    try {
      const body = createRunSchema.parse(req.body);
      const startMs = dayStartMs(body.periodStart);
      const endMs = dayEndMs(body.periodEnd);
      if (endMs < startMs) {
        return res.status(400).json({ message: "periodEnd must be on or after periodStart" });
      }
      // Reject overlapping periods: two runs covering the same dates would
      // double-count hours and post two labor expenses. Dates are
      // "YYYY-MM-DD", so a lexicographic compare == chronological compare;
      // ranges overlap when each start is on/before the other's end.
      const overlap = db.select({ id: payrollRuns.id }).from(payrollRuns)
        .where(and(
          lte(payrollRuns.periodStart, body.periodEnd),
          gte(payrollRuns.periodEnd, body.periodStart),
        )).get();
      if (overlap) {
        return res.status(409).json({ message: "A payroll run already covers part of this period — periods may not overlap" });
      }

      const result = db.transaction((tx) => {
        const run = tx.insert(payrollRuns).values({
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          payDate: body.payDate ?? null,
          notes: body.notes ?? null,
        }).returning().get();

        const active = tx.select().from(employees)
          .where(and(eq(employees.status, "active"), isNull(employees.deletedAt)))
          .all();

        const slips = active.map((emp) => {
          let hoursWorked = 0;
          let grossCents = 0;
          if (emp.payType === "hourly") {
            // Only CLOSED shifts count (an open shift has no duration yet);
            // a shift is billed to the period its clock-OUT falls into. That
            // way a shift left open when an earlier run generated isn't lost:
            // it's captured by the run covering its clock-out, and counted
            // exactly once (never by two adjacent periods).
            const shifts = tx.select().from(attendance).where(and(
              eq(attendance.employeeId, emp.id),
              isNotNull(attendance.clockOut),
              gte(attendance.clockOut, startMs),
              lte(attendance.clockOut, endMs),
            )).all();
            const hours = shifts.reduce((s, r) => s + (r.clockOut! - r.clockIn) / MS_PER_HOUR, 0);
            hoursWorked = Math.round(hours * 100) / 100;
            grossCents = Math.round(hoursWorked * emp.payRateCents);
          } else {
            // Salary is cents/year — pro-rate by the calendar days the
            // employee was actually active in the period, clamping the day
            // range to their [hireDate .. endDate] window. Missing hireDate
            // ⇒ active from the period start; missing endDate ⇒ active
            // through the period end (this reproduces the full-period default).
            let activeStartMs = startMs;
            let activeEndMs = dayStartMs(body.periodEnd);
            if (emp.hireDate && DATE_RE.test(emp.hireDate)) {
              activeStartMs = Math.max(activeStartMs, dayStartMs(emp.hireDate));
            }
            if (emp.endDate && DATE_RE.test(emp.endDate)) {
              activeEndMs = Math.min(activeEndMs, dayStartMs(emp.endDate));
            }
            // Inclusive day count: 1st..15th = 15 days. Round handles DST edges.
            const activeDays = activeEndMs >= activeStartMs
              ? Math.round((activeEndMs - activeStartMs) / MS_PER_DAY) + 1
              : 0;
            grossCents = Math.round((emp.payRateCents * activeDays) / 365);
          }
          return tx.insert(payslips).values({
            runId: run.id,
            employeeId: emp.id,
            hoursWorked,
            grossCents,
            deductions: "[]",
            deductionsCents: 0,
            netCents: grossCents,
          }).returning().get();
        });

        return { run, payslips: slips };
      });

      audit(req, "hr.payroll_run_create", {
        targetType: "payroll_run", targetId: result.run.id,
        targetName: `${body.periodStart} → ${body.periodEnd}`,
        details: { payslips: result.payslips.length },
      });
      res.status(201).json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/hr/payroll/runs/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const run = db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).get();
    if (!run) return res.status(404).json({ message: "Payroll run not found" });
    const slips = db.select({
      ...getTableColumns(payslips),
      employeeName: employeeNameSql,
      userId: employees.userId,
    })
      .from(payslips)
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(eq(payslips.runId, id))
      .orderBy(employees.lastName, employees.firstName).all();

    // Fix 5 (wiring plan): PM-logged minutes for the same period, joined via
    // the employee's login account — lets the run view flag when the shop
    // clock (attendance) and the job clock (PM time) tell different stories.
    // pm_time_entries belongs to the PM module → raw SQL + try/catch; absent
    // module degrades to pmMinutes: null (UI hides the comparison).
    const startMs = dayStartMs(run.periodStart);
    const endMs = dayEndMs(run.periodEnd);
    // `any`: sqlite.prepare's overload resolution pins a 1-tuple bind type here.
    let pmStmt: any = null;
    try {
      pmStmt = sqlite.prepare(
        `SELECT COALESCE(SUM(duration_min), 0) AS m FROM pm_time_entries
         WHERE user_id = ? AND ended_at IS NOT NULL AND started_at >= ? AND started_at <= ?`,
      );
    } catch { /* pm module absent */ }
    res.json({
      run,
      payslips: slips.map((s) => {
        let pmMinutes: number | null = null;
        if (pmStmt && s.userId != null) {
          try {
            pmMinutes = (pmStmt.get(s.userId, startMs, endMs) as { m: number }).m;
          } catch { /* best-effort */ }
        }
        return { ...s, pmMinutes };
      }),
    });
  });

  app.patch("/api/hr/payroll/runs/:id", requireElevated, (req, res) => {
    try {
      const body = patchRunSchema.parse(req.body);
      const id = pid(req.params.id);
      const run = db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).get();
      if (!run) return res.status(404).json({ message: "Payroll run not found" });

      // Status only walks forward: draft → approved → paid. No skipping, no
      // un-approving — reversing a paid run means creating a correcting run.
      if (body.status !== undefined && body.status !== run.status) {
        const allowed = run.status === "draft" ? "approved" : run.status === "approved" ? "paid" : null;
        if (body.status !== allowed) {
          return res.status(400).json({ message: `Cannot move a ${run.status} run to ${body.status}` });
        }
      }

      const row = db.update(payrollRuns).set(body).where(eq(payrollRuns.id, id)).returning().get()!;
      if (body.status !== undefined && body.status !== run.status) {
        audit(req, body.status === "approved" ? "hr.payroll_run_approve" : "hr.payroll_run_paid", {
          targetType: "payroll_run", targetId: id,
          targetName: `${run.periodStart} → ${run.periodEnd}`,
          details: { from: run.status, to: body.status },
        });
        if (body.status === "paid") postPayrollExpense(req, row);
      }
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/hr/payroll/runs/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const run = db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).get();
    if (!run) return res.status(404).json({ message: "Payroll run not found" });
    if (run.status !== "draft") {
      return res.status(400).json({ message: "Only draft runs can be deleted" });
    }
    // Explicit cascade — don't rely on the FK pragma being on for this delete.
    db.transaction((tx) => {
      tx.delete(payslips).where(eq(payslips.runId, id)).run();
      tx.delete(payrollRuns).where(eq(payrollRuns.id, id)).run();
    });
    audit(req, "hr.payroll_run_delete", {
      targetType: "payroll_run", targetId: id,
      targetName: `${run.periodStart} → ${run.periodEnd}`,
    });
    res.json({ ok: true });
  });

  // ─── Payslips ────────────────────────────────────────────────────────────
  // /mine must precede /:id so the literal segment isn't captured as an id.

  app.get("/api/hr/payslips/mine", requireAuth, (req, res) => {
    const emp = employeeForUser(req.user!.userId);
    if (!emp) return res.json([]);
    res.json(
      db.select({
        ...getTableColumns(payslips),
        periodStart: payrollRuns.periodStart,
        periodEnd: payrollRuns.periodEnd,
        payDate: payrollRuns.payDate,
        runStatus: payrollRuns.status,
      }).from(payslips)
        .innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id))
        .where(eq(payslips.employeeId, emp.id))
        .orderBy(desc(payslips.id)).all()
    );
  });

  app.patch("/api/hr/payslips/:id", requireElevated, (req, res) => {
    try {
      const body = patchPayslipSchema.parse(req.body);
      const id = pid(req.params.id);
      const slip = db.select().from(payslips).where(eq(payslips.id, id)).get();
      if (!slip) return res.status(404).json({ message: "Payslip not found" });

      // Paid runs are locked — the Finance expense posted at pay time reflects
      // these slips exactly; editing after the fact would desync the books.
      // Corrections go through a new correcting run (same rule as un-paying).
      const run = db.select().from(payrollRuns).where(eq(payrollRuns.id, slip.runId)).get();
      if (run?.status === "paid") {
        return res.status(400).json({
          message: "This run is already paid — payslips are locked. Create a correcting run instead.",
        });
      }

      // Server recomputes the derived money columns — the client never sends
      // deductionsCents/netCents, so they can't drift from the JSON.
      const deductions = body.deductions ?? parseDeductions(slip.deductions);
      const grossCents = body.grossCents ?? slip.grossCents;
      const deductionsCents = deductions.reduce((s, d) => s + d.amountCents, 0);

      const row = db.update(payslips).set({
        hoursWorked: body.hoursWorked ?? slip.hoursWorked,
        grossCents,
        deductions: JSON.stringify(deductions),
        deductionsCents,
        netCents: grossCents - deductionsCents,
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      }).where(eq(payslips.id, id)).returning().get()!;
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ─── Recruitment: openings ───────────────────────────────────────────────

  app.get("/api/hr/openings", requireElevated, (_req, res) => {
    res.json(
      db.select({
        ...getTableColumns(jobOpenings),
        candidateCount: sql<number>`count(${candidates.id})`,
      }).from(jobOpenings)
        .leftJoin(candidates, eq(candidates.openingId, jobOpenings.id))
        .where(isNull(jobOpenings.deletedAt))
        .groupBy(jobOpenings.id)
        .orderBy(desc(jobOpenings.id)).all()
    );
  });

  app.post("/api/hr/openings", requireElevated, (req, res) => {
    try {
      const data = insertJobOpeningSchema.parse(req.body);
      const row = db.insert(jobOpenings).values(data).returning().get();
      audit(req, "hr.opening_create", {
        targetType: "job_opening", targetId: row.id, targetName: row.title,
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  registerGetById(app, "/api/hr/openings/:id", requireElevated, jobOpenings, "Job opening not found");

  app.patch("/api/hr/openings/:id", requireElevated, (req, res) => {
    try {
      const data = insertJobOpeningSchema.partial().parse(req.body);
      const row = db.update(jobOpenings).set(data)
        .where(and(eq(jobOpenings.id, pid(req.params.id)), isNull(jobOpenings.deletedAt)))
        .returning().get();
      if (!row) return res.status(404).json({ message: "Job opening not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  registerSoftDelete(app, "/api/hr/openings/:id", requireElevated, {
    table: jobOpenings, notFound: "Job opening not found",
    action: "hr.opening_delete", targetType: "job_opening",
    name: (o) => o.title, audit,
  });

  // ─── Recruitment: candidates ─────────────────────────────────────────────

  app.get("/api/hr/candidates", requireElevated, (req, res) => {
    const conds = [];
    if (req.query.openingId) conds.push(eq(candidates.openingId, pid(req.query.openingId as string)));
    if (typeof req.query.stage === "string" && req.query.stage) {
      conds.push(eq(candidates.stage, req.query.stage as (typeof candidates.$inferSelect)["stage"]));
    }
    res.json(
      db.select().from(candidates).where(and(...conds))
        .orderBy(desc(candidates.createdAt)).all()
    );
  });

  app.post("/api/hr/candidates", requireElevated, (req, res) => {
    try {
      const data = insertCandidateSchema.parse(req.body);
      const row = db.insert(candidates).values(data).returning().get();
      audit(req, "hr.candidate_create", {
        targetType: "candidate", targetId: row.id, targetName: row.name,
        details: { openingId: row.openingId },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/hr/candidates/:id", requireElevated, (req, res) => {
    const row = db.select().from(candidates).where(eq(candidates.id, pid(req.params.id))).get();
    if (!row) return res.status(404).json({ message: "Candidate not found" });
    res.json(row);
  });

  app.patch("/api/hr/candidates/:id", requireElevated, (req, res) => {
    try {
      const data = insertCandidateSchema.partial().parse(req.body);
      const id = pid(req.params.id);
      const before = db.select().from(candidates).where(eq(candidates.id, id)).get();
      if (!before) return res.status(404).json({ message: "Candidate not found" });
      const row = db.update(candidates).set(data).where(eq(candidates.id, id)).returning().get()!;
      // Stage moves are the ATS's status transitions — worth a forensic trail
      // (e.g. who moved someone to "offer").
      if (data.stage && data.stage !== before.stage) {
        audit(req, "hr.candidate_stage", {
          targetType: "candidate", targetId: id, targetName: row.name,
          details: { from: before.stage, to: data.stage },
        });
        // Hired → queue the onboarding follow-up (deduped by open task title).
        if (data.stage === "hired") {
          queueTaskOnce(`Onboard ${row.name}: create employee record, link login`);
        }
      }
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/hr/candidates/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(candidates).where(eq(candidates.id, id)).get();
    if (!target) return res.status(404).json({ message: "Candidate not found" });
    db.delete(candidates).where(eq(candidates.id, id)).run();
    audit(req, "hr.candidate_delete", {
      targetType: "candidate", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
  });

  // ─── Performance reviews ─────────────────────────────────────────────────

  app.get("/api/hr/reviews", requireElevated, (req, res) => {
    const conds = [];
    if (req.query.employeeId) {
      conds.push(eq(performanceReviews.employeeId, pid(req.query.employeeId as string)));
    }
    if (typeof req.query.status === "string" && req.query.status) {
      conds.push(eq(performanceReviews.status, req.query.status as "draft" | "final"));
    }
    res.json(
      db.select({ ...getTableColumns(performanceReviews), employeeName: employeeNameSql })
        .from(performanceReviews)
        .innerJoin(employees, eq(performanceReviews.employeeId, employees.id))
        .where(and(...conds))
        .orderBy(desc(performanceReviews.createdAt)).all()
    );
  });

  app.post("/api/hr/reviews", requireElevated, (req, res) => {
    try {
      const data = insertPerformanceReviewSchema.parse(req.body);
      if (!getEmployee(data.employeeId)) {
        return res.status(400).json({ message: "Employee not found" });
      }
      const row = db.insert(performanceReviews).values(data).returning().get();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/hr/reviews/:id", requireElevated, (req, res) => {
    const row = db.select().from(performanceReviews)
      .where(eq(performanceReviews.id, pid(req.params.id))).get();
    if (!row) return res.status(404).json({ message: "Review not found" });
    res.json(row);
  });

  app.patch("/api/hr/reviews/:id", requireElevated, (req, res) => {
    try {
      const data = insertPerformanceReviewSchema.partial().parse(req.body);
      const id = pid(req.params.id);
      const before = db.select().from(performanceReviews)
        .where(eq(performanceReviews.id, id)).get();
      if (!before) return res.status(404).json({ message: "Review not found" });
      const row = db.update(performanceReviews).set(data)
        .where(eq(performanceReviews.id, id)).returning().get()!;
      // Finalizing a review is the transition that matters — it becomes part
      // of the employee's record.
      if (data.status === "final" && before.status !== "final") {
        audit(req, "hr.review_finalize", {
          targetType: "performance_review", targetId: id, targetName: row.periodLabel,
          details: { employeeId: row.employeeId, overallRating: row.overallRating },
        });
      }
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/hr/reviews/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(performanceReviews)
      .where(eq(performanceReviews.id, id)).get();
    if (!target) return res.status(404).json({ message: "Review not found" });
    db.delete(performanceReviews).where(eq(performanceReviews.id, id)).run();
    res.json({ ok: true });
  });
}
