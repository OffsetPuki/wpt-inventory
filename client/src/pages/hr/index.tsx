import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import Header from "@/components/Header";
import {
  Users,
  Clock,
  CalendarDays,
  Briefcase,
  UserPlus,
  Wallet,
  Star,
  Loader2,
  ChevronRight,
} from "lucide-react";

interface HrStats {
  activeEmployees: number;
  clockedInNow: number;
  pendingLeave: number;
  openPositions: number;
  candidatesInPipeline: number;
  nextPayDate: string | null;
}

const QUICK_LINKS = [
  {
    href: "/hr/employees",
    icon: Users,
    title: "Employees",
    description: "Directory, profiles, and pay details",
  },
  {
    href: "/hr/attendance",
    icon: Clock,
    title: "Attendance",
    description: "Clock in/out and team timesheets",
  },
  {
    href: "/hr/payroll",
    icon: Wallet,
    title: "Payroll",
    description: "Payroll runs and payslips",
  },
  {
    href: "/hr/leave",
    icon: CalendarDays,
    title: "Leave",
    description: "Requests, approvals, and history",
  },
  {
    href: "/hr/recruitment",
    icon: UserPlus,
    title: "Recruitment",
    description: "Job openings and candidate pipeline",
  },
  {
    href: "/hr/reviews",
    icon: Star,
    title: "Reviews",
    description: "Performance reviews and ratings",
  },
];

export default function HrOverviewPage() {
  const { data: stats, isLoading } = useQuery<HrStats>({
    queryKey: ["hr-stats"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/stats")).json(),
  });

  const kpis = [
    { label: "Active employees", value: stats?.activeEmployees ?? 0 },
    { label: "Clocked in now", value: stats?.clockedInNow ?? 0 },
    { label: "Pending leave", value: stats?.pendingLeave ?? 0 },
    { label: "Open positions", value: stats?.openPositions ?? 0 },
    { label: "Candidates in pipeline", value: stats?.candidatesInPipeline ?? 0 },
    {
      label: "Next pay date",
      value: stats?.nextPayDate ? formatDate(stats.nextPayDate) : "—",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="HR & Payroll" description="People, time, pay, and hiring at a glance" />

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{k.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          <h2 className="mb-3 mt-10 text-lg font-semibold text-foreground">Go to</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-lg"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <l.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{l.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{l.description}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>

          <div className="mt-10 flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <Briefcase className="h-5 w-5 shrink-0" />
            <p>
              New here? Start by adding your team in{" "}
              <Link href="/hr/employees" className="font-medium text-primary hover:underline">
                Employees
              </Link>
              , then link login accounts so people can clock in and see their payslips.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
