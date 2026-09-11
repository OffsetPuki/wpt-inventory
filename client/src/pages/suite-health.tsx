import Modal from "@/components/Modal";
import { useState } from "react";
import { MergeReview, CostReviews, RestoreEvidence } from "./suite-reviews";
import { Link } from "wouter";
import Header from "@/components/Header";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useSuiteQuery } from "@/lib/suite-query";
import { RetryBlock } from "@/components/RetryBlock";
export default function SuiteHealth() {
  const [merge, setMerge] = useState<string | null>(null);
  const [review, setReview] = useState<{ id: number; payment: boolean } | null>(
      null,
    ),
    [note, setNote] = useState("");
  const resolve = useApiMutation({
    request: () => ({
      method: review?.payment ? "POST" : "PATCH",
      url: review?.payment
        ? `/api/finance/payment-exceptions/${review.id}/resolve`
        : `/api/suite/review/${review?.id}`,
      body: review?.payment ? { note } : { reason: note },
    }),
    errorTitle: "Could not record review",
    successTitle: "Review recorded",
    onSuccess: () => {
      setReview(null);
      setNote("");
    },
  });
  const q = useSuiteQuery(["suite-health"], "/api/suite/health"),
    backup = useSuiteQuery(["backup-status"], "/api/admin/backup/status");
  const retry = useApiMutation<any, { id: number; action: string }>({
    request: (v) => ({
      method: "PATCH",
      url: `/api/suite/outbox/${v.id}`,
      body: { action: v.action },
    }),
    errorTitle: "Could not update follow-up",
  });
  const date = (v: number) =>
    v ? new Date(v).toLocaleString() : "Not recorded";
  return (
    <div className="space-y-5">
      <Header
        title="Owner controls"
        description="Connections, follow-ups and records needing review."
      />
      {q.isError ? (
        <RetryBlock query={q} />
      ) : !q.data ? (
        <p>Loading status…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border p-5">
              <h2 className="font-semibold">Website inquiries</h2>
              {q.data.intake.map((s: any) => (
                <p className="mt-2" key={s.site}>
                  {s.site}: {s.count} received · Latest {date(s.latest)}
                </p>
              ))}
              <p className="mt-2 text-sm text-muted-foreground">
                Latest recorded activity does not prove a connection is
                currently healthy.
              </p>
            </section>
            <section className="rounded-xl border p-5">
              <h2 className="font-semibold">Email & payments</h2>
              <p>
                Email {q.data.mailConfigured ? "configured" : "needs setup"}
              </p>
              <p>
                {q.data.recentMailFailures.length} recent failed email attempts
              </p>
              <Link className="underline" href="/emails">
                Email settings & history
              </Link>
              <p className="mt-2">
                {q.data.paymentExceptions.length} unresolved payment exceptions
              </p>
              {q.data.paymentExceptions.map((e: any) => (
                <div key={e.id} className="mt-2">
                  <p>{e.kind.replaceAll("_", " ")}</p>
                  {e.invoice_id && (
                    <Link
                      className="mr-3 underline"
                      href={`/finance/invoices?invoice=${e.invoice_id}`}
                    >
                      Open invoice
                    </Link>
                  )}
                  <button
                    className="underline"
                    onClick={() => setReview({ id: e.id, payment: true })}
                  >
                    Record reconciliation
                  </button>
                </div>
              ))}
            </section>
          </div>
          <section className="rounded-xl border p-5">
            <h2 className="mb-3 font-semibold">Pending & failed follow-ups</h2>
            {q.data.outbox
              .filter((r: any) => !["completed", "stopped"].includes(r.status))
              .map((r: any) => (
                <div className="border-t py-3" key={r.id}>
                  <p>
                    {r.kind} · {r.status} · {r.attempts} attempts
                  </p>
                  {r.last_error && (
                    <p className="text-sm text-muted-foreground">
                      {r.last_error}
                    </p>
                  )}
                  {r.status !== "running" && (
                    <div className="mt-2 flex gap-4">
                      {["retry", "snooze", "stop"].map((action) => (
                        <button
                          key={action}
                          className="capitalize underline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate({ id: r.id, action })}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            <p className="mt-3 text-xs text-muted-foreground">
              Completed email delivery jobs mean provider accepted. Inbox
              delivery is not assumed.
            </p>
          </section>
          <section className="rounded-xl border p-5">
            <h2 className="font-semibold">Record review</h2>
            {q.data.unlinkedJobs.map((j: any) => (
              <Link
                className="block border-t py-3"
                href={`/project/${j.id}`}
                key={j.id}
              >
                {j.name} · Review customer link / billing mode
              </Link>
            ))}
            {q.data.duplicateClients.map((g: any) => (
              <button
                key={g.ids}
                className="mt-2 block underline"
                onClick={() => setMerge(g.ids)}
              >
                Review possible duplicate customers: {g.contact}
              </button>
            ))}
            {q.data.review.map((r: any) => (
              <div key={r.id} className="py-2">
                <Link className="mr-3 underline" href={r.href}>
                  {r.title}
                </Link>
                <button
                  className="text-sm underline"
                  onClick={() => setReview({ id: r.id, payment: false })}
                >
                  Record decision
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {review && (
        <Modal
          open
          title="Record completed review"
          onClose={() => setReview(null)}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              resolve.mutate();
            }}
          >
            <p>
              Describe the source records checked and the decision or correction
              completed. This closes the alert; it does not change the financial
              ledger.
            </p>
            <textarea
              aria-label="Review notes"
              className="w-full rounded border p-3"
              required
              minLength={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="rounded border px-4 py-2"
              disabled={resolve.isPending}
            >
              Record review
            </button>
          </form>
        </Modal>
      )}
      {merge && (
        <MergeReview
          ids={merge}
          close={() => {
            setMerge(null);
            q.refetch();
          }}
        />
      )}
      <CostReviews />
      <section className="rounded-xl border p-5">
        <h2 className="mb-3 font-semibold">Backups & recovery</h2>
        {backup.isError ? (
          <RetryBlock query={backup} />
        ) : backup.data ? (
          <>
            <p>Local snapshot: {date(backup.data.lastSnapshotAt)}</p>
            <p>Offsite backup: {date(backup.data.lastOffsiteAt)}</p>
            <p>
              Offsite storage:{" "}
              {backup.data.offsiteConfigured ? "Configured" : "Needs setup"}
            </p>
            {backup.data.lastOffsiteError && (
              <p role="alert">{backup.data.lastOffsiteError}</p>
            )}
            <p className="mt-2">
              Restore verification:{" "}
              {q.data?.restoreVerification
                ? `${q.data.restoreVerification.result} · ${date(q.data.restoreVerification.verified_at)}`
                : "No verification recorded in the app"}
            </p>
            <Link className="underline" href="/settings">
              Backup settings
            </Link>
            <RestoreEvidence />
          </>
        ) : (
          <p>Loading backup status…</p>
        )}
      </section>
    </div>
  );
}
