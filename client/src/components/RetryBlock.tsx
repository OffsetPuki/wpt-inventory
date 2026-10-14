import SupportReference from './SupportReference';
export function RetryBlock({ query }: { query: any }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-5">
      <p>{query.error?.message || "Could not load this section."}</p>
      <SupportReference reference={query.error?.supportReference}/>
      <button type="button" disabled={query.isFetching} className="mt-3 min-h-11 rounded-lg border px-4 font-medium hover:bg-accent" onClick={() => void query.refetch()}>
        {query.isFetching ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
