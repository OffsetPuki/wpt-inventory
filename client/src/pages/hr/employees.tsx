import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMoney, parseMoney, formatHours } from "@/lib/format";
import type { PublicUser } from "@shared/schema";
import {
  EMPLOYMENT_TYPES,
  EMPLOYEE_STATUSES,
  PAY_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYEE_STATUS_LABELS,
  PAY_TYPE_LABELS,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  PAYROLL_STATUS_LABELS,
  type Employee,
  type AttendanceRow,
  type LeaveRequest,
  type Payslip,
  type PerformanceReview,
  type EmployeeStatus,
  type EmploymentType,
  type PayType,
  type PayrollStatus,
  type LeaveStatus,
} from "@shared/hr-schema";
import { Loader2, Plus, Search, Users, Pencil, Trash2, Star } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";
const chipCls = "rounded-full px-2.5 py-0.5 text-xs font-medium";

const STATUS_CHIP: Record<EmployeeStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  on_leave: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  terminated: "bg-red-500/10 text-red-700 dark:text-red-400",
};
const TYPE_CHIP: Record<EmploymentType, string> = {
  full_time: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  part_time: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  contractor: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};
const LEAVE_CHIP: Record<LeaveStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  denied: "bg-red-500/10 text-red-700 dark:text-red-400",
};
const RUN_CHIP: Record<PayrollStatus, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  approved: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

function payLabel(e: Pick<Employee, "payType" | "payRateCents">): string {
  return `${formatMoney(e.payRateCents)}${e.payType === "salary" ? "/yr" : "/hr"}`;
}

