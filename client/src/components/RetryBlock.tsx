export function RetryBlock({ query }: { query: any }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-5">
      <p>{query.error?.message || "Could not load this section."}</p>
      <button className="mt-3 min-h-11 rounded-lg border px-4 font-medium hover:bg-accent" onClick={() => query.refetch()}>
        Retry
      </button>
    </div>
  );
}
