import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { LoadingBlock } from "@/components/ui/Feedback";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { formatDate } from "@/lib/format";
import {
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  type Employee,
  type LeaveRequest,
  type LeaveType,
  type LeaveStatus,
} from "@shared/hr-schema";
import { Loader2, Plus, CalendarDays, Check, X, Trash2, Info } from "lucide-react";

const textareaCls =
  "min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const STATUS_CHIP: Record<LeaveStatus, ChipTone> = {
  pending: "amber",
  approved: "emerald",
  denied: "red",
};

type LeaveRow = LeaveRequest & { employeeName?: string };

function daysLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

// ─── Request dialog ───────────────────────────────────────────────────────────

function RequestDialog({ me, onClose }: { me: Employee | null; onClose: () => void }) {
  const { isElevated } = useAuth();
  const [employeeId, setEmployeeId] = useState(me ? String(me.id) : "");
  const [type, setType] = useState<LeaveType>("vacation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["hr-employees"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/employees")).json(),
    enabled: isElevated,
  });

  const create = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/hr/leave",
      body: {
        employeeId: Number(employeeId),
        type,
        startDate,
        endDate,
        days: parseFloat(days) || 1,
        reason: reason.trim() || null,
      },
    }),
    invalidate: [["hr-leave"]],
    successTitle: "Leave requested",
    errorTitle: "Could not file request",
    onSuccess: onClose,
  });

  return (
    <Modal open onClose={onClose} title="Request leave">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!employeeId) {
            toast({ variant: "destructive", title: "Pick an employee" });
            return;
          }
          if (!startDate || !endDate) {
            toast({ variant: "destructive", title: "Start and end dates are required" });
            return;
          }
          if (endDate < startDate) {
            toast({ variant: "destructive", title: "End date must be after the start date" });
            return;
          }
          if (!(parseFloat(days) > 0)) {
            toast({ variant: "destructive", title: "Days must be greater than zero" });
            return;
          }
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {isElevated && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Employee</span>
            <select
              className={inputCls}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Type</span>
          <select
            className={inputCls}
            value={type}
            onChange={(e) => setType(e.target.value as LeaveType)}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Start date</span>
            <input
              type="date"
              className={inputCls}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">End date</span>
            <input
              type="date"
              className={inputCls}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Days</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            className={inputCls}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">Half days are allowed (e.g. 0.5).</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Reason (optional)</span>
          <textarea
            className={textareaCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Submit request
        </button>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HrLeavePage() {
  const { isElevated } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: me = null, isLoading: meLoading } = useQuery<Employee | null>({
    queryKey: ["hr-me"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/me")).json(),
  });

  const { data: rows = [], isLoading } = useQuery<LeaveRow[]>({
    queryKey: ["hr-leave"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/leave")).json(),
  });

  const decide = useApiMutation<any, { id: number; status: "approved" | "denied" }>({
    request: ({ id, status }) => ({
      method: "PATCH",
      url: `/api/hr/leave/${id}/decide`,
      body: { status },
    }),
    invalidate: [["hr-leave"]],
    successTitle: (_d, vars) => (vars.status === "approved" ? "Leave approved" : "Leave denied"),
    errorTitle: "Could not decide request",
  });

  const withdraw = useApiMutation<any, number>({
    request: (id) => ({ method: "DELETE", url: `/api/hr/leave/${id}` }),
    invalidate: [["hr-leave"]],
    successTitle: "Request withdrawn",
    errorTitle: "Could not withdraw",
  });

  const myRequests = isElevated ? rows.filter((r) => me && r.employeeId === me.id) : rows;
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");
  const canRequest = isElevated || !!me;

  const typeSummary = LEAVE_TYPES.map((t) => {
    const ofType = rows.filter((r) => r.type === t);
    return { type: t, count: ofType.length, days: ofType.reduce((s, r) => s + r.days, 0) };
  }).filter((s) => s.count > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Leave" description="Time-off requests and approvals">
        <button
          onClick={() => setDialogOpen(true)}
          disabled={!canRequest || meLoading}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          <Plus className="h-5 w-5" />
          Request leave
        </button>
      </Header>

      {isLoading || meLoading ? (
        <LoadingBlock />
      ) : (
        <>
          {!me && !isElevated && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              <Info className="h-5 w-5 shrink-0" />
              <p>
                No employee profile is linked to your account, so you can't file leave requests
                yet. Ask a manager to link your login on the Employees page.
              </p>
            </div>
          )}

          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-foreground">My requests</h2>
            {myRequests.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
                <CalendarDays className="h-12 w-12" />
                <p className="text-lg">No leave requests yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {myRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="w-20 font-medium text-foreground">
                      {LEAVE_TYPE_LABELS[r.type]}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(r.startDate)} – {formatDate(r.endDate)}
                    </span>
                    <span className="tabular-nums text-foreground">{daysLabel(r.days)}</span>
                    {r.reason && (
                      <span className="max-w-[18rem] truncate text-muted-foreground">
                        {r.reason}
                      </span>
                    )}
                    <Chip tone={STATUS_CHIP[r.status]} className="ml-auto">
                      {LEAVE_STATUS_LABELS[r.status]}
                    </Chip>
                    {r.status === "pending" && me && r.employeeId === me.id && (
                      <button
                        onClick={() => {
                          if (window.confirm("Withdraw this leave request?")) withdraw.mutate(r.id);
                        }}
                        disabled={withdraw.isPending}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                        aria-label="Withdraw request"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isElevated && (
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Team queue</h2>
                <div className="ml-auto flex flex-wrap gap-2">
                  {typeSummary.map((s) => (
                    <Chip
                      key={s.type}
                      className="bg-zinc-500/10 text-zinc-700 dark:text-zinc-400"
                    >
                      {LEAVE_TYPE_LABELS[s.type]} · {s.days}d
                    </Chip>
                  ))}
                </div>
              </div>

              {pending.length === 0 ? (
                <p className="mb-6 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  No pending requests — all caught up.
                </p>
              ) : (
                <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Dates</th>
                        <th className="px-4 py-3 text-right font-medium">Days</th>
                        <th className="px-4 py-3 font-medium">Reason</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pending.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-3 font-medium text-foreground">
                            {r.employeeName ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-foreground">{LEAVE_TYPE_LABELS[r.type]}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDate(r.startDate)} – {formatDate(r.endDate)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {r.days}
                          </td>
                          <td className="max-w-[14rem] truncate px-4 py-3 text-muted-foreground">
                            {r.reason ?? ""}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => decide.mutate({ id: r.id, status: "approved" })}
                                disabled={decide.isPending}
                                className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                              >
                                <Check className="h-4 w-4" /> Approve
                              </button>
                              <button
                                onClick={() => decide.mutate({ id: r.id, status: "denied" })}
                                disabled={decide.isPending}
                                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
                              >
                                <X className="h-4 w-4" /> Deny
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Decided
              </h3>
              {decided.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decided requests yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Dates</th>
                        <th className="px-4 py-3 text-right font-medium">Days</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Decided</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {decided.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-3 font-medium text-foreground">
                            {r.employeeName ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-foreground">{LEAVE_TYPE_LABELS[r.type]}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDate(r.startDate)} – {formatDate(r.endDate)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {r.days}
                          </td>
                          <td className="px-4 py-3">
                            <Chip tone={STATUS_CHIP[r.status]}>
                              {LEAVE_STATUS_LABELS[r.status]}
                            </Chip>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {r.decidedAt ? formatDate(r.decidedAt) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {dialogOpen && <RequestDialog me={me} onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
