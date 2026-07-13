import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, parseMoney, formatHours } from "@/lib/format";
import {
  PAYROLL_STATUS_LABELS,
  type PayrollRun,
  type Payslip,
  type PayrollStatus,
  type PayslipDeduction,
} from "@shared/hr-schema";
import { Loader2, Plus, Wallet, Pencil, Trash2, X, CheckCircle2, Receipt, AlertTriangle } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";
const chipCls = "rounded-full px-2.5 py-0.5 text-xs font-medium";

const RUN_CHIP: Record<PayrollStatus, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  approved: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

type RunRow = PayrollRun & {
  payslipCount: number;
  grossTotalCents: number;
  deductionsTotalCents: number;
  netTotalCents: number;
};
// pmMinutes (Fix 5, wiring plan): job-log minutes from PM time entries for the
// same period, joined via the employee's login. null = PM module absent or no
// linked login — the comparison column shows "—" and never flags.
type SlipRow = Payslip & { employeeName: string; pmMinutes?: number | null };

// The shop clock (attendance) and job clock (PM time) disagree by >15% —
// either hours never got logged to jobs, or someone forgot to clock in/out.
function timeDiverges(p: SlipRow): boolean {
  if (p.pmMinutes == null || p.hoursWorked <= 0) return false;
  const pmHours = p.pmMinutes / 60;
  return Math.abs(pmHours - p.hoursWorked) / p.hoursWorked > 0.15;
}
type MySlip = Payslip & {
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  runStatus: PayrollStatus;
};

function parseDeductions(json: string | null | undefined): PayslipDeduction[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hoursLabel(hours: number): string {
  return hours > 0 ? formatHours(Math.round(hours * 60)) : "—";
}

// ─── New run dialog ───────────────────────────────────────────────────────────

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/hr/payroll/runs", {
          periodStart,
          periodEnd,
          payDate: payDate || undefined,
          notes: notes.trim() || undefined,
        })
      ).json(),
    onSuccess: (data: { run: PayrollRun; payslips: Payslip[] }) => {
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
      toast({
        variant: "success",
        title: "Payroll run created",
        description: `${data.payslips.length} payslip${data.payslips.length === 1 ? "" : "s"} generated for active employees.`,
      });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not create run", description: e?.message }),
  });

  return (
    <Modal open onClose={onClose} title="New payroll run">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!periodStart || !periodEnd) {
            toast({ variant: "destructive", title: "Period start and end are required" });
            return;
          }
          if (periodEnd < periodStart) {
            toast({ variant: "destructive", title: "Period end must be after the start" });
            return;
          }
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Period start</span>
            <input
              type="date"
              className={inputCls}
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Period end</span>
            <input
              type="date"
              className={inputCls}
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Pay date (optional)</span>
          <input
            type="date"
            className={inputCls}
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">
          A payslip is generated for every active employee — hourly pay from closed shifts in the
          period, salary pro-rated by calendar days.
        </p>
        <button
          type="submit"
          disabled={create.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Create run & generate payslips
        </button>
      </form>
    </Modal>
  );
}

// ─── Payslip edit dialog ──────────────────────────────────────────────────────

