import { DEFAULT_PRICE_BOOK } from "@/quote/data/priceBook.js";
import { deepMerge } from "@/quote/lib/store.js";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useSuiteQuery } from "@/lib/suite-query";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { formatMoney } from "@/lib/format";
import { RetryBlock } from "@/components/RetryBlock";
import Modal from "@/components/Modal";

export function MergeReview({
  ids,
  close,
}: {
  ids: string;
  close: () => void;
}) {
  const list = ids.split(",").map(Number),
    [source, setSource] = useState(list[1]),
    [target, setTarget] = useState(list[0]),
    [reason, setReason] = useState("");
  const q = useSuiteQuery(
    ["suite-merge", source, target],
    `/api/suite/customer-merge?source=${source}&target=${target}`,
    source !== target,
  );
  const [requestKey] = useState(() => crypto.randomUUID());
  const save = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/suite/customer-merge",
      body: { source, target, reason, version: q.data.version, requestKey },
    }),
    successTitle: "Customer records connected",
    errorTitle: "Could not merge customers",
    onSuccess: close,
  });
  return (
    <Modal open onClose={close} title="Review duplicate customers">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p>
          The retained customer keeps its contact details. Jobs and documents
          are relinked; issued names, addresses and prices stay as written.
        </p>
        {[
          ["Retain customer", target, setTarget],
          ["Merge customer", source, setSource],
        ].map(([label, value, set]: any) => (
          <label className="block" key={label}>
            {label}
            <select
              className={inputCls}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
            >
              {list.map((id) => (
                <option key={id} value={id}>
                  Customer #{id}
                </option>
              ))}
            </select>
          </label>
        ))}
        {q.isError ? (
          <RetryBlock query={q} />
        ) : (
          q.data && (
            <>
              <p>
                <strong>{q.data.source.name}</strong> →{" "}
                <strong>{q.data.target.name}</strong>
              </p>
              <p>
                {q.data.source.email} → {q.data.target.email}
              </p>
              <ul>
                {q.data.references
                  .filter((r: any) => r.count)
                  .map((r: any) => (
                    <li key={r.table}>
                      {r.count}{" "}
                      {r.table
                        .replace(/^(crm_|pm_|fin_|mk_)/, "")
                        .replaceAll("_", " ")}
                    </li>
                  ))}
              </ul>
              <p>{q.data.quoteCount} quote links</p>
              <label className="block">
                Reason for merging
                <textarea
                  required
                  minLength={3}
                  className={inputCls}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className={primaryBtn}
                disabled={save.isPending || source === target}
              >
                Approve this merge
              </button>
            </>
          )
        )}
      </form>
    </Modal>
  );
}
export function ExtraBilling({
  action,
  projectId,
}: {
  action: any;
  projectId: number;
}) {
  const [open, setOpen] = useState(false),
    [invoiceId, setInvoice] = useState("");
  const [, navigate] = useLocation();
  const id = Number(action.event_key?.split(":")[1]);
  const q = useSuiteQuery<any[]>(
    ["finance-invoices", "extra", projectId],
    `/api/finance/invoices?projectId=${projectId}&status=draft`,
    open,
  );
  const [requestKey] = useState(() => crypto.randomUUID());
  const save = useApiMutation<any>({
    request: () => ({
      method: "POST",
      url: `/api/suite/change-orders/${id}/bill`,
      body: {
        requestKey,
        invoiceId: invoiceId ? Number(invoiceId) : null,
        reviewed: true,
      },
    }),
    errorTitle: "Could not bill extra",
    onSuccess: (v: any) => navigate(`/finance/invoices?invoice=${v.id}`),
  });
  return (
    <div className="border-t py-3">
      <p>{action.title}</p>
      <button className="mt-2 underline" onClick={() => setOpen(true)}>
        Review billing
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Bill approved extra">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p>
              {action.title}. This creates a draft for you to review before
              sending.
            </p>
            <label className="block">
              Invoice
              <select
                className={inputCls}
                value={invoiceId}
                onChange={(e) => setInvoice(e.target.value)}
              >
                <option value="">New draft invoice</option>
                {q.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} · {formatMoney(i.totalCents)}
                  </option>
                ))}
              </select>
            </label>
            {q.isError && <RetryBlock query={q} />}
            <p className="text-sm">
              Deductive extras must go on an existing draft. Check tax and
              billing terms before issuing the invoice.
            </p>
            <button className={primaryBtn} disabled={save.isPending}>
              Add approved extra
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
export function CostReviews() {
  const q = useSuiteQuery<any[]>(["suite-costs"], "/api/suite/costs"),
    book = useSuiteQuery(["quote-settings"], "/api/quotes/settings");
  const materials: any = deepMerge(
    DEFAULT_PRICE_BOOK,
    book.data?.priceBook || {},
  ).materials;
  const [selected, setSelected] = useState<any>(null),
    [field, setField] = useState(""),
    [price, setPrice] = useState("");
  const save = useApiMutation<any, { id: number; action: string }>({
    request: (v) => ({
      method: "POST",
      url: `/api/suite/costs/${v.id}`,
      body: {
        action: v.action,
        priceBookKey: field,
        expectedPrice: materials[field]?.cost,
        convertedPrice: Number(price),
      },
    }),
    errorTitle: "Could not review cost",
    successTitle: "Cost review saved",
    onSuccess: () => {
      setSelected(null);
      q.refetch();
      book.refetch();
    },
  });
  return (
    <section className="rounded-xl border p-5">
      <h2 className="font-semibold">Received material costs</h2>
      <p className="text-sm text-muted-foreground">
        Purchase costs are recorded automatically. Price-book changes need your
        review and never reprice saved quotes.
      </p>
      {q.isError ? (
        <RetryBlock query={q} />
      ) : (
        q.data?.map((p) => (
          <div className="border-t py-3" key={p.id}>
            <Link className="underline" href={`/item/${p.item_id}`}>
              {p.name}
            </Link>
            <p>
              {formatMoney(p.unit_cost_cents)} / {p.unit} · {p.supplier} ·{" "}
              {new Date(p.created_at).toLocaleDateString()}
            </p>
            <div className="flex gap-4">
              <button
                className="underline"
                onClick={() => {
                  setSelected(p);
                  setField(p.material_key || "");
                  setPrice(String(p.unit_cost_cents / 100));
                }}
              >
                Review price book
              </button>
              <button
                className="underline"
                disabled={save.isPending}
                onClick={() => save.mutate({ id: p.id, action: "dismiss" })}
              >
                Keep current prices
              </button>
            </div>
          </div>
        ))
      )}
      {selected && (
        <Modal
          open
          title="Review price-book cost"
          onClose={() => setSelected(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ id: selected.id, action: "approve" });
            }}
          >
            <p>
              {selected.name}: {formatMoney(selected.unit_cost_cents)} per{" "}
              {selected.unit} received from {selected.supplier}.
            </p>
            <label className="block">
              Price-book field
              <select
                required
                className={inputCls}
                value={field}
                onChange={(e) => setField(e.target.value)}
              >
                <option value="">Choose the matching field</option>
                {Object.entries(materials).map(([k, v]: any) => (
                  <option key={k} value={k}>
                    {v.name} · {v.cost} / {v.unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              New cost in this price-book field’s units
              <input
                required
                min="0"
                step="any"
                type="number"
                className={inputCls}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <p className="text-sm">
              Confirm units before saving; a price per foot may differ from a
              price per piece.
            </p>
            <button className={primaryBtn} disabled={save.isPending || !field}>
              Approve price update
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function RestoreEvidence() {
  const [form, set] = useState({
    backupName: "",
    sha256: "",
    result: "passed",
    notes: "",
  });
  const save = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/suite/restore-checks",
      body: form,
    }),
    successTitle: "Restore evidence recorded",
    errorTitle: "Could not record restore",
  });
  return (
    <details className="mt-4">
      <summary className="cursor-pointer">
        Record a completed restore test
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm">
          Record an actual restore into an isolated environment. This is
          owner-reported evidence, not an automatic test.
        </p>
        {[
          ["backupName", "Backup name"],
          ["sha256", "Backup SHA-256"],
          ["notes", "Checks performed and result"],
        ].map(([key, label]) => (
          <label className="block" key={key}>
            {label}
            <input
              required
              className={inputCls}
              value={(form as any)[key]}
              onChange={(e) => set({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="block">
          Result
          <select
            className={inputCls}
            value={form.result}
            onChange={(e) => set({ ...form, result: e.target.value })}
          >
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <button className={secondaryBtn} disabled={save.isPending}>
          Record test evidence
        </button>
      </form>
    </details>
  );
}
export function TimeReview() {
  const q = useSuiteQuery(["suite-time-review"], "/api/suite/time-review");
  if (q.isError) return <RetryBlock query={q} />;
  if (!q.data || (!q.data.unassigned.length && !q.data.running.length))
    return null;
  return (
    <section className="rounded-xl border p-5">
      <h2 className="font-semibold">Time to review</h2>
      {q.data.running.map((t: any) => (
        <p key={t.id}>{t.name}: timer has been running over 12 hours.</p>
      ))}
      {q.data.unassigned.length > 0 && (
        <p>{q.data.unassigned.length} recent time entries need a job link.</p>
      )}
      <Link className="underline" href="/pm/time">
        Review time entries
      </Link>
    </section>
  );
}
