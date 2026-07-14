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
  ESTIMATE_STATUS_LABELS,
  ACTIVITY_KIND_LABELS,
  type Client,
  type Lead,
  type LeadStage,
  type Estimate,
  type EstimateStatus,
  type CrmActivity,
} from "@shared/crm-schema";
import { type Project, type ProjectStatus } from "@shared/schema";
import { Loader2, Plus, Contact, Search, Archive, ArchiveRestore, Pencil, StickyNote, Trash2 } from "lucide-react";

const LEAD_STAGE_TONE: Record<LeadStage, ChipTone> = {
  new: "zinc",
  contacted: "blue",
  quote_sent: "blue",
  follow_up: "amber",
  won: "emerald",
  lost: "red",
};

const ESTIMATE_STATUS_TONE: Record<EstimateStatus, ChipTone> = {
  draft: "zinc",
  sent: "blue",
  accepted: "emerald",
  declined: "red",
  expired: "amber",
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

function parseTags(json: string | null): string[] {
  return parseJsonArray(json).filter((t): t is string => typeof t === "string" && !!t);
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function ClientFormModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [company, setCompany] = useState(client?.company ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [city, setCity] = useState(client?.city ?? "");
  const [zip, setZip] = useState(client?.zip ?? "");
  const [tags, setTags] = useState(parseTags(client?.tags ?? null).join(", "));
  const [notes, setNotes] = useState(client?.notes ?? "");

  const save = useApiMutation({
    request: () => {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        name: name.trim(),
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
        ? { method: "PATCH", url: `/api/crm/clients/${client.id}`, body }
        : { method: "POST", url: "/api/crm/clients", body };
    },
    invalidate: [["crm-clients"], ["crm-client-detail"]],
    successTitle: client ? "Client updated" : "Client created",
    errorTitle: "Could not save client",
    onSuccess: () => onClose(),
  });

  return (
    <Modal open onClose={onClose} title={client ? "Edit client" : "New client"} maxWidth="max-w-lg">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Company</span>
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email</span>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Phone</span>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Address</span>
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">City</span>
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">ZIP</span>
            <input className={inputCls} value={zip} onChange={(e) => setZip(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Tags (comma-separated)</span>
          <input className={inputCls} placeholder="vip, repeat, commercial" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {client ? "Save changes" : "Create client"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Detail dialog ────────────────────────────────────────────────────────────

interface ClientDetail {
  client: Client;
  leads: Lead[];
  estimates: Estimate[];
  activities: CrmActivity[];
  projects: Project[];
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

  const { data, isLoading } = useQuery<ClientDetail>({
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

  return (
    <Modal open onClose={onClose} title={client?.name ?? "Client"} maxWidth="max-w-2xl">
      {isLoading || !data || !client ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {client.company && (
                  <p><span className="text-muted-foreground">Company: </span>{client.company}</p>
                )}
                {client.email && (
                  <p><span className="text-muted-foreground">Email: </span>{client.email}</p>
                )}
                {client.phone && (
                  <p><span className="text-muted-foreground">Phone: </span>{client.phone}</p>
                )}
                {(client.city || client.zip) && (
                  <p>
                    <span className="text-muted-foreground">Location: </span>
                    {[client.address, client.city, client.zip].filter(Boolean).join(", ")}
                  </p>
                )}
                <p>
                  <span className="text-muted-foreground">Since: </span>
                  {formatDate(client.createdAt as any)}
                </p>
                {client.notes && (
                  <p className="sm:col-span-2">
                    <span className="text-muted-foreground">Notes: </span>{client.notes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => onEdit(client)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
                {isElevated && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete client "${client.name}"? This can't be undone from the app. Their jobs and invoices are kept (the name still shows on them).`)) {
                        del.mutate();
                      }
                    }}
                    disabled={del.isPending}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete
                  </button>
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

          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Leads</h3>
            {data.leads.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No leads linked to this client</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{l.name}</span>
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
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Estimates</h3>
            {data.estimates.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No estimates for this client</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.estimates.map((est) => (
                  <li key={est.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">{est.number}</span>{" "}
                      {est.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-3">
                      <Chip tone={ESTIMATE_STATUS_TONE[est.status]}>
                        {ESTIMATE_STATUS_LABELS[est.status]}
                      </Chip>
                      <span className="text-sm tabular-nums text-foreground">
                        {formatMoney(est.totalCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Jobs</h3>
            {data.projects.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No jobs linked to this client</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">{p.jobNumber}</span>{" "}
                      {p.name}
                    </span>
                    <Chip tone={PROJECT_STATUS_TONE[p.status]} className="shrink-0">
                      {PROJECT_STATUS_LABEL[p.status]}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Activity</h3>
            <div className="mb-3 flex items-center gap-2">
              <input
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                placeholder="Add a note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                disabled={logNote.isPending || !note.trim()}
                onClick={() => logNote.mutate()}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
              >
                <StickyNote className="h-4 w-4" /> Log note
              </button>
            </div>
            {data.activities.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No activity yet</p>
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
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  const url = `/api/crm/clients${params.toString() ? `?${params.toString()}` : ""}`;

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["crm-clients", q.trim(), status],
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
    errorTitle: "Could not update client",
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Clients" description="Customer records, history, and contact info">
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New client
        </button>
      </Header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients…"
            className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="">All</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : clients.length === 0 ? (
        <EmptyState icon={Contact} message="No clients yet">
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Add your first client
          </button>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">City</th>
                <th className="px-4 py-3 font-medium">Tags</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
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
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </>
                      ) : (
                        <>
                          <ArchiveRestore className="h-3.5 w-3.5" /> Restore
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