function EditSlipDialog({ slip, onClose }: { slip: SlipRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(String(slip.hoursWorked));
  const [gross, setGross] = useState(String(slip.grossCents / 100));
  const [rows, setRows] = useState<{ label: string; amount: string }[]>(
    parseDeductions(slip.deductions).map((d) => ({
      label: d.label,
      amount: String(d.amountCents / 100),
    }))
  );
  const [notes, setNotes] = useState(slip.notes ?? "");

  const deductionsTotal = rows.reduce((s, r) => s + parseMoney(r.amount), 0);
  const netPreview = parseMoney(gross) - deductionsTotal;

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PATCH", `/api/hr/payslips/${slip.id}`, {
          hoursWorked: parseFloat(hours) || 0,
          grossCents: parseMoney(gross),
          deductions: rows
            .filter((r) => r.label.trim())
            .map((r) => ({ label: r.label.trim(), amountCents: parseMoney(r.amount) })),
          notes: notes.trim() || null,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-payroll-run"] });
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["hr-payslips-mine"] });
      toast({ variant: "success", title: "Payslip updated" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save payslip", description: e?.message }),
  });

  return (
    <Modal open onClose={onClose} title={`Payslip — ${slip.employeeName}`} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Hours worked</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Gross pay ($)</span>
            <input
              className={inputCls}
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Deductions</span>
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No deductions on this payslip.</p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={cn(inputCls, "flex-1")}
                placeholder="Label (e.g. Tax withholding)"
                value={r.label}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <input
                className={cn(inputCls, "w-28")}
                placeholder="$"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                }
              />
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Remove deduction"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows([...rows, { label: "", amount: "" }])}
            className="flex h-9 w-fit items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
          >
            <Plus className="h-4 w-4" /> Add deduction
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Deductions {formatMoney(deductionsTotal)}
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            Net {formatMoney(netPreview)}
          </span>
        </div>

        <button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Save payslip
        </button>
      </form>
    </Modal>
  );
}

// ─── Run detail modal ─────────────────────────────────────────────────────────

