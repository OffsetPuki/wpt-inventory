import DeleteRecordReview from '@/components/DeleteRecordReview';
import {L} from '@/lib/language';
import CustomerAccount from '@/components/CustomerAccount';
import CustomerHistory from '@/components/CustomerHistory';
import RecordCommunication from '@/components/RecordCommunication';
import ConnectedRecords from '@/components/ConnectedRecords';
import {ActiveFilters} from '@/components/ActiveFilters';
import {MergeReview} from '@/pages/suite-reviews';
import {Link} from 'wouter';
import RelatedPreviews from '@/components/RelatedPreviews';
import { useDialogDraft } from '@/lib/dialog-draft';
import {PageButtons} from '@/lib/list-page';
import {usePageFilters} from '@/hooks/usePageFilters';
import { RetryBlock } from '@/components/RetryBlock';
import { useRecordLink } from "@/lib/record-link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { useApiMutation } from "@/hooks/useApiMutation";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { formatDate, formatDateTime, formatMoney, parseJsonArray } from "@/lib/format";
import {
  LEAD_STAGE_LABELS,
  ACTIVITY_KIND_LABELS,
  type Client,
  type Lead,
  type LeadStage,
  type CrmActivity,
} from "@shared/crm-schema";
import { type Project, type ProjectStatus } from "@shared/schema";
import { Loader2, Plus, Contact, Search, Archive, ArchiveRestore, Pencil, StickyNote } from "lucide-react";

const LEAD_STAGE_TONE: Record<LeadStage, ChipTone> = {
  new: "zinc",
  contacted: "blue",
  quote_sent: "blue",
  follow_up: "amber",
  won: "emerald",
  lost: "red",
};

const PROJECT_STATUS_TONE: Record<ProjectStatus, ChipTone> = {
  active: "blue",
  done: "emerald",
  on_hold: "amber",
};

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  done: "Done",
  on_hold: "On Hold",
};

// Derived server-side (crm client detail) — matches Finance's status set.
const INVOICE_STATUS_TONE: Record<string, ChipTone> = {
  draft: "zinc",
  sent: "blue",
  partial: "amber",
  paid: "emerald",
  overdue: "red",
  void: "zinc",
};

// Money still owed to us — same rule as Finance's receivable statuses.
const OWED_STATUSES = ["sent", "partial", "overdue"];

