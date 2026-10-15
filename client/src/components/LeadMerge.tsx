import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from './Modal';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useApiMutation } from '@/hooks/useApiMutation';
import { inputCls } from '@/lib/ui-styles';
import { formatMoney } from '@/lib/format';
import { LEAD_STAGE_LABELS, LEAD_SOURCE_LABELS, type Lead } from '@shared/crm-schema';
import type { LeadMergePreview, MergeLeadSummary } from '@shared/lead-merge';

const button = 'min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50';
const rank = { new: 0, contacted: 1, quote_sent: 2, follow_up: 3, lost: 4, won: 5 };
function LeadCard({ lead }: { lead: MergeLeadSummary }) {
  return <div className="min-w-0 space-y-1 text-sm">
    <p className="font-semibold">{lead.name} · #{lead.id}</p>
    <p>{LEAD_STAGE_LABELS[lead.stage]} · {LEAD_SOURCE_LABELS[lead.source]}</p>
    <p className="break-words text-muted-foreground">{lead.service || 'Service not added'} · {lead.phone || lead.email || 'No contact details'}</p>
    <p>{lead.estimatedValueCents ? `Estimate: ${formatMoney(lead.estimatedValueCents)}` : 'Estimate not set'}{lead.stage === 'won' ? ` · Won: ${formatMoney(lead.revenueClosedCents)}` : ''}</p>
  </div>;
}
export default function LeadMerge({ lead, onClose, onMerged }: { lead: Lead; onClose: () => void; onMerged: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const [other, setOther] = useState<MergeLeadSummary | null>(null);
  const [keep, setKeep] = useState(lead.id);
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const candidates = useQuery<MergeLeadSummary[]>({
    queryKey: ['lead-merge-candidates', lead.id, search],
    queryFn: async ({ signal }) => (await apiRequest('GET', `/api/crm/lead-merge/candidates?lead=${lead.id}&q=${encodeURIComponent(search)}`, undefined, { signal })).json(),
    enabled: !other, staleTime: 0,
  });
  const source = other ? (keep === lead.id ? other.id : lead.id) : null;
  const preview = useQuery<LeadMergePreview>({
    queryKey: ['lead-merge-preview', source, keep],
    queryFn: async ({ signal }) => (await apiRequest('GET', `/api/crm/lead-merge/preview?source=${source}&target=${keep}`, undefined, { signal })).json(),
    enabled: !!other, staleTime: 0, refetchOnWindowFocus: false,
  });
  const merge = useApiMutation<{ id: number }>({
    request: () => ({ method: 'POST', url: '/api/crm/lead-merge', body: { source, target: keep, version: preview.data!.version, requestKey, reviewed: true } }),
    errorTitle: 'Could not merge leads', successTitle: 'Leads merged — everything is together',
    onSuccess: async data => {
      // Fetch the canonical record before reopening, including when keeping the
      // current record. Otherwise its old form values can survive the merge.
      await queryClient.invalidateQueries();
      onMerged(data.id);
    },
  });
  const refresh = () => { setConfirmed(false); setRequestKey(crypto.randomUUID()); merge.reset(); void preview.refetch(); };
  const select = (candidate: MergeLeadSummary) => { setOther(candidate); setKeep(rank[candidate.stage] > rank[lead.stage] ? candidate.id : lead.id); setConfirmed(false); setRequestKey(crypto.randomUUID()); merge.reset(); };
  return <Modal open title="Merge duplicate leads" onClose={onClose} busy={merge.isPending} hasUnsavedChanges={false} maxWidth="max-w-xl" footer={<div className="flex flex-wrap justify-between gap-2">
    <button type="button" className={button} disabled={merge.isPending} onClick={() => { if (other) { setOther(null); setConfirmed(false); merge.reset(); } else onClose(); }}>{other ? 'Back' : 'Cancel'}</button>
    {other && <button type="button" className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!confirmed || !preview.data || preview.isFetching || preview.isError || merge.isPending || (merge.error as any)?.status === 409} onClick={() => merge.mutate()}>{merge.isPending ? 'Merging…' : 'Merge leads'}</button>}
  </div>}>
    {!other ? <div className="space-y-4">
      <p className="text-sm">Combine a duplicate request with <strong>{lead.name}</strong>. Separate jobs from the same customer should stay separate.</p>
      <label className="block space-y-1 text-sm"><span>Find the other lead</span><input className={inputCls} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone, email, or lead number" /></label>
      <p className="text-xs text-muted-foreground">{search ? 'Results from this business' : 'Possible duplicates based on phone, email, or name'}</p>
      {candidates.isPending ? <p role="status">Finding leads…</p> : candidates.isError ? <div role="alert"><p>{candidates.error.message}</p><button className={button} onClick={() => candidates.refetch()}>Try again</button></div> : candidates.data?.length ? <div className="space-y-2">{candidates.data.map(candidate => <button key={candidate.id} type="button" className="w-full rounded-xl border border-border p-3 text-left hover:bg-accent" onClick={() => select(candidate)}>
        {candidate.match && <p className="mb-2 text-xs font-semibold text-primary">{candidate.match}</p>}<LeadCard lead={candidate} /><p className="mt-2 text-sm font-medium text-primary">Review merge</p>
      </button>)}</div> : <p className="text-sm text-muted-foreground">No matching leads. Try searching for the other request.</p>}
    </div> : <div className="space-y-4">
      <p className="text-sm font-medium">Which lead should stay?</p>
      <p className="text-sm text-muted-foreground">Its status and values will stay. Missing contact and project details will be filled in. Other details are saved in Notes.</p>
      {preview.isPending ? <p role="status">Preparing preview…</p> : preview.isError ? <div role="alert"><p>{preview.error.message}</p><button className={button} onClick={refresh}>Refresh preview</button></div> : preview.data && <>
        <div role="radiogroup" aria-label="Lead to keep" className="space-y-2">
          {[preview.data.target, preview.data.source].sort((a,b) => a.id - b.id).map(item => <label key={item.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${keep === item.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <input type="radio" name="keep-lead" className="mt-1 h-4 w-4 shrink-0" checked={keep === item.id} disabled={merge.isPending} onChange={() => { setKeep(item.id); setConfirmed(false); setRequestKey(crypto.randomUUID()); merge.reset(); }} aria-label={`Keep lead #${item.id}`} />
            <LeadCard lead={item} />
          </label>)}
        </div>
        <div className="rounded-xl bg-muted p-3 text-sm space-y-1"><p className="font-semibold">Together in one lead</p><p>Both requests and all notes and history.</p><p>{preview.data.photos} photos · {preview.data.designs} designs · {preview.data.quotes} quotes · {preview.data.jobs} jobs · {preview.data.invoices} invoices · {preview.data.tasks} tasks</p><p className="text-muted-foreground">Quotes, payments, and invoice amounts stay unchanged. Existing links open the combined lead.</p></div>
        {preview.data.differences.length > 0 && <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">Different details ({preview.data.differences.length})</summary><ul className="space-y-2">{preview.data.differences.map(d => <li key={d.label} className="break-words"><strong>{d.label}:</strong> {d.kept || 'Not set'} <span className="text-muted-foreground">· Other request: {d.other}</span></li>)}</ul></details>}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={confirmed} disabled={merge.isPending || preview.isFetching} onChange={e => setConfirmed(e.target.checked)} /><span>These are the same request. Combine them into lead #{keep}. This cannot be undone here.</span></label>
      </>}
      {merge.isError && <div role="alert" className="space-y-2 text-sm"><p>{merge.error.message}</p>{(merge.error as any).status === 409 && <button className={button} onClick={refresh}>Refresh preview</button>}</div>}
    </div>}
  </Modal>;
}