function RunDetailModal({ runId, onClose }: { runId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [editSlip, setEditSlip] = useState<SlipRow | null>(null);

  const { data, isLoading } = useQuery<{ run: PayrollRun; payslips: SlipRow[] }>({
    queryKey: ["hr-payroll-run", runId],
    queryFn: async () => (await apiRequest("GET", `/api/hr/payroll/runs/${runId}`)).json(),
  });

  const setStatus = useMutation({
    mutationFn: async (status: PayrollStatus) =>
      (await apiRequest("PATCH", `/api/hr/payroll/runs/${runId}`, { status })).json(),
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ["hr-payroll-run", runId] });
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["hr-payslips-mine"] });
      toast({
        variant: "success",
        title: status === "approved" ? "Run approved" : "Run marked as paid",
      });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update run", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/hr/payroll/runs/${runId}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
      toast({ variant: "success", title: "Run deleted" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete run", description: e?.message }),
  });

  const run = data?.run;
  const slips = data?.payslips ?? [];
  const grossTotal = slips.reduce((s, p) => s + p.grossCents, 0);
  const dedTotal = slips.reduce((s, p) => s + p.deductionsCents, 0);
  const netTotal = slips.reduce((s, p) => s + p.netCents, 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={run ? `Payroll ${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)}` : "Payroll run"}
      maxWidth="max-w-3xl"
    >
      {isLoading || !run ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className={cn(chipCls, RUN_CHIP[run.status])}>
              {PAYROLL_STATUS_LABELS[run.status]}
            </span>
            <span className="text-sm text-muted-foreground">
              Pay date: {run.payDate ? formatDate(run.payDate) : "—"}
            </span>
            {run.notes && <span className="text-sm text-muted-foreground">· {run.notes}</span>}
            <div className="ml-auto flex gap-2">
              {run.status === "draft" && (
                <>
                  <button
                    onClick={() => {
                      if (window.confirm("Approve this payroll run? Amounts should be final."))
                        setStatus.mutate("approved");
                    }}
                    disabled={setStatus.isPending}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("Delete this draft run and all its payslips?"))
                        del.mutate();
                    }}
                    disabled={del.isPending}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                </>
              )}
              {run.status === "approved" && (
                <button
                  onClick={() => {
                    if (window.confirm("Mark this payroll run as paid?"))
                      setStatus.mutate("paid");
                  }}
                  disabled={setStatus.isPending}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  <Wallet className="h-4 w-4" /> Mark paid
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">Gross</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {formatMoney(grossTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">Deductions</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {formatMoney(dedTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">Net</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {formatMoney(netTotal)}
              </p>
            </div>
          </div>

          {slips.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No payslips in this run.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 text-right font-medium">Hours</th>
                    <th
                      className="px-4 py-3 text-right font-medium"
                      title="Hours logged to jobs in PM → Time for the same period"
                    >
                      Job log
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Gross</th>
                    <th className="px-4 py-3 text-right font-medium">Deductions</th>
                    <th className="px-4 py-3 text-right font-medium">Net</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {slips.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-foreground">{p.employeeName}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {hoursLabel(p.hoursWorked)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right tabular-nums",
                          timeDiverges(p)
                            ? "font-medium text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground",
                        )}
                        title={
                          timeDiverges(p)
                            ? "Shop clock and job log disagree by more than 15% — hours may be missing from PM → Time or Attendance"
                            : undefined
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          {timeDiverges(p) && <AlertTriangle className="h-3.5 w-3.5" />}
                          {p.pmMinutes == null ? "—" : formatHours(p.pmMinutes)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {formatMoney(p.grossCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {formatMoney(p.deductionsCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {formatMoney(p.netCents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditSlip(p)}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label="Edit payslip"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editSlip && <EditSlipDialog slip={editSlip} onClose={() => setEditSlip(null)} />}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HrPayrollPage() {
  const { isElevated } = useAuth();
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [detailRunId, setDetailRunId] = useState<number | null>(null);

  const { data: runs = [], isLoading: runsLoading } = useQuery<RunRow[]>({
    queryKey: ["hr-payroll-runs"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/payroll/runs")).json(),
    enabled: isElevated,
  });

  const { data: mySlips = [], isLoading: mineLoading } = useQuery<MySlip[]>({
    queryKey: ["hr-payslips-mine"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/payslips/mine")).json(),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header
        title="Payroll"
        description={isElevated ? "Payroll runs and payslips" : "Your payslips"}
      >
        {isElevated && (
          <button
            onClick={() => setNewRunOpen(true)}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            New payroll run
          </button>
        )}
      </Header>

      {isElevated && (
        <section className="mb-10">
          {runsLoading ? (
            <div className="flex justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <Wallet className="h-12 w-12" />
              <p className="text-lg">No payroll runs yet</p>
              <button
                onClick={() => setNewRunOpen(true)}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-5 w-5" />
                Create your first run
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Period</th>
                    <th className="px-4 py-3 font-medium">Pay date</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Employees</th>
                    <th className="px-4 py-3 text-right font-medium">Gross</th>
                    <th className="px-4 py-3 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setDetailRunId(r.id)}
                      className="cursor-pointer transition-colors hover:bg-accent/50"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {r.payDate ? formatDate(r.payDate) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(chipCls, RUN_CHIP[r.status])}>
                          {PAYROLL_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {r.payslipCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {formatMoney(r.grossTotalCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {formatMoney(r.netTotalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">My payslips</h2>
        {mineLoading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : mySlips.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <Receipt className="h-12 w-12" />
            <p className="text-lg">No payslips yet</p>
            <p className="text-sm">
              Payslips appear here once payroll runs are generated for your linked employee profile.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Pay date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Hours</th>
                  <th className="px-4 py-3 text-right font-medium">Gross</th>
                  <th className="px-4 py-3 text-right font-medium">Deductions</th>
                  <th className="px-4 py-3 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mySlips.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {p.payDate ? formatDate(p.payDate) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(chipCls, RUN_CHIP[p.runStatus])}>
                        {PAYROLL_STATUS_LABELS[p.runStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {hoursLabel(p.hoursWorked)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {formatMoney(p.grossCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {formatMoney(p.deductionsCents)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatMoney(p.netCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {newRunOpen && <NewRunDialog onClose={() => setNewRunOpen(false)} />}
      {detailRunId != null && (
        <RunDetailModal runId={detailRunId} onClose={() => setDetailRunId(null)} />
      )}
    </div>
  );
}
