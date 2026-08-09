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

export const LEAVE_TYPES = ["vacation", "sick", "personal", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

// Historical statuses — new entries are always "approved" (time off filed is
// fact); the enum stays so old "denied" rows still type-check.
export const LEAVE_STATUSES = ["pending", "approved", "denied"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

export const employees = sqliteTable("hr_employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Optional link to a login account — joins this employee to their
  // pm_time_entries hours and "my time off".
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

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export const insertLeaveRequestSchema = createInsertSchema(leaveRequests).omit({
  id: true,
  createdAt: true,
  decidedBy: true,
  decidedAt: true,
  status: true,
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Employee = typeof employees.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;

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

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  unpaid: "Unpaid",
  other: "Other",
};
