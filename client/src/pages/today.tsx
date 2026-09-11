import { LeadQueue } from '@/components/LeadIntake';
import { TimeReview } from "./suite-reviews";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useApiMutation } from "@/hooks/useApiMutation";
import Header from "@/components/Header";
import { RetryBlock } from "@/components/RetryBlock";
export default function TodayPage() {
  const { isElevated } = useAuth();
  const data = useQuery<any>({
    queryKey: ["suite-today"],
    queryFn: async () => (await apiRequest("GET", "/api/suite/today")).json(),
  });
  const inbox = useQuery<any[]>({
    queryKey: ["suite-notifications"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/suite/notifications")).json(),
  });
  const action = useApiMutation<any, { id: number; action: string }>({
    request: (v) => ({
      method: "PATCH",
      url: `/api/suite/notifications/${v.id}`,
      body: { action: v.action },
    }),
    errorTitle: "Could not update notification",
  });
  return (
    <div className="space-y-6">
      <Header
        title="Today"
        description={
          isElevated
            ? "Decisions, jobs and people needing your attention."
            : "Your work, materials and messages."
        }
      />
      <div className="flex flex-wrap gap-3">
        <Link className="rounded-lg border px-4 py-2" href="/projects">
          Jobs
        </Link>
        <Link className="rounded-lg border px-4 py-2" href="/crm/leads">
          Customers & leads
        </Link>
        <Link className="rounded-lg border px-4 py-2" href="/home">
          Inventory
        </Link>
        {isElevated && (
          <>
            <Link
              className="rounded-lg border px-4 py-2"
              href="/finance/invoices?status=overdue"
            >
              Money to collect
            </Link>
            <Link className="rounded-lg border px-4 py-2" href="/suite-health">
              Owner controls
            </Link>
          </>
        )}
      </div>
      {isElevated && <LeadQueue />}
      {data.isError ? (
        <RetryBlock query={data} />
      ) : data.isPending ? (
        <p role="status">Loading your day…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">Jobs to prepare</h2>
            {!data.data.jobs.length && <p>No active jobs.</p>}
            {data.data.jobs.map((j: any) => (
              <Link
                key={j.id}
                href={`/project/${j.id}`}
                className="block border-t py-3"
              >
                <strong>{j.name}</strong>
                <p className="text-sm text-muted-foreground">
                  {j.ready ? "Ready" : j.blockers[0]?.label} ·{" "}
                  {j.startDate || "Dates not set"} · {j.scheduleState}
                </p>
              </Link>
            ))}
          </section>
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">Next tasks</h2>
            {!data.data.tasks.length && <p>Nothing open.</p>}
            {data.data.tasks.map((t: any) => (
              <Link
                key={t.id}
                href={`/pm/board?task=${t.id}`}
                className="block border-t py-3"
              >
                {t.title}
                <p className="text-sm text-muted-foreground">
                  {t.project_name} {t.due_date && `· Due ${t.due_date}`}
                </p>
              </Link>
            ))}
          </section>
          {!!data.data.loans.length && (
            <section className="rounded-xl border bg-card p-5">
              <h2 className="mb-3 font-semibold">Tools to return</h2>
              {data.data.loans.map((l: any) => (
                <Link
                  className="block py-2"
                  key={l.id}
                  href={`/item/${l.item_id}`}
                >
                  {l.name} · {l.outstanding} outstanding
                </Link>
              ))}
            </section>
          )}
        </div>
      )}
      <TimeReview />
      <section id="inbox" className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Inbox</h2>
        {inbox.isError ? (
          <RetryBlock query={inbox} />
        ) : inbox.isPending ? (
          <p>Loading messages…</p>
        ) : !inbox.data?.length ? (
          <p>You’re caught up.</p>
        ) : (
          inbox.data.map((n) => (
            <div
              key={n.id}
              className="flex flex-wrap items-center gap-3 border-t py-3"
            >
              <Link
                className={n.read_at ? "" : "font-semibold"}
                onClick={() => action.mutate({ id: n.id, action: "read" })}
                href={n.href}
              >
                {n.title}
              </Link>
              <div className="ml-auto flex gap-3">
                <button
                  className="underline"
                  onClick={() => action.mutate({ id: n.id, action: "snooze" })}
                >
                  Later
                </button>
                <button
                  className="underline"
                  onClick={() => action.mutate({ id: n.id, action: "resolve" })}
                >
                  Done
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
