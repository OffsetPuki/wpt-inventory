import Modal from "@/components/Modal";
import OperationalStatus from '@/components/OperationalStatus';
import StorageReview from '@/components/StorageReview';
import RelationshipReview from '@/components/RelationshipReview';
import { useState } from "react";
import { MergeReview, CostReviews, RestoreEvidence } from "./suite-reviews";
import { Link } from "wouter";
import Header from "@/components/Header";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useSuiteQuery } from "@/lib/suite-query";
import { RetryBlock } from "@/components/RetryBlock";
export default function SuiteHealth() {
  const [pages,setPages]=useState<Record<string,number>>({});
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
  const q = useSuiteQuery(["suite-health",pages], "/api/suite/health?"+new URLSearchParams(Object.fromEntries(Object.entries(pages).map(([k,v])=>[k+'Page',String(v)])))),
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
  const pager=(kind:string)=>{const total=q.data?.totals?.[kind]||0,page=q.data?.pages?.[kind]||0,size=q.data?.pageSize||25;return total>size?<nav aria-label={`${kind} pages`} className="mt-3 flex flex-wrap items-center gap-3 text-sm"><button className="min-h-11 rounded-lg border px-3" disabled={!page} onClick={()=>setPages(p=>({...p,[kind]:page-1}))}>Previous</button><span>{page*size+1}–{Math.min((page+1)*size,total)} of {total}</span><button className="min-h-11 rounded-lg border px-3" disabled={(page+1)*size>=total} onClick={()=>setPages(p=>({...p,[kind]:page+1}))}>Next</button></nav>:null;};
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
                {q.data.mailFailureAttempts} failed email attempts in the last {q.data.mailWindowDays} days
              </p>
              <Link className="underline" href="/emails">
                Email settings & history
              </Link>
              <p className="mt-2">
                {q.data.totals.payments} unresolved payment exceptions
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
              ))}{pager('payments')}
            </section>
          </div>
          <section className="rounded-xl border p-5">
            <h2 className="mb-3 font-semibold">Pending & failed follow-ups</h2>
            <p className="mb-3 text-sm text-muted-foreground">{q.data.totals.outbox} unresolved items · Oldest problems first</p>
            {q.data.outbox
              .filter((r: any) => !["completed", "stopped"].includes(r.status))
              .map((r: any) => (
                <div className="border-t py-3" key={r.id}>
                  <p>
                    {r.subject || r.kind.replaceAll('-',' ')} · {r.status} · {r.attempts} attempts
                  </p>
                  <p className="break-words text-sm text-muted-foreground">{r.recipient || 'Open the source to check the recipient'} · Created {date(r.created_at)}</p>
                  {r.parent_id&&<p className="text-sm text-muted-foreground">One message · {r.producer_attempts} preparation attempts · {r.attempts} delivery attempts</p>}
                  <Link className="inline-flex min-h-11 items-center text-sm underline" href={r.href}>Open related record</Link>
                  {r.last_error && (
                    <p className="text-sm text-muted-foreground">
                      {r.last_error}
                    </p>
                  )}
                  {r.status !== "running" && (
                    <div className="mt-2 flex flex-wrap gap-4">
                      {["retry", "snooze", "stop"].map((action) => (
                        <button
                          key={action}
                          className="min-h-11 rounded-lg border px-3 capitalize"
                          disabled={retry.isPending || r.status==='review' && action==='retry'}
                          onClick={() => retry.mutate({ id: r.id, action })}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            {pager('outbox')}
            <p className="mt-3 text-xs text-muted-foreground">
              Completed email delivery jobs mean provider accepted. Inbox
              delivery is not assumed.
            </p>
          </section>
          <section className="rounded-xl border p-5">
            <h2 className="font-semibold">Record review</h2>
            <p className="text-sm text-muted-foreground">{q.data.totals.jobs} jobs to review</p>
            {q.data.unlinkedJobs.map((j: any) => (
              <Link
                className="block border-t py-3"
                href={`/project/${j.id}`}
                key={j.id}
              >
                {j.name} · {!j.client_id?'Choose the customer':j.billing_mode==='review'?'Choose how to bill this job':'Review settings'}
              </Link>
            ))}
            {pager('jobs')}
            {q.data.duplicateClients.map((g: any) => (
              <button
                key={g.ids}
                className="mt-2 block min-h-11 break-all text-left underline"
                onClick={() => setMerge(g.ids)}
              >
                Review possible duplicate customers: {g.contact}
              </button>
            ))}
            {pager('duplicates')}
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
            {pager('review')}
          </section>
          <RelationshipReview/>
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
            <div className="suite-modal-actions"><button
              className="rounded border px-4 py-2"
              disabled={resolve.isPending}
            >
              Record review
            </button></div>
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
      <OperationalStatus/>
      <StorageReview/>
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