function initials(e: Pick<Employee, "firstName" | "lastName">): string {
  return `${e.firstName[0] ?? ""}${e.lastName[0] ?? ""}`.toUpperCase();
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function EmployeeDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState(employee?.firstName ?? "");
  const [lastName, setLastName] = useState(employee?.lastName ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [address, setAddress] = useState(employee?.address ?? "");
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle ?? "");
  const [department, setDepartment] = useState(employee?.department ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    employee?.employmentType ?? "full_time"
  );
  const [status, setStatus] = useState<EmployeeStatus>(employee?.status ?? "active");
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? "");
  const [endDate, setEndDate] = useState(employee?.endDate ?? "");
  const [payType, setPayType] = useState<PayType>(employee?.payType ?? "hourly");
  const [payRate, setPayRate] = useState(
    employee ? String(employee.payRateCents / 100) : ""
  );
  const [emergencyContact, setEmergencyContact] = useState(employee?.emergencyContact ?? "");
  const [notes, setNotes] = useState(employee?.notes ?? "");
  const [userId, setUserId] = useState(employee?.userId ? String(employee.userId) : "");

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        jobTitle: jobTitle.trim() || null,
        department: department.trim() || null,
        employmentType,
        status,
        hireDate: hireDate || null,
        endDate: endDate || null,
        payType,
        payRateCents: parseMoney(payRate),
        emergencyContact: emergencyContact.trim() || null,
        notes: notes.trim() || null,
        userId: userId ? Number(userId) : null,
      };
      const res = employee
        ? await apiRequest("PATCH", `/api/hr/employees/${employee.id}`, body)
        : await apiRequest("POST", "/api/hr/employees", body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      qc.invalidateQueries({ queryKey: ["hr-employee-detail"] });
      toast({ variant: "success", title: employee ? "Employee updated" : "Employee added" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save employee", description: e?.message }),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={employee ? "Edit employee" : "New employee"}
      maxWidth="max-w-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!firstName.trim() || !lastName.trim()) {
            toast({ variant: "destructive", title: "First and last name are required" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">First name</span>
            <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Last name</span>
            <input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email</span>
            <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Phone</span>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-foreground">Address</span>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Job title</span>
            <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Department</span>
            <input className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Employment type</span>
            <select
              className={inputCls}
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as EmployeeStatus)}
            >
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Hire date</span>
            <input type="date" className={inputCls} value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">End date</span>
            <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Pay type</span>
            <select
              className={inputCls}
              value={payType}
              onChange={(e) => setPayType(e.target.value as PayType)}
            >
              {PAY_TYPES.map((t) => (
                <option key={t} value={t}>{PAY_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Pay rate ($)</span>
            <input
              className={inputCls}
              value={payRate}
              onChange={(e) => setPayRate(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
            <span className="text-xs text-muted-foreground">
              {payType === "salary" ? "Per year" : "Per hour"}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Emergency contact</span>
            <input
              className={inputCls}
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Login account (optional)</span>
            <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Not linked</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {employee ? "Save changes" : "Add employee"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

interface EmployeeDetail {
  employee: Employee;
  attendance: AttendanceRow[];
  leave: LeaveRequest[];
  payslips: (Payslip & {
    periodStart: string;
    periodEnd: string;
    payDate: string | null;
    runStatus: PayrollStatus;
  })[];
  reviews: PerformanceReview[];
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function shiftDuration(a: AttendanceRow): string {
  if (!a.clockOut) return "Open";
  return formatHours(Math.max(0, Math.round((a.clockOut - a.clockIn) / 60_000)));
}

function DetailModal({
  id,
  onClose,
  onEdit,
}: {
  id: number;
  onClose: () => void;
  onEdit: (e: Employee) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<EmployeeDetail>({
    queryKey: ["hr-employee-detail", id],
    queryFn: async () => (await apiRequest("GET", `/api/hr/employees/${id}/detail`)).json(),
  });

  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/hr/employees/${id}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      toast({ variant: "success", title: "Employee removed" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not remove", description: e?.message }),
  });

  const emp = data?.employee;

  return (
    <Modal
      open
      onClose={onClose}
      title={emp ? `${emp.firstName} ${emp.lastName}` : "Employee"}
      maxWidth="max-w-2xl"
    >
      {isLoading || !data || !emp ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={cn(chipCls, STATUS_CHIP[emp.status])}>
              {EMPLOYEE_STATUS_LABELS[emp.status]}
            </span>
            <span className={cn(chipCls, TYPE_CHIP[emp.employmentType])}>
              {EMPLOYMENT_TYPE_LABELS[emp.employmentType]}
            </span>
            <span className="text-sm text-muted-foreground">
              {PAY_TYPE_LABELS[emp.payType]} · {payLabel(emp)}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => onEdit(emp)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Remove ${emp.firstName} ${emp.lastName}? Their history is kept.`)) {
                    del.mutate();
                  }
                }}
                disabled={del.isPending}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Job title" value={emp.jobTitle ?? ""} />
            <Field label="Department" value={emp.department ?? ""} />
            <Field label="Hire date" value={emp.hireDate ? formatDate(emp.hireDate) : ""} />
            <Field label="Email" value={emp.email ?? ""} />
            <Field label="Phone" value={emp.phone ?? ""} />
            <Field label="Address" value={emp.address ?? ""} />
            <Field label="Emergency contact" value={emp.emergencyContact ?? ""} />
            <Field label="End date" value={emp.endDate ? formatDate(emp.endDate) : ""} />
            <Field label="Notes" value={emp.notes ?? ""} />
          </div>

          <SectionTitle>Recent attendance</SectionTitle>
          {data.attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shifts recorded.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.attendance.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <span className="text-foreground">{formatDateTime(a.clockIn)}</span>
                  <span className="text-muted-foreground">
                    {a.clockOut ? `→ ${formatDateTime(a.clockOut)}` : "in progress"}
                  </span>
                  <span className="tabular-nums text-foreground">{shiftDuration(a)}</span>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Leave history</SectionTitle>
          {data.leave.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave requests.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.leave.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-foreground">{LEAVE_TYPE_LABELS[l.type]}</span>
                  <span className="text-muted-foreground">
                    {formatDate(l.startDate)} – {formatDate(l.endDate)} · {l.days}d
                  </span>
                  <span className={cn(chipCls, LEAVE_CHIP[l.status])}>
                    {LEAVE_STATUS_LABELS[l.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Payslips</SectionTitle>
          {data.payslips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payslips yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.payslips.slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-foreground">
                    {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                  </span>
                  <span className={cn(chipCls, RUN_CHIP[p.runStatus])}>
                    {PAYROLL_STATUS_LABELS[p.runStatus]}
                  </span>
                  <span className="tabular-nums font-medium text-foreground">
                    {formatMoney(p.netCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Performance reviews</SectionTitle>
          {data.reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.reviews.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-foreground">{r.periodLabel}</span>
                  <span className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className={cn(
                          "h-3.5 w-3.5",
                          r.overallRating && i <= r.overallRating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30"
                        )}
                      />
                    ))}
                  </span>
                  <span className="text-muted-foreground">
                    {r.reviewDate ? formatDate(r.reviewDate) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HrEmployeesPage() {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; employee: Employee | null }>({
    open: false,
    employee: null,
  });
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["hr-employees"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/employees")).json(),
  });

  const departments = useMemo(
    () =>
      Array.from(new Set(employees.map((e) => e.department).filter((d): d is string => !!d))).sort(),
    [employees]
  );

  const filtered = employees.filter((e) => {
    const term = q.trim().toLowerCase();
    const matchesQ =
      !term ||
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(term) ||
      (e.email ?? "").toLowerCase().includes(term) ||
      (e.jobTitle ?? "").toLowerCase().includes(term);
    const matchesDept = !department || e.department === department;
    const matchesStatus = !status || e.status === status;
    return matchesQ && matchesDept && matchesStatus;
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Employees" description="Directory of everyone on the team">
        <button
          onClick={() => setDialog({ open: true, employee: null })}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New employee
        </button>
      </Header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or title…"
            className="h-11 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="h-11 rounded-xl border border-input bg-card px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-11 rounded-xl border border-input bg-card px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        >
          <option value="">All statuses</option>
          {EMPLOYEE_STATUSES.map((s) => (
            <option key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Users className="h-12 w-12" />
          <p className="text-lg">
            {employees.length === 0 ? "No employees yet" : "No employees match your filters"}
          </p>
          {employees.length === 0 && (
            <button
              onClick={() => setDialog({ open: true, employee: null })}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
              Add your first employee
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setDetailId(e.id)}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {initials(e)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {e.firstName} {e.lastName}
                        </p>
                        {e.email && (
                          <p className="truncate text-xs text-muted-foreground">{e.email}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{e.jobTitle ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground">{e.department ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn(chipCls, TYPE_CHIP[e.employmentType])}>
                      {EMPLOYMENT_TYPE_LABELS[e.employmentType]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(chipCls, STATUS_CHIP[e.status])}>
                      {EMPLOYEE_STATUS_LABELS[e.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {payLabel(e)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.open && (
        <EmployeeDialog
          employee={dialog.employee}
          onClose={() => setDialog({ open: false, employee: null })}
        />
      )}
      {detailId != null && (
        <DetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(e) => {
            setDetailId(null);
            setDialog({ open: true, employee: e });
          }}
        />
      )}
    </div>
  );
}
