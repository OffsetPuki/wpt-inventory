export function RetryBlock({ query }: { query: any }) {
  return (
    <div role="alert" className="rounded-xl border p-4">
      <p>{query.error?.message || "Could not load this section."}</p>
      <button className="mt-2 underline" onClick={() => query.refetch()}>
        Retry
      </button>
    </div>
  );
}