function parseTags(json: string | null): string[] {
  return parseJsonArray(json).filter((t): t is string => typeof t === "string" && !!t);
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function ClientFormModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [preferredLanguage, setPreferredLanguage] = useState(client?.preferredLanguage ?? "en");
  const [company, setCompany] = useState(client?.company ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [city, setCity] = useState(client?.city ?? "");
  const [zip, setZip] = useState(client?.zip ?? "");
  const [tags, setTags] = useState(parseTags(client?.tags ?? null).join(", "));
  const [notes, setNotes] = useState(client?.notes ?? "");

  const recovered=useDialogDraft(`ClientFormModal:${client?.id||"new"}`,true,{name,preferredLanguage,company,email,phone,address,city,zip,tags,notes},v=>{if(Object.hasOwn(v,"name"))setName(v.name);if(Object.hasOwn(v,"preferredLanguage"))setPreferredLanguage(v.preferredLanguage);if(Object.hasOwn(v,"company"))setCompany(v.company);if(Object.hasOwn(v,"email"))setEmail(v.email);if(Object.hasOwn(v,"phone"))setPhone(v.phone);if(Object.hasOwn(v,"address"))setAddress(v.address);if(Object.hasOwn(v,"city"))setCity(v.city);if(Object.hasOwn(v,"zip"))setZip(v.zip);if(Object.hasOwn(v,"tags"))setTags(v.tags);if(Object.hasOwn(v,"notes"))setNotes(v.notes);},(client as any)?._version,{fieldsInitialized:true});
  const save = useApiMutation({
    request: () => {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        name: name.trim(),
        preferredLanguage,
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        zip: zip.trim() || null,
        tags: tagList.length > 0 ? JSON.stringify(tagList) : null,
        notes: notes.trim() || null,
      };
      return client
        ? { method: "PATCH", expectedVersion:recovered.expectedVersion, url: `/api/crm/clients/${client.id}`, body }
        : { method: "POST", url: "/api/crm/clients", body };
    },
    invalidate: [["crm-clients"], ["crm-client-detail"]],
    successTitle: client ? "Customer updated" : "Customer created",
    errorTitle: "Could not save customer",
    onSuccess: () => {recovered.clear();onClose();},
  });

  return (
    <Modal preservesDraft open busy={save.isPending} onClose={onClose} title={client ? "Edit customer" : "New customer"} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            toast({ variant: "destructive", title: "Name is required" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {recovered.notice}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground"><L>{"Name"}</L></span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground"><L>{"Company"}</L></span>
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground"><L>{"Email"}</L></span>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground"><L>{"Phone"}</L></span>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <details className="rounded-xl border border-border p-4"><summary className="text-sm font-medium"><L>{"Address, language & notes"}</L></summary><div className="mt-4 space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground"><L>{"Customer language"}</L></span>
          <select className={inputCls} value={preferredLanguage} onChange={e=>setPreferredLanguage(e.target.value as "en"|"es")}><option value="en"><L>{"English"}</L></option><option value="es">Español</option></select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground"><L>{"Address"}</L></span>
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground"><L>{"City"}</L></span>
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground"><L>{"ZIP"}</L></span>
            <input className={inputCls} value={zip} onChange={(e) => setZip(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground"><L>{"Tags (comma-separated)"}</L></span>
          <input className={inputCls} placeholder="vip, repeat, commercial" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground"><L>{"Notes"}</L></span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        </div></details>
        <div className="suite-modal-actions"><button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {client ? "Save changes" : "Create customer"}
        </button></div>
      </form>
    </Modal>
  );
}

// ─── Detail dialog ────────────────────────────────────────────────────────────

interface ClientInvoice {
  id: number;
  number: string;
  status: string;
  totalCents: number;
  balanceCents: number;
  projectId?: number | null;
  createdAt?: number;
  dueDate: string | null;
}

interface ClientDetail {
  client: Client;
  leads: Lead[];
  activities: CrmActivity[];
  projects: Project[];
  invoices: ClientInvoice[]; // empty for non-elevated roles
  quotes:{id:number;number:string;status:string;totalCents:number;createdAt?:number}[];
  relatedCustomers:{id:number;name:string;company:string|null;email:string|null;phone:string|null}[];
  reviewCount: number;
}

function ClientDetailModal({
  clientId,
  onEdit,
  onClose,
}: {
  clientId: number;
  onEdit: (client: Client) => void;
  onClose: () => void;
}) {
  const { isElevated } = useAuth();
  const [note, setNote] = useState("");
  const [mergeId,setMergeId]=useState<number|null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<ClientDetail>({
    queryKey: ["crm-client-detail", clientId],
    queryFn: async () => (await apiRequest("GET", `/api/crm/clients/${clientId}/detail`)).json(),
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/crm/clients/${clientId}` }),
    invalidate: [["crm-clients"]],
    successTitle: "Client deleted",
    errorTitle: "Could not delete",
    onSuccess: () => onClose(),
  });

  const logNote = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/crm/activities",
      body: {
        entityType: "client",
        entityId: clientId,
        kind: "note",
        notes: note.trim() || undefined,
      },
    }),
    invalidate: [["crm-client-detail", clientId]],
    successTitle: "Note logged",
    errorTitle: "Could not log note",
    onSuccess: () => setNote(""),
  });

  const client = data?.client;
  if(mergeId!==null)return <MergeReview ids={`${clientId},${mergeId}`} close={()=>setMergeId(null)} onMerged={onClose}/>;

  return (
    <Modal open busy={logNote.isPending || del.isPending} hasUnsavedChanges={!!note.trim()} onClose={onClose} title={client?.name ?? "Client"} maxWidth="max-w-2xl">
      {isError ? <RetryBlock query={{ error, refetch }} /> : isLoading || !data || !client ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {client.company && (
                  <p><span className="text-muted-foreground"><L>{"Company:"}</L>{" "}</span>{client.company}</p>
                )}
                {client.email && (
                  <p><span className="text-muted-foreground"><L>{"Email:"}</L>{" "}</span>{client.email}</p>
                )}
                {client.phone && (
                  <p><span className="text-muted-foreground"><L>{"Phone:"}</L>{" "}</span>{client.phone}</p>
                )}
                {(client.city || client.zip) && (
                  <p>
                    <span className="text-muted-foreground"><L>{"Location:"}</L>{" "}</span>
                    {[client.address, client.city, client.zip].filter(Boolean).join(", ")}
                  </p>
                )}
                <p>
                  <span className="text-muted-foreground"><L>{"Since:"}</L>{" "}</span>
                  {formatDate(client.createdAt as any)}
                </p>
                {data.reviewCount > 0 && (
                  <p>
                    <span className="text-muted-foreground"><L>{"Reviews:"}</L>{" "}</span>
                    <span className="text-amber-500">★</span> {data.reviewCount} {" "}<L>{"review"}</L>{data.reviewCount === 1 ? "" : "s"}
                  </p>
                )}
                {client.notes && (
                  <p className="sm:col-span-2">
                    <span className="text-muted-foreground"><L>{"Notes:"}</L>{" "}</span>{client.notes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => onEdit(client)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
                >
                  <Pencil className="h-4 w-4" /> <L>{"Edit"}</L>
                </button>
                {isElevated && (
                  <DeleteRecordReview kind="customer" id={clientId} name={client.name} busy={del.isPending} error={del.error?.message} onConfirm={()=>del.mutate()}/>
                )}
              </div>
            </div>
            {parseTags(client.tags).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {parseTags(client.tags).map((t) => (
                  <Chip key={t} className="bg-muted text-muted-foreground">{t}</Chip>
                ))}
              </div>
            )}
          </div>

          <ConnectedRecords kind="customer" id={client.id}/>
          {isElevated&&<CustomerHistory data={data} onNavigate={onClose}/>}
          {isElevated&&<RecordCommunication key={client.id} kind="customer" id={client.id}/>}
          {isElevated&&<CustomerAccount key={client.id} id={client.id}/>}
{isElevated && <RelatedPreviews clientId={client.id}/>}
          <details className="space-y-4"><summary className="min-h-11 cursor-pointer py-2 font-medium"><L>{"All records"}</L></summary>
          {isElevated&&!!data.relatedCustomers?.length&&<section className="rounded-xl border border-amber-300 bg-amber-50/30 p-4"><h3 className="font-semibold"><L>{"Related customer records"}</L></h3><p className="mt-1 text-sm text-muted-foreground"><L>{"These records share a company or email. If they belong to the same customer, combine them to keep quotes, jobs, and invoices in one history."}</L></p>{data.relatedCustomers.map(other=><div key={other.id} className="mt-3 space-y-2"><p className="text-sm"><strong>{other.name}</strong>{other.company&&` · ${other.company}`}<br/>{[other.email,other.phone].filter(Boolean).join(' · ')}</p><button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={()=>setMergeId(other.id)}><L>{"Review combining with"}</L>{" "}{other.name}</button></div>)}</section>}
          {isElevated&&<section><h3 className="mb-2 text-sm font-medium text-muted-foreground"><L>{"Quotes"}</L></h3>{!data.quotes?.length?<p className="text-sm text-muted-foreground"><L>{"No quotes linked to this customer."}</L></p>:<ul className="divide-y">{data.quotes.map(q=><li key={q.id}><Link href={`/crm/quotes?quote=${q.id}`} onClick={onClose} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-medium underline">{q.number}</span><span className="capitalize">{q.status} · {formatMoney(q.totalCents)}</span></Link></li>)}</ul>}</section>}
          {isElevated && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground"><L>{"Invoices"}</L></h3>
              {data.invoices.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground"><L>{"No invoices for this client"}</L></p>
              ) : (
                <>
                  {(() => {
                    const owedCents = data.invoices
                      .filter((inv) => OWED_STATUSES.includes(inv.status))
                      .reduce((s, inv) => s + inv.balanceCents, 0);
                    return (
                      <p className={`mb-1 text-sm font-medium ${owedCents > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        <L>{"Balance owed:"}</L>{" "}{formatMoney(owedCents)}
                      </p>
                    );
                  })()}
                  <ul className="divide-y divide-border">
                    {data.invoices.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0 truncate text-sm text-foreground">
                          <Link href={`/finance/invoices?invoice=${inv.id}`} onClick={onClose} className="font-mono text-xs underline">{inv.number}</Link>
                          {inv.dueDate && (
                            <span className="ml-2 text-xs text-muted-foreground"><L>{"due"}</L>{" "}{formatDate(inv.dueDate)}</span>
                          )}
                        </span>
                        <div className="flex shrink-0 items-center gap-3">
                          <Chip tone={INVOICE_STATUS_TONE[inv.status] ?? "zinc"}>
                            {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                          </Chip>
                          <span className="text-sm tabular-nums text-foreground">
                            {formatMoney(inv.totalCents)}
                            {inv.balanceCents > 0 && inv.status !== "void" && inv.balanceCents !== inv.totalCents && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({formatMoney(inv.balanceCents)} {" "}<L>{"left)"}</L>{" "}</span>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground"><L>{"Leads"}</L></h3>
            {data.leads.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground"><L>{"No leads linked to this client"}</L></p>
            ) : (
              <ul className="divide-y divide-border">
                {data.leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/crm/leads?lead=${l.id}`} className="min-w-0 py-2 text-sm font-medium text-primary underline">{l.name}</Link>
                    <div className="flex shrink-0 items-center gap-3">
                      <Chip tone={LEAD_STAGE_TONE[l.stage]}>
                        {LEAD_STAGE_LABELS[l.stage]}
                      </Chip>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {formatMoney(l.stage === "won" ? l.revenueClosedCents : l.estimatedValueCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground"><L>{"Jobs"}</L></h3>
            {data.projects.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground"><L>{"No jobs linked to this client"}</L></p>
            ) : (
              <ul className="divide-y divide-border">
                {data.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/project/${p.id}`} className="min-w-0 py-2 text-sm text-primary underline">
                      <span className="font-mono text-xs text-muted-foreground">{p.jobNumber}</span>{" "}
                      {p.name}
                    </Link>
                    <Chip tone={PROJECT_STATUS_TONE[p.status]} className="shrink-0">
                      {PROJECT_STATUS_LABEL[p.status]}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>

          </details>
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground"><L>{"Contact activity"}</L></h3>
            <div className="mb-3 flex items-center gap-2">
              <input
                className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                placeholder="Add a note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                disabled={logNote.isPending || !note.trim()}
                onClick={() => logNote.mutate()}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
              >
                <StickyNote className="h-4 w-4" /> {" "}<L>{"Log note"}</L>{" "}</button>
            </div>
            {data.activities.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground"><L>{"No activity yet"}</L></p>
            ) : (
              <ul className="divide-y divide-border">
                {data.activities.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Chip className="bg-muted text-muted-foreground">
                        {ACTIVITY_KIND_LABELS[a.kind]}
                      </Chip>
                      {a.notes && <p className="mt-1 break-words text-sm text-foreground">{a.notes}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt as any)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const {isElevated}=useAuth();
  const [filters,setFilters]=usePageFilters({q:"",status:"active",page:"0"});
  const q=filters.q,setQ=(q:string)=>setFilters({q});
  const status=filters.status,setStatus=(status:string)=>setFilters({status});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  useRecordLink("client", "/api/crm/clients", row=>setDetailId(row.id));

  const page=Math.max(0,Math.floor(Number(filters.page)||0)),setPage=(page:number)=>setFilters({page:String(page)});
  const params = new URLSearchParams();
    params.set('page',String(page));params.set('limit','50');
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  const url = `/api/crm/clients${params.toString() ? `?${params.toString()}` : ""}`;

  const { data: clients = [], isLoading,isError,error,refetch } = useQuery<Client[]>({
    queryKey: ["crm-clients", q.trim(), status,page],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

  const setClientStatus = useApiMutation<any, { id: number; next: "active" | "archived" }>({
    request: ({ id, next }) => ({
      method: "PATCH",
      url: `/api/crm/clients/${id}`,
      body: { status: next },
    }),
    invalidate: [["crm-clients"]],
    successTitle: (_data, vars) =>
      vars.next === "archived" ? "Client archived" : "Client restored",
    errorTitle: "Could not update customer",
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Customers" description="Customer records, history, and contact info">
        {isElevated&&<Link href="/trash" className="flex min-h-11 items-center rounded-xl border px-4 text-sm"><L>{"View Trash"}</L></Link>}
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          <L>{"New customer"}</L>{" "}</button>
      </Header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers…"
            className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active"><L>{"Active"}</L></option>
          <option value="archived"><L>{"Archived"}</L></option>
          <option value=""><L>{"All"}</L></option>
        </select>
      </div>

      <ActiveFilters shared filters={[status&&`Status: ${status}`,q&&`Search: ${q}`]} onReset={()=>{setStatus('');setQ('');setPage(0);}}/>
      <PageButtons page={page} setPage={setPage} count={clients.length}/>
      {isError ? <RetryBlock query={{error,refetch}}/> : isLoading ? (
        <LoadingBlock />
      ) : clients.length === 0 ? (
        <EmptyState icon={Contact} message="No customers yet">
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            <L>{"Add your first client"}</L>{" "}</button>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium"><L>{"Name"}</L></th>
                <th className="px-4 py-3 font-medium"><L>{"Company"}</L></th>
                <th className="px-4 py-3 font-medium"><L>{"Contact"}</L></th>
                <th className="px-4 py-3 font-medium"><L>{"City"}</L></th>
                <th className="px-4 py-3 font-medium"><L>{"Tags"}</L></th>
                <th className="px-4 py-3 font-medium"><L>{"Status"}</L></th>
                <th className="px-4 py-3 text-right font-medium"><L>{"Actions"}</L></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setDetailId(c.id)}
                  className="cursor-pointer hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.company ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.email || c.phone ? (
                      <span>{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.city ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {parseTags(c.tags).length === 0
                        ? "—"
                        : parseTags(c.tags).map((t) => (
                            <Chip key={t} className="bg-muted text-muted-foreground">
                              {t}
                            </Chip>
                          ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone={c.status === "active" ? "emerald" : "zinc"}>
                      {c.status === "active" ? "Active" : "Archived"}
                    </Chip>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setClientStatus.mutate({
                          id: c.id,
                          next: c.status === "active" ? "archived" : "active",
                        });
                      }}
                      disabled={setClientStatus.isPending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:border-primary disabled:opacity-60"
                    >
                      {c.status === "active" ? (
                        <>
                          <Archive className="h-3.5 w-3.5" /> <L>{"Archive"}</L>
                        </>
                      ) : (
                        <>
                          <ArchiveRestore className="h-3.5 w-3.5" /> <L>{"Restore"}</L>
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <ClientFormModal
          key={editing?.id ?? "new"}
          client={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}
      {detailId != null && !formOpen && (
        <ClientDetailModal
          clientId={detailId}
          onEdit={(client) => {
            setEditing(client);
            setFormOpen(true);
          }}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
