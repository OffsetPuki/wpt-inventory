import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useAuth } from "@/lib/auth";
import Header from "@/components/Header";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { inputCls } from "@/lib/ui-styles";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { Loader2, Wallet, Receipt, Info } from "lucide-react";

// ─── Payroll = hours × rate over pm_time_entries ─────────────────────────────
// No runs, no payslips, no approval ladder. Pick a period, read the totals,
// record the labor as one Finance expense. Cutting the check happens at the
// bank, not in here.

interface SummaryRow {
  employeeId: number;
  name: string;
  payType: "salary" | "hourly";
  payRateCents: number;
  hours: number;
  grossCents: number;
  linkedLogin: boolean;
}

function ymdLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function rateLabel(r: SummaryRow): string {
  return `${formatMoney(r.payRateCents)}${r.payType === "salary" ? "/yr" : "/hr"}`;
}

export default function HrPayrollPage() {
  const { isElevated } = useAuth();
  // Default period: the last 14 days, inclusive.
  const [from, setFrom] = useState(() => ymdLocal(new Date(Date.now() - 13 * 86_400_000)));
  const [to, setTo] = useState(() => ymdLocal(new Date()));

  const rangeValid = !!from && !!to && from <= to;

  const { data: rows = [], isLoading } = useQuery<SummaryRow[]>({
    queryKey: ["hr-payroll-summary", from, to],
    queryFn: async () =>
      (await apiRequest("GET", `/api/hr/payroll/summary?from=${from}&to=${to}`)).json(),
    enabled: isElevated && rangeValid,
  });

  const totalCents = rows.reduce((s, r) => s + r.grossCents, 0);

  const record = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/hr/payroll/record-expense",
      body: { from, to, amountCents: totalCents },
    }),
    invalidate: [["expenses"], ["finance-stats"]],
    successTitle: "Recorded as expense",
    errorTitle: "Could not record expense",
  });

  if (!isElevated) {
    return (
      <div className="mx-auto max-w-6xl">
        <Header title="Payroll" description="Hours × rate over tracked time" />
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <Info className="h-5 w-5 shrink-0" />
          <p>Payroll is owner-only. Your hours live in Projects → Time Tracking.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Header
        title="Payroll"
        description="Hours from time tracking × pay rate, ready to book as an expense"
      >
        <button
          onClick={() => {
            if (window.confirm(`Record ${formatMoney(totalCents)} of payroll (${from} → ${to}) as an expense?`)) {
              record.mutate();
            }
          }}
          disabled={totalCents === 0 || record.isPending || !rangeValid}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {record.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Receipt className="h-5 w-5" />}
          Record as expense
        </button>
      </Header>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">From</span>
          <input
            type="date"
            className={cn(inputCls, "w-auto")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">To</span>
          <input
            type="date"
            className={cn(inputCls, "w-auto")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {!rangeValid && (
          <p className="pb-3 text-sm text-red-600 dark:text-red-400">
            Pick a valid range — "to" must be on or after "from".
          </p>
        )}
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon={Wallet} message="No active employees">
          <p className="text-sm">Add employees (with a pay rate) on the Employees page.</p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 text-right font-medium">Hours</th>
                <th className="px-4 py-3 text-right font-medium">Rate</th>
                <th className="px-4 py-3 text-right font-medium">Gross</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{r.name}</p>
                    {!r.linkedLogin && (
                      <p className="text-xs text-muted-foreground">
                        no login linked — hours can't be counted
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {r.payType === "salary" ? "salary" : r.hours}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {rateLabel(r)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                    {formatMoney(r.grossCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-semibold text-foreground">Total</td>
                <td />
                <td />
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                  {formatMoney(totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
