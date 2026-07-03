import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./schema";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_STATUSES = ["active", "on_leave", "terminated"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const PAY_TYPES = ["salary", "hourly"] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const PAYROLL_STATUSES = ["draft", "approved", "paid"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const LEAVE_TYPES = ["vacation", "sick", "personal", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["pending", "approved", "denied"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const OPENING_STATUSES = ["open", "on_hold", "closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

// ATS pipeline for candidates.
export const CANDIDATE_STAGES = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export const REVIEW_STATUSES = ["draft", "final"] as const;
export type PerfReviewStatus = (typeof REVIEW_STATUSES)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

export const employees = sqliteTable("hr_employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Optional link to a login account — lets attendance / timesheets know
  // which employee a signed-in user is.
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  jobTitle: text("job_title"),
  department: text("department"),
  employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES })
    .notNull()
    .default("full_time"),
  status: text("status", { enum: EMPLOYEE_STATUSES }).notNull().default("active"),
  hireDate: text("hire_date"), // "YYYY-MM-DD"
  endDate: text("end_date"), // "YYYY-MM-DD"
  payType: text("pay_type", { enum: PAY_TYPES }).notNull().default("hourly"),
  // salary → cents per year; hourly → cents per hour.
  payRateCents: integer("pay_rate_cents").notNull().default(0),
  emergencyContact: text("emergency_contact"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const payrollRuns = sqliteTable("hr_payroll_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodStart: text("period_start").notNull(), // "YYYY-MM-DD"
  periodEnd: text("period_end").notNull(), // "YYYY-MM-DD"
  payDate: text("pay_date"), // "YYYY-MM-DD"
  status: text("status", { enum: PAYROLL_STATUSES }).notNull().default("draft"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const payslips = sqliteTable("hr_payslips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  hoursWorked: real("hours_worked").notNull().default(0), // hourly employees
  grossCents: integer("gross_cents").notNull().default(0),
  deductions: text("deductions").notNull().default("[]"), // JSON {label, amountCents}[]
  deductionsCents: integer("deductions_cents").notNull().default(0),
  netCents: integer("net_cents").notNull().default(0),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const attendance = sqliteTable("hr_attendance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  clockIn: integer("clock_in").notNull(), // unix ms
  clockOut: integer("clock_out"), // unix ms, null while shift is open
  clockInLat: real("clock_in_lat"),
  clockInLng: real("clock_in_lng"),
  clockOutLat: real("clock_out_lat"),
  clockOutLng: real("clock_out_lng"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const leaveRequests = sqliteTable("hr_leave_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  type: text("type", { enum: LEAVE_TYPES }).notNull().default("vacation"),
  startDate: text("start_date").notNull(), // "YYYY-MM-DD"
  endDate: text("end_date").notNull(), // "YYYY-MM-DD"
  days: real("days").notNull().default(1), // supports half-days
  reason: text("reason"),
  status: text("status", { enum: LEAVE_STATUSES }).notNull().default("pending"),
  decidedBy: integer("decided_by").references(() => users.id, {
    onDelete: "set null",
  }),
  decidedAt: integer("decided_at"), // unix ms
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const jobOpenings = sqliteTable("hr_job_openings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  department: text("department"),
  description: text("description"),
  status: text("status", { enum: OPENING_STATUSES }).notNull().default("open"),
  postedAt: text("posted_at"), // "YYYY-MM-DD"
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at"),
});

export const candidates = sqliteTable("hr_candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openingId: integer("opening_id")
    .notNull()
    .references(() => jobOpenings.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  resumeUrl: text("resume_url"),
  stage: text("stage", { enum: CANDIDATE_STAGES }).notNull().default("applied"),
  rating: integer("rating"), // 1–5
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const performanceReviews = sqliteTable("hr_performance_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id").references(() => users.id, {
    onDelete: "set null",
  }),
  periodLabel: text("period_label").notNull(), // "H1 2026", "Q3 2026", …
  overallRating: integer("overall_rating"), // 1–5
  strengths: text("strengths"),
  improvements: text("improvements"),
  goals: text("goals"),
  status: text("status", { enum: REVIEW_STATUSES }).notNull().default("draft"),
  reviewDate: text("review_date"), // "YYYY-MM-DD"
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({
  id: true,
  createdAt: true,
});

export const insertPayslipSchema = createInsertSchema(payslips).omit({
  id: true,
  createdAt: true,
});

export const insertLeaveRequestSchema = createInsertSchema(leaveRequests).omit({
  id: true,
  createdAt: true,
  decidedBy: true,
  decidedAt: true,
  status: true,
});

export const insertJobOpeningSchema = createInsertSchema(jobOpenings).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertCandidateSchema = createInsertSchema(candidates).omit({
  id: true,
  createdAt: true,
});

export const insertPerformanceReviewSchema = createInsertSchema(performanceReviews).omit({
  id: true,
  createdAt: true,
});

export const clockSchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Employee = typeof employees.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type Payslip = typeof payslips.$inferSelect;
export type AttendanceRow = typeof attendance.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type JobOpening = typeof jobOpenings.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type PerformanceReview = typeof performanceReviews.$inferSelect;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;

export interface PayslipDeduction {
  label: string;
  amountCents: number;
}

// ─── Label maps ──────────────────────────────────────────────────────────────

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contractor",
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  on_leave: "On Leave",
  terminated: "Terminated",
};

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  salary: "Salary",
  hourly: "Hourly",
};

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  paid: "Paid",
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  unpaid: "Unpaid",
  other: "Other",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
};

export const OPENING_STATUS_LABELS: Record<OpeningStatus, string> = {
  open: "Open",
  on_hold: "On Hold",
  closed: "Closed",
};

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};
