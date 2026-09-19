import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatMoney } from "@/lib/format";
import { RetryBlock } from "./RetryBlock";

type FinanceStats = {
  paidThisMonthCents: number;
  expensesThisMonthCents: number;
  netThisMonthCents: number;
  outstandingCents: number;
};

// Shares the report query and live updates; no separate totals to drift apart.
export default function BusinessReportSummary() {
  const finance = useQuery<FinanceStats>({
    queryKey: ["finance-stats"],
    queryFn: async () => (await apiRequest("GET", "/api/finance/stats")).json(),
    retry: false,
  });
  return <section aria-labelledby="today-business-report" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="today-business-report" className="text-lg font-semibold tracking-tight">Business report</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your business at a glance</p>
      </div>
      <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10">View full report <ArrowUpRight size={16} aria-hidden="true"/></Link>
    </div>
    {finance.isError ? <RetryBlock query={finance}/> : finance.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading business report…</p> :
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 xl:grid-cols-4">
        {[
          {label:"Paid this month",amount:finance.data.paidThisMonthCents,href:"/finance"},
          {label:"Expenses this month",amount:finance.data.expensesThisMonthCents,href:"/finance/expenses"},
          {label:"Net this month",amount:finance.data.netThisMonthCents,href:"/finance"},
          {label:"Outstanding invoices",amount:finance.data.outstandingCents,href:"/finance/invoices"},
        ].map(item=><Link key={item.label} href={item.href} className="min-w-0 rounded-lg transition-colors hover:bg-muted/50">
          <span className="block text-xs leading-5 text-muted-foreground">{item.label}</span>
          <span className="mt-1 block break-words text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{formatMoney(item.amount)}</span>
        </Link>)}
      </div>}
  </section>;
}
