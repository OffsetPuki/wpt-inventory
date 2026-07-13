import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMoney, parseMoney } from "@/lib/format";
import {
  LEAD_STAGES,
  LEAD_SOURCES,
  WIN_LOSS_REASONS,
  LEAD_STAGE_LABELS,
  LEAD_SOURCE_LABELS,
  WIN_LOSS_REASON_LABELS,
  ACTIVITY_KIND_LABELS,
  type Lead,
  type LeadStage,
  type LeadSource,
  type WinLossReason,
  type CrmActivity,
} from "@shared/crm-schema";
import type { Campaign } from "@shared/marketing-schema";
import type { PublicUser } from "@shared/schema";
import {
  Loader2,
  Plus,
  Users,
  Search,
  LayoutGrid,
  List,
  Phone,
  Mail,
  StickyNote,
  UserPlus,
  Trash2,
} from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const chipCls = "rounded-full px-2.5 py-0.5 text-xs font-medium";

const STAGE_STYLE: Record<LeadStage, string> = {
  new: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  contacted: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  quote_sent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  follow_up: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  lost: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function daysSince(v: string | number | Date | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v as any).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function invalidateLeads(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["crm-leads"] });
  qc.invalidateQueries({ queryKey: ["crm-stats"] });
  qc.invalidateQueries({ queryKey: ["crm-reports"] });
}

// ─── New lead dialog ──────────────────────────────────────────────────────────

function NewLeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<LeadSource>("website");
  const [campaignId, setCampaignId] = useState("");
  const [serviceRequested, setServiceRequested] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");

  // Campaign list needs the marketing module + elevated role — if the fetch
  // fails for any reason, just hide the field.
  const { data: campaignList } = useQuery<Campaign[] | null>({
    queryKey: ["marketing-campaigns"],
    queryFn: async () => {
      try {
        return await (await apiRequest("GET", "/api/marketing/campaigns")).json();
      } catch {
        return null;
      }
    },
    enabled: open,
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/crm/leads", {
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          source,
          campaignId: campaignId ? parseInt(campaignId, 10) : undefined,
          serviceRequested: serviceRequested.trim() || undefined,
          serviceArea: serviceArea.trim() || undefined,
          estimatedValueCents: estimatedValue ? parseMoney(estimatedValue) : undefined,
          notes: notes.trim() || undefined,
        })
      ).json(),
    onSuccess: () => {
      invalidateLeads(qc);
      toast({ variant: "success", title: "Lead created" });
      setName(""); setPhone(""); setEmail(""); setCampaignId("");
      setServiceRequested(""); setServiceArea(""); setEstimatedValue(""); setNotes("");
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not create lead", description: e?.message }),
  });

  return (
    <Modal open={open} onClose={onClose} title="New lead" maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            toast({ variant: "destructive", title: "Name is required" });
            return;
          }
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Phone</span>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email</span>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Source</span>
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </label>
          {campaignList && campaignList.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Campaign (optional)</span>
              <select className={inputCls} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">None</option>
                {campaignList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Service requested</span>
            <input className={inputCls} placeholder="e.g. 120 ft horizontal slat fence" value={serviceRequested} onChange={(e) => setServiceRequested(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Service area</span>
            <input className={inputCls} placeholder="ZIP or city (e.g. 76010, Mansfield)" value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Estimated value ($)</span>
          <input className={inputCls} inputMode="decimal" placeholder="0.00" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Create lead
        </button>
      </form>
    </Modal>
  );
}

// ─── Won / lost close dialog ──────────────────────────────────────────────────

function CloseLeadModal({
  lead,
  to,
  onClose,
}: {
  lead: Lead;
  to: "won" | "lost";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<WinLossReason | "">(lead.winLossReason ?? "");
  const [revenue, setRevenue] = useState(
    lead.estimatedValueCents ? String(lead.estimatedValueCents / 100) : ""
  );

  const close = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PATCH", `/api/crm/leads/${lead.id}`, {
          stage: to,
          winLossReason: reason || undefined,
          ...(to === "won" ? { revenueClosedCents: parseMoney(revenue) } : {}),
        })
      ).json(),
    onSuccess: () => {
      invalidateLeads(qc);
      toast({ variant: "success", title: to === "won" ? "Lead won" : "Lead marked lost" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update lead", description: e?.message }),
  });

  return (
    <Modal open onClose={onClose} title={to === "won" ? `Mark "${lead.name}" won` : `Mark "${lead.name}" lost`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason) {
            toast({ variant: "destructive", title: "A reason is required" });
            return;
          }
          close.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Reason</span>
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as WinLossReason)}>
            <option value="">Select a reason…</option>
            {WIN_LOSS_REASONS.map((r) => (
              <option key={r} value={r}>{WIN_LOSS_REASON_LABELS[r]}</option>
            ))}
          </select>
        </label>
        {to === "won" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Revenue closed ($)</span>
            <input className={inputCls} inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </label>
        )}
        <button
          type="submit"
          disabled={close.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {close.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {to === "won" ? "Mark won" : "Mark lost"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Lead detail dialog ───────────────────────────────────────────────────────

function LeadDetailModal({
  lead,
  users,
  isElevated,
  onClose,
}: {
  lead: Lead;
  users: PublicUser[];
  isElevated: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [source, setSource] = useState<LeadSource>(lead.source);
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [winLossReason, setWinLossReason] = useState<WinLossReason | "">(lead.winLossReason ?? "");
  const [serviceRequested, setServiceRequested] = useState(lead.serviceRequested ?? "");
  const [serviceArea, setServiceArea] = useState(lead.serviceArea ?? "");
  const [estimatedValue, setEstimatedValue] = useState(
    lead.estimatedValueCents ? String(lead.estimatedValueCents / 100) : ""
  );
  const [assignedTo, setAssignedTo] = useState(lead.assignedTo != null ? String(lead.assignedTo) : "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [activityNote, setActivityNote] = useState("");

  const { data: activities = [], isLoading: activitiesLoading } = useQuery<CrmActivity[]>({
    queryKey: ["crm-activities", "lead", lead.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/crm/activities?entityType=lead&entityId=${lead.id}`)).json(),
  });

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PATCH", `/api/crm/leads/${lead.id}`, {
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          source,
          stage,
          winLossReason: winLossReason || undefined,
          serviceRequested: serviceRequested.trim() || null,
          serviceArea: serviceArea.trim() || null,
          estimatedValueCents: parseMoney(estimatedValue),
          ...(isElevated ? { assignedTo: assignedTo ? parseInt(assignedTo, 10) : null } : {}),
          notes: notes.trim() || null,
        })
      ).json(),
    onSuccess: () => {
      invalidateLeads(qc);
      toast({ variant: "success", title: "Lead updated" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save", description: e?.message }),
  });

  const logActivity = useMutation({
    mutationFn: async (kind: "call" | "email" | "note") =>
      (
        await apiRequest("POST", "/api/crm/activities", {
          entityType: "lead",
          entityId: lead.id,
          kind,
          notes: activityNote.trim() || undefined,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-activities", "lead", lead.id] });
      invalidateLeads(qc);
      setActivityNote("");
      toast({ variant: "success", title: "Activity logged" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not log activity", description: e?.message }),
  });

  const convert = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/leads/${lead.id}/convert`)).json(),
    onSuccess: () => {
      invalidateLeads(qc);
      qc.invalidateQueries({ queryKey: ["crm-clients"] });
      toast({ variant: "success", title: "Converted to client" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not convert", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async () =>
      (await apiRequest("DELETE", `/api/crm/leads/${lead.id}`)).json(),
    onSuccess: () => {
      invalidateLeads(qc);
      toast({ variant: "success", title: "Lead deleted" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  const quickBtn =
    "flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60";

  return (
    <Modal open onClose={onClose} title={lead.name} maxWidth="max-w-2xl">
      <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
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
              <span className="text-sm font-medium text-foreground">Phone</span>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Email</span>
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Source</span>
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Stage</span>
              <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value as LeadStage)}>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
                ))}
              </select>
            </label>
            {(stage === "won" || stage === "lost") && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Win/loss reason</span>
                <select
                  className={inputCls}
                  value={winLossReason}
                  onChange={(e) => setWinLossReason(e.target.value as WinLossReason)}
                >
                  <option value="">Select a reason…</option>
                  {WIN_LOSS_REASONS.map((r) => (
                    <option key={r} value={r}>{WIN_LOSS_REASON_LABELS[r]}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Service requested</span>
              <input className={inputCls} value={serviceRequested} onChange={(e) => setServiceRequested(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Service area</span>
              <input className={inputCls} value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Estimated value ($)</span>
              <input className={inputCls} inputMode="decimal" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} />
            </label>
            {isElevated && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Assigned to</span>
                <select className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <textarea
              className="min-h-[72px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
              Save changes
            </button>
            {lead.clientId != null ? (
              <Link
                href="/crm/clients"
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
              >
                <UserPlus className="h-4 w-4" />
                View client
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => convert.mutate()}
                disabled={convert.isPending}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary disabled:opacity-60"
              >
                {convert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Convert to client
              </button>
            )}
            {isElevated && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete lead "${lead.name}"? This can't be undone from the app.`)) {
                    del.mutate();
                  }
                }}
                disabled={del.isPending}
                className="ml-auto flex h-11 items-center gap-2 rounded-xl border border-destructive/40 px-5 font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
              >
                {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            )}
          </div>
        </form>

        <div>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Activity</h3>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="h-9 min-w-40 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
              placeholder="Optional note…"
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
            />
            <button type="button" className={quickBtn} disabled={logActivity.isPending} onClick={() => logActivity.mutate("call")}>
              <Phone className="h-4 w-4" /> Log call
            </button>
            <button type="button" className={quickBtn} disabled={logActivity.isPending} onClick={() => logActivity.mutate("email")}>
              <Mail className="h-4 w-4" /> Log email
            </button>
            <button type="button" className={quickBtn} disabled={logActivity.isPending} onClick={() => logActivity.mutate("note")}>
              <StickyNote className="h-4 w-4" /> Log note
            </button>
          </div>
          {activitiesLoading ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : activities.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No activity yet</p>
          ) : (
            <ul className="divide-y divide-border">
              {activities.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className={cn(chipCls, "bg-muted text-muted-foreground")}>
                      {ACTIVITY_KIND_LABELS[a.kind]}
                    </span>
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
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const { isElevated } = useAuth();
  const qc = useQueryClient();

  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [stage, setStage] = useState("");
  const [assignee, setAssignee] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [closing, setClosing] = useState<{ lead: Lead; to: "won" | "lost" } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<LeadStage | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (source) params.set("source", source);
  if (assignee) params.set("assignedTo", assignee);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const leadsUrl = `/api/crm/leads${params.toString() ? `?${params.toString()}` : ""}`;

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["crm-leads", q.trim(), source, assignee, from, to],
    queryFn: async () => (await apiRequest("GET", leadsUrl)).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });
  const userName = (id: number | null) =>
    id == null ? "—" : users.find((u) => u.id === id)?.name ?? `#${id}`;

  const patchStage = useMutation({
    mutationFn: async ({ id, stage: next }: { id: number; stage: LeadStage }) =>
      (await apiRequest("PATCH", `/api/crm/leads/${id}`, { stage: next })).json(),
    onSuccess: () => invalidateLeads(qc),
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not move lead", description: e?.message }),
  });

  const handleDrop = (leadId: number, target: LeadStage) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === target) return;
    if (target === "won" || target === "lost") {
      setClosing({ lead, to: target });
    } else {
      patchStage.mutate({ id: leadId, stage: target });
    }
  };

  const listLeads = stage ? leads.filter((l) => l.stage === stage) : leads;
  const detailLead = detailId != null ? leads.find((l) => l.id === detailId) : undefined;

  const selectCls =
    "h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

  const toggleBtn = (active: boolean) =>
    cn(
      "flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <div className="mx-auto max-w-full">
      <Header title="Leads" description="Your sales pipeline, from first contact to closed">
        <div className="flex items-center gap-1 rounded-xl border border-border p-1">
          <button className={toggleBtn(view === "board")} onClick={() => setView("board")}>
            <LayoutGrid className="h-4 w-4" /> Board
          </button>
          <button className={toggleBtn(view === "list")} onClick={() => setView("list")}>
            <List className="h-4 w-4" /> List
          </button>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New lead
        </button>
      </Header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search leads…"
            className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>
        <select className={selectCls} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
          ))}
        </select>
        {view === "list" && (
          <select className={selectCls} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
            ))}
          </select>
        )}
        {view === "list" && isElevated && (
          <select className={selectCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">All assignees</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        {view === "list" && (
          <div className="flex items-center gap-1.5">
            <input type="date" className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-sm text-muted-foreground">–</span>
            <input type="date" className={selectCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Users className="h-12 w-12" />
          <p className="text-lg">No leads yet</p>
          <button
            onClick={() => setNewOpen(true)}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Add your first lead
          </button>
        </div>
      ) : view === "board" ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex items-start gap-3">
            {LEAD_STAGES.map((s) => {
              const column = leads.filter((l) => l.stage === s);
              return (
                <div
                  key={s}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverStage(s);
                  }}
                  onDragLeave={() => setDragOverStage((cur) => (cur === s ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverStage(null);
                    const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (id) handleDrop(id, s);
                  }}
                  className={cn(
                    "w-72 shrink-0 rounded-xl border bg-card/50 p-2",
                    dragOverStage === s ? "border-primary" : "border-border"
                  )}
                >
                  <div className="flex items-center justify-between px-2 py-2">
                    <span className="text-sm font-medium text-foreground">{LEAD_STAGE_LABELS[s]}</span>
                    <span className={cn(chipCls, "bg-muted text-muted-foreground")}>{column.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {column.map((lead) => {
                      const days = daysSince(lead.lastContactAt ?? lead.createdAt);
                      return (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", String(lead.id))}
                          onClick={() => setDetailId(lead.id)}
                          className="cursor-grab rounded-lg border border-border bg-card p-3 transition-shadow hover:border-primary/50 hover:shadow-md"
                        >
                          <p className="font-medium text-foreground">{lead.name}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className={cn(chipCls, "bg-blue-500/10 text-blue-700 dark:text-blue-400")}>
                              {LEAD_SOURCE_LABELS[lead.source]}
                            </span>
                            {lead.stale && (
                              <span className={cn(chipCls, "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                                Stale
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="tabular-nums text-foreground">
                              {formatMoney(lead.estimatedValueCents)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {days == null ? "no contact" : days === 0 ? "today" : `${days}d ago`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {column.length === 0 && (
                      <p className="px-2 py-6 text-center text-xs text-muted-foreground">No leads</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 text-right font-medium">Est. value</th>
                <th className="px-4 py-3 font-medium">Last contact</th>
                {isElevated && <th className="px-4 py-3 font-medium">Assignee</th>}
                <th className="px-4 py-3 font-medium">Service area</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {listLeads.length === 0 ? (
                <tr>
                  <td colSpan={isElevated ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground">
                    No leads match these filters
                  </td>
                </tr>
              ) : (
                listLeads.map((lead) => {
                  const days = daysSince(lead.lastContactAt ?? lead.createdAt);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setDetailId(lead.id)}
                      className="cursor-pointer hover:bg-accent/50"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {lead.name}
                        {lead.stale && (
                          <span className={cn(chipCls, "ml-2 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                            Stale
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(chipCls, STAGE_STYLE[lead.stage])}>
                          {LEAD_STAGE_LABELS[lead.stage]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{LEAD_SOURCE_LABELS[lead.source]}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {formatMoney(lead.estimatedValueCents)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {days == null ? "—" : days === 0 ? "Today" : `${days}d ago`}
                      </td>
                      {isElevated && (
                        <td className="px-4 py-3 text-muted-foreground">{userName(lead.assignedTo)}</td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground">{lead.serviceArea ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <NewLeadModal open={newOpen} onClose={() => setNewOpen(false)} />
      {closing && (
        <CloseLeadModal lead={closing.lead} to={closing.to} onClose={() => setClosing(null)} />
      )}
      {detailLead && (
        <LeadDetailModal
          key={detailLead.id}
          lead={detailLead}
          users={users}
          isElevated={isElevated}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
