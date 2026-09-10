import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import Modal from "./Modal";
import { inputCls } from "@/lib/ui-styles";

type Exception = {
  id: number;
  invoice_id: number | null;
  invoice_number: string | null;
  kind: string;
  details: string;
  created_at: number;
};
export default function PaymentExceptions() {
  const [selected, setSelected] = useState<Exception | null>(null);
  const [note, setNote] = useState("");
  const {
    data = [],
    isError,
    refetch,
  } = useQuery<Exception[]>({
    queryKey: ["payment-exceptions"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/finance/payment-exceptions")).json(),
  });
  const resolve = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/finance/payment-exceptions/${selected?.id}/resolve`,
      body: { note },
    }),
    invalidate: [["payment-exceptions"]],
    successTitle: "Review recorded",
    errorTitle: "Could not record review",
    onSuccess: () => setSelected(null),
  });
  if (isError)
    return (
      <p role="alert" className="mb-6 rounded-xl border p-4">
        Payment reviews could not load.{" "}
        <button className="underline" onClick={() => refetch()}>
          Retry
        </button>
      </p>
    );
  if (!data.length) return null;
  return (
    <section className="mb-6 rounded-xl border border-amber-500/40 bg-card p-5">
      <h2 className="font-semibold">Payments needing review ({data.length})</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Compare these events with Stripe and the invoice. Record any refund or
        adjustment before closing the review.
      </p>
      {data.map((e) => (
        <div
          key={e.id}
          className="mt-3 flex flex-wrap items-center gap-3 text-sm"
        >
          <span>{e.kind.replaceAll("_", " ")}</span>
          {e.invoice_id && (
            <a
              className="underline"
              href={`/#/finance/invoices?invoice=${e.invoice_id}`}
            >
              {e.invoice_number || `Invoice ${e.invoice_id}`}
            </a>
          )}
          <button
            className="underline"
            onClick={() => {
              setNote("");
              setSelected(e);
            }}
          >
            Review
          </button>
        </div>
      ))}
      {selected && (
        <Modal
          open
          title="Review payment exception"
          onClose={() => setSelected(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              resolve.mutate();
            }}
          >
            <p className="break-words text-sm">{selected.details}</p>
            <label className="block text-sm">
              What did you verify or correct?
              <textarea
                required
                minLength={3}
                maxLength={2000}
                className={inputCls}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              disabled={resolve.isPending}
              className="rounded-xl bg-primary px-4 py-3 text-primary-foreground"
            >
              Record review and close
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
