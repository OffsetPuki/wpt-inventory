import {useBusiness,setBusiness} from '@/hooks/useBusiness';
import { LeadIntake } from '@/components/LeadIntake';
import LeadPhotos, { leadPhotos } from '@/components/LeadPhotos';
import { useListPage,PageButtons,useRememberedState } from '@/lib/list-page';
import { RetryBlock } from '@/components/RetryBlock';
import { useDeepLink,consumeRecordLink } from "@/lib/deep-link";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal, { ModalClose } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { useApiMutation } from "@/hooks/useApiMutation";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { formatDateTime, formatMoney, parseMoney } from "@/lib/format";
import {
  LEAD_STAGES,
  LEAD_SOURCES,
  LEAD_SITES,
  WIN_LOSS_REASONS,
  LEAD_STAGE_LABELS,
  LEAD_SOURCE_LABELS,
  leadSiteLabel,
  WIN_LOSS_REASON_LABELS,
  ACTIVITY_KIND_LABELS,
  type Lead,
  type LeadStage,
  type LeadSource,
  type LeadSite,
  type WinLossReason,
  type CrmActivity,
} from "@shared/crm-schema";
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
  PencilRuler,
  Trash2,
} from "lucide-react";

// Per-trade brand hues for the site badge. Arbitrary Tailwind values must stay
// literal in this file so the JIT scan generates them.
const SITE_CHIP_CLS: Record<LeadSite, string> = {
  metals: "bg-[#2F5A73] text-white",
  concrete: "bg-[#A84B1E] text-white",
  insulation: "bg-[#136A66] text-white",
  trades: "bg-[#101215] text-white",
};

function SiteChip({ site, className }: { site: LeadSite; className?: string }) {
  return (
    <Chip className={cn(SITE_CHIP_CLS[site], className)}>{leadSiteLabel[site]}</Chip>
  );
}

const STAGE_TONE: Record<LeadStage, ChipTone> = {
  new: "zinc",
  contacted: "blue",
  quote_sent: "blue",
  follow_up: "amber",
  won: "emerald",
  lost: "red",
};

// Every lead mutation refreshes the same set of dependent queries. Winning/
// converting a lead feeds the marketing overview/attribution, so the prefix
// "marketing" match keeps those tabs fresh instead of showing stale numbers.
// Closing a lead also closes its open quotes server-side (crm.ts,
// closeQuotesForLead), so the Saved list and the dashboard tile go with it.
const LEAD_KEYS: QueryKey[] = [
  ["crm-lead-funnel"],
  ["crm-lead-intake"],
  ["crm-leads"],
  ["crm-stats"],
  ["crm-reports"],
  ["marketing"],
  ["quotes"],
  ["quotes-stats"],
];

function daysSince(v: string | number | Date | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v as any).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// unix ms → local "YYYY-MM-DD" for <input type="date">.
function toDateInput(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── New lead dialog ──────────────────────────────────────────────────────────

function NewLeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<LeadSource>("website");
  const [site, setSite] = useState<LeadSite>("metals");
  const [serviceRequested, setServiceRequested] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");

  const create = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/crm/leads",
      body: {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        source,
        site,
        serviceRequested: serviceRequested.trim() || undefined,
        serviceArea: serviceArea.trim() || undefined,
        estimatedValueCents: estimatedValue ? parseMoney(estimatedValue) : undefined,
        notes: notes.trim() || undefined,
      },
    }),
    invalidate: LEAD_KEYS,
    successTitle: "Lead created",
    errorTitle: "Could not create lead",
    onSuccess: () => {
      setName(""); setPhone(""); setEmail(""); setSource("website"); setSite("metals");
      setServiceRequested(""); setServiceArea(""); setEstimatedValue(""); setNotes("");
      onClose();
    },
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
          {/* Which shop the job is for. The website intake was the only thing
              that ever set this, so every phone-in, referral and offline sale
              landed in the metals column — and the per-brand tile counted web
              forms only. The server already accepts it here. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Shop</span>
            <select className={inputCls} value={site} onChange={(e) => setSite(e.target.value as LeadSite)}>
              {LEAD_SITES.map((s) => (
                <option key={s} value={s}>{leadSiteLabel[s]}</option>
              ))}
            </select>
          </label>
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
        <div className="suite-modal-actions"><button
          type="submit"
          disabled={create.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Create lead
        </button></div>
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
  const [reason, setReason] = useState<WinLossReason | "">(lead.winLossReason ?? "");
  const [quoteId, setQuoteId] = useState("");
  const [, navigateToQuote] = useLocation();
  const revise = useApiMutation<{ id: number }, number>({
    request: id => ({ method: 'POST', url: `/api/quotes/${id}/revision` }),
    invalidate: [['quotes'], ['crm-lead-detail', lead.id]],
    errorTitle: 'Could not create revision',
    onSuccess: row => { onClose(); navigateToQuote(`/crm/quotes?quote=${row.id}`); },
  });
  const { data: job, isError: jobFailed } = useQuery<{ quotes: { id: number; number: string; status: string; totalCents: number; expired: boolean }[] }>({
    queryKey: ["crm-lead-detail", lead.id],
    queryFn: async () => (await apiRequest("GET", `/api/crm/leads/${lead.id}/detail`)).json(),
  });
  const offers = job?.quotes.filter((q) => ['draft', 'sent', 'accepted'].includes(q.status) && !q.expired) ?? [];
  const expiredOffers = job?.quotes.filter(q => q.expired && q.status === 'sent') ?? [];
  const needsRevision = to === 'won' && !offers.length && expiredOffers.length > 0;

  const [revenue, setRevenue] = useState(
    lead.estimatedValueCents ? String(lead.estimatedValueCents / 100) : ""
  );

  const close = useApiMutation({
    request: () => ({
      method: "PATCH",
      url: `/api/crm/leads/${lead.id}`,
      body: {
        stage: to,
        quoteId: quoteId ? Number(quoteId) : offers.length === 1 ? offers[0].id : undefined,
        winLossReason: reason || undefined,
        ...(to === "won" ? { revenueClosedCents: parseMoney(revenue) } : {}),
      },
    }),
    invalidate: LEAD_KEYS,
    successTitle: to === "won" ? "Lead won" : "Lead marked lost",
    errorTitle: "Could not update lead",
    onSuccess: () => onClose(),
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
        {to === "won" && offers.length > 0 && <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Quote to accept</span><select className={inputCls} required value={quoteId || (offers.length === 1 ? String(offers[0].id) : '')} onChange={(e) => setQuoteId(e.target.value)}><option value="">Choose the agreed quote</option>{offers.map((q) => <option key={q.id} value={q.id}>{q.number} · {formatMoney(q.totalCents)} · {q.status}</option>)}</select><span className="text-xs text-muted-foreground">Accepting creates the linked job and invoice. Other offers remain separate.</span></label>}
        {jobFailed && <p role="alert">Could not load linked quotes. Close and reopen this dialog to retry.</p>}
        {to === 'won' && expiredOffers.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>{needsRevision ? 'The linked quote has expired. Review a new revision before marking this lead won.' : 'Expired offers cannot be accepted. Choose a current quote or review a revision.'}</p>{expiredOffers.map(q => <button type="button" key={q.id} disabled={revise.isPending} className="mt-2 block min-h-11 underline" onClick={() => revise.mutate(q.id)}>Create revision of {q.number}</button>)}<p className="mt-2 text-xs">Opens a new draft for review. Nothing is sent or accepted.</p></div>}
        {to === "won" && offers.length === 0 && !needsRevision && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Revenue closed ($)</span>
            <input className={inputCls} inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </label>
        )}
        <div className="suite-modal-actions"><button
          type="submit"
          disabled={close.isPending || jobFailed || !job || needsRevision || (to === "won" && offers.length > 1 && !quoteId)}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {close.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {to === "won" ? "Mark won" : "Mark lost"}
        </button></div>
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
  onOutcome,
}: {
  lead: Lead;
  users: PublicUser[];
  isElevated: boolean;
  onClose: () => void;
  onOutcome: (to: 'won' | 'lost') => void;
}) {
  const [original] = useState(lead);
  const [editVersion] = useState((lead as any)._version);
  const [tab, setTab] = useState<'Overview' | 'Activity' | 'Details'>('Overview');
  const [showFullRequest, setShowFullRequest] = useState(false);
  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [source, setSource] = useState<LeadSource>(lead.source);
  const [site, setSite] = useState<LeadSite>(lead.site);
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [winLossReason, setWinLossReason] = useState<WinLossReason | "">(lead.winLossReason ?? "");
  const [serviceRequested, setServiceRequested] = useState(lead.serviceRequested ?? "");
  const [serviceArea, setServiceArea] = useState(lead.serviceArea ?? "");
  const [estimatedValue, setEstimatedValue] = useState(
    lead.estimatedValueCents ? String(lead.estimatedValueCents / 100) : ""
  );
  const [assignedTo, setAssignedTo] = useState(lead.assignedTo != null ? String(lead.assignedTo) : "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  // Phase B #10: feeds the automations sweep (nextFollowUpAt → auto task).
  const [followUp, setFollowUp] = useState(toDateInput(lead.nextFollowUpAt));
  const [activityNote, setActivityNote] = useState("");

  const { data: activities = [], isLoading: activitiesLoading, isError: activitiesFailed, error: activitiesError, refetch: retryActivities } = useQuery<CrmActivity[]>({
    queryKey: ["crm-activities", "lead", lead.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/crm/activities?entityType=lead&entityId=${lead.id}`)).json(),
  });

  // Phase B #13: the website design they configured.
  const [language, setLanguage] = useState(lead.preferredLanguage ?? "en");
  const { data: extras, isError: detailFailed, refetch: retryDetail } = useQuery<{
    photos: string | null;
    quotes: { id: number; number: string; status: string; totalCents: number }[];
    projects: { id: number; name: string }[];
    invoices: { id: number; number: string; status: string; totalCents: number; paidCents: number }[];
    design: {
      ref: string;
      sourceTool: string | null;
      bestTime: string | null;
      contact: string | null;
      service: string | null;
      location: string | null;
      designSpec: string | null;
    } | null;
  }>({
    queryKey: ["crm-lead-detail", lead.id],
    queryFn: async () => (await apiRequest("GET", `/api/crm/leads/${lead.id}/detail`)).json(),
    refetchInterval: 30_000,
  });

  const save = useApiMutation({
    request: () => {
      // Moving out of won/lost — clear the now-stale close fields so reports
      // don't keep counting an old reason/revenue.
      const clearsClose = stage !== "won" && stage !== "lost";
      return {
        method: "PATCH",
        url: `/api/crm/leads/${lead.id}`,
        expectedVersion:editVersion,
        body: {
          leadId: lead.id,
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          source,
          site,
          ...(stage !== original.stage ? { stage } : {}),
        preferredLanguage: language,
          winLossReason: clearsClose ? null : winLossReason || undefined,
          serviceRequested: serviceRequested.trim() || null,
          serviceArea: serviceArea.trim() || null,
          estimatedValueCents: parseMoney(estimatedValue),
          // 9am local so the follow-up task lands in that morning's sweep;
          // clearing the field PATCHes null.
          nextFollowUpAt: followUp ? new Date(`${followUp}T09:00:00`).getTime() : null,
          ...(clearsClose && lead.stage === "won" ? { revenueClosedCents: 0 } : {}),
          ...(isElevated ? { assignedTo: assignedTo ? parseInt(assignedTo, 10) : null } : {}),
          notes: notes.trim() || null,
        },
      };
    },
    invalidate: [...LEAD_KEYS, ["crm-lead", lead.id], ["crm-lead-detail", lead.id]],
    successTitle: "Lead updated",
    onSuccess: onClose,
    errorTitle: "Could not save",
  });

  const logActivity = useApiMutation<any, "call" | "email" | "note">({
    request: (kind) => ({
      method: "POST",
      url: "/api/crm/activities",
      body: {
        entityType: "lead",
        entityId: lead.id,
        kind,
        notes: activityNote.trim() || undefined,
      },
    }),
    invalidate: [["crm-activities", "lead", lead.id], ...LEAD_KEYS],
    successTitle: "Activity logged",
    errorTitle: "Could not log activity",
    onSuccess: () => setActivityNote(""),
  });

  const convert = useApiMutation({
    request: () => ({ method: "POST", url: `/api/crm/leads/${lead.id}/convert` }),
    invalidate: [...LEAD_KEYS, ["crm-clients"]],
    successTitle: "Converted to client",
    errorTitle: "Could not convert",
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/crm/leads/${lead.id}` }),
    invalidate: LEAD_KEYS,
    successTitle: "Lead deleted",
    errorTitle: "Could not delete",
    onSuccess: () => onClose(),
  });

  const [, navigate] = useLocation();
  // "Quote this lead" — hand the customer (and their website design, when one
  // is linked) to the quote builder so nothing gets retyped. The builder
  // consumes this key on mount (see quote/QuoteBuilder.jsx).
  const quoteThisLead = () => {
    if (hasUnsavedChanges) { toast({ title: 'Save your lead changes and log any activity note before creating a quote' }); return; }
    try {
      sessionStorage.setItem(
        "cjm.quote.prefillLead",
        JSON.stringify({
          leadId: lead.id,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          designRef: extras?.design?.ref || null,
        })
      );
    } catch {
      /* storage unavailable — the builder just opens blank */
    }
    navigate("/crm/quotes");
  };

  const quickBtn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-60";
  const hasFieldChanges = name !== original.name || phone !== (original.phone ?? '') || email !== (original.email ?? '') || source !== original.source || site !== original.site || stage !== original.stage || language !== (original.preferredLanguage ?? 'en') || winLossReason !== (original.winLossReason ?? '') || serviceRequested !== (original.serviceRequested ?? '') || serviceArea !== (original.serviceArea ?? '') || parseMoney(estimatedValue) !== original.estimatedValueCents || assignedTo !== (original.assignedTo != null ? String(original.assignedTo) : '') || notes !== (original.notes ?? '') || followUp !== toDateInput(original.nextFollowUpAt);
  const hasUnsavedChanges = hasFieldChanges || !!activityNote.trim();
  const photos = leadPhotos(extras ? extras.photos : lead.photos);
  const phoneLink = phone.replace(/[^+\d]/g, '');
  const tabs = ['Overview', 'Activity', 'Details'] as const;
  const formId = `lead-details-${lead.id}`;
  const hasLinkedRecords = !!(extras?.quotes.length || extras?.projects.length || extras?.invoices.length);

  return (
    <Modal open onClose={onClose} title={lead.name} maxWidth="max-w-2xl" focusDialog hasUnsavedChanges={hasUnsavedChanges}
      footer={<div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" role="status">{hasFieldChanges ? 'Unsaved changes' : activityNote.trim() ? 'Activity note not logged' : 'Lead details'}</p>
        <div className="flex gap-2">
          <ModalClose className={quickBtn}>{hasUnsavedChanges ? 'Cancel' : 'Done'}</ModalClose>
          {hasFieldChanges && <button type="submit" form={formId} disabled={save.isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes
          </button>}
        </div>
      </div>}>
      <div className="space-y-5">
        <section aria-label="Customer contact" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Chip tone={STAGE_TONE[stage]}>{LEAD_STAGE_LABELS[stage]}</Chip>
            <span className="text-muted-foreground">{leadSiteLabel[site]}</span>
            {serviceArea && <span className="text-muted-foreground">· {serviceArea}</span>}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {phone && <span>{phone}</span>}
            {email && <span className="break-all">{email}</span>}
            {!phone && !email && <button type="button" className="text-primary underline" onClick={() => setTab('Details')}>Add contact details</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={quoteThisLead} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"><PencilRuler className="h-4 w-4" />Create quote</button>
            {phoneLink && <><a className={quickBtn} href={`tel:${phoneLink}`}><Phone className="h-4 w-4" />Call</a><a className={quickBtn} href={`sms:${phoneLink}`}>Text</a></>}
            {email && <a className={quickBtn} href={`mailto:${email.trim()}`}><Mail className="h-4 w-4" />Email</a>}
          </div>
        </section>

        <div role="tablist" aria-label="Lead sections" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {tabs.map((label, index) => <button key={label} id={`${formId}-${label}-tab`} type="button" role="tab" aria-selected={tab === label} aria-controls={`${formId}-${label}`} tabIndex={tab === label ? 0 : -1}
            className={cn('min-h-11 rounded-lg px-2 text-sm font-medium', tab === label ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setTab(label)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`${formId}-${tabs[next]}-tab`)?.focus(); }
            }}>{label}</button>)}
        </div>

        <form id={formId} onSubmit={event => {
          event.preventDefault();
          if (!name.trim()) { setTab('Details'); toast({ variant: 'destructive', title: 'Name is required' }); return; }
          if (stage !== original.stage && (stage === 'won' || stage === 'lost') && !winLossReason) { setTab('Overview'); toast({ variant: 'destructive', title: 'Choose a win/loss reason' }); return; }
          if (activityNote.trim()) { setTab('Activity'); toast({ title: 'Log your activity note before saving the lead' }); return; }
          save.mutate();
        }}>
          {tab === 'Overview' && <div role="tabpanel" id={`${formId}-Overview`} aria-labelledby={`${formId}-Overview-tab`} className="space-y-5">
            <section aria-label="Customer request" className="space-y-3">
              <div><h3 className="text-base font-semibold">{serviceRequested || 'Project request'}</h3>
                {notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{showFullRequest || notes.length <= 400 ? notes : notes.slice(0, 400) + '…'}</p>}
                {notes.length > 400 && <button type="button" aria-expanded={showFullRequest} className="mt-1 min-h-10 text-sm text-primary underline" onClick={() => setShowFullRequest(value => !value)}>{showFullRequest ? 'Show less' : 'Read full request'}</button>}
                {!notes && !serviceRequested && <p className="mt-1 text-sm text-muted-foreground">Add the project request in Details.</p>}
              </div>
              {isElevated && <LeadIntake id={lead.id} />}
            </section>

            <section aria-label="Next step" className="rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="mb-3 font-semibold">Next step</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Stage</span><select aria-label="Stage" className={inputCls} value={stage} onChange={event => {
                  const next = event.target.value as LeadStage;
                  if ((next === 'won' || next === 'lost') && next !== original.stage) {
                    if (hasUnsavedChanges) { toast({ title: 'Save your edits before closing this lead' }); return; }
                    onOutcome(next);
                  } else setStage(next);
                }}>{LEAD_STAGES.map(value => <option key={value} value={value}>{(value === 'won' || value === 'lost') && value !== original.stage ? `Mark ${value}…` : LEAD_STAGE_LABELS[value]}</option>)}</select></label>
                <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Next follow-up</span><input type="date" className={inputCls} value={followUp} onChange={event => setFollowUp(event.target.value)} /></label>
                {(stage === 'won' || stage === 'lost') && <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-sm font-medium">Win/loss reason</span><select aria-label="Win/loss reason" className={inputCls} value={winLossReason} onChange={event => setWinLossReason(event.target.value as WinLossReason)}><option value="">Choose a reason</option>{WIN_LOSS_REASONS.map(reason => <option key={reason} value={reason}>{WIN_LOSS_REASON_LABELS[reason]}</option>)}</select></label>}
              </div>
              {followUp && <p className="mt-2 text-xs text-muted-foreground">Saving this date schedules a follow-up task.</p>}
            </section>

            {photos.length > 0 && <LeadPhotos leadId={lead.id} photos={photos} />}
            {detailFailed && <p role="alert" className="text-sm">Photos and linked records could not refresh. <button type="button" className="underline" onClick={() => retryDetail()}>Retry</button></p>}
            {hasLinkedRecords && <section aria-label="Quotes and jobs" className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">Quotes & jobs</h3>
              {extras?.quotes.map(quote => <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{quote.number} · {quote.status} · {formatMoney(quote.totalCents)}</span><button type="button" className={quickBtn} onClick={async () => { try { const row = await (await apiRequest('POST', `/api/quotes/${quote.id}/share`, { preview: true })).json(); window.open(row.url, '_blank', 'noopener'); } catch (error: any) { toast({ variant: 'destructive', title: 'Could not open quote', description: error.message }); } }}>View quote</button></div>)}
              {extras?.projects.map(project => <a className="block min-h-10 text-sm text-primary underline" key={project.id} href={`/#/project/${project.id}`} onClick={event => { if (hasUnsavedChanges && !window.confirm('Discard your unsaved changes?')) event.preventDefault(); }}>{project.name} — job</a>)}
              {extras?.invoices.map(invoice => <a className="block min-h-10 text-sm text-primary underline" key={invoice.id} href={`/#/finance/invoices?invoice=${invoice.id}`} onClick={event => { if (hasUnsavedChanges && !window.confirm('Discard your unsaved changes?')) event.preventDefault(); }}>{invoice.number} · {invoice.status} · {formatMoney(invoice.totalCents - invoice.paidCents)} balance</a>)}
            </section>}
          </div>}

          {tab === 'Activity' && <section role="tabpanel" id={`${formId}-Activity`} aria-labelledby={`${formId}-Activity-tab`} className="space-y-4">
            <label className="flex flex-col gap-2"><span className="font-semibold">Add an update</span><textarea aria-label="Activity note" rows={3} className={inputCls} placeholder="What did you discuss? What happens next?" value={activityNote} onChange={event => setActivityNote(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={quickBtn} disabled={logActivity.isPending || !activityNote.trim()} onClick={() => logActivity.mutate('note')}><StickyNote className="h-4 w-4" />Log note</button>
              <button type="button" className={quickBtn} disabled={logActivity.isPending} onClick={() => logActivity.mutate('call')}><Phone className="h-4 w-4" />Log call</button>
              <button type="button" className={quickBtn} disabled={logActivity.isPending} onClick={() => logActivity.mutate('email')}><Mail className="h-4 w-4" />Log email</button>
            </div>
            <p className="text-xs text-muted-foreground">Record completed contact here. These buttons do not place a call or send an email.</p>
            {activitiesFailed ? <RetryBlock query={{ error: activitiesError, refetch: retryActivities }} /> : activitiesLoading ? <LoadingBlock /> : activities.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No updates yet.</p> : <ul className="divide-y divide-border">{activities.map(activity => <li key={activity.id} className="space-y-1 py-3"><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{ACTIVITY_KIND_LABELS[activity.kind]}</span><time>{formatDateTime(activity.createdAt as any)}</time></div>{activity.notes && <p className="whitespace-pre-wrap break-words text-sm">{activity.notes}</p>}</li>)}</ul>}
          </section>}

          {tab === 'Details' && <div role="tabpanel" id={`${formId}-Details`} aria-labelledby={`${formId}-Details-tab`} className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2" aria-label="Edit customer details">
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-sm font-medium">Name</span><input className={inputCls} value={name} onChange={event => setName(event.target.value)} /></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Phone</span><input type="tel" className={inputCls} value={phone} onChange={event => setPhone(event.target.value)} /></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Email</span><input type="email" className={inputCls} value={email} onChange={event => setEmail(event.target.value)} /></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Service requested</span><input className={inputCls} value={serviceRequested} onChange={event => setServiceRequested(event.target.value)} /></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Service area</span><input className={inputCls} value={serviceArea} onChange={event => setServiceArea(event.target.value)} /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-sm font-medium">Request / notes</span><textarea rows={4} className={inputCls} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            </section>
            <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">More lead details</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Shop</span><select aria-label="Shop" className={inputCls} value={site} onChange={event => setSite(event.target.value as LeadSite)}>{LEAD_SITES.map(value => <option key={value} value={value}>{leadSiteLabel[value]}</option>)}</select></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Source</span><select aria-label="Source" className={inputCls} value={source} onChange={event => setSource(event.target.value as LeadSource)}>{LEAD_SOURCES.map(value => <option key={value} value={value}>{LEAD_SOURCE_LABELS[value]}</option>)}</select></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Customer language</span><select aria-label="Customer language" className={inputCls} value={language} onChange={event => setLanguage(event.target.value as 'en' | 'es')}><option value="en">English</option><option value="es">Español</option></select></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-medium">Estimated value ($)</span><input className={inputCls} inputMode="decimal" value={estimatedValue} onChange={event => setEstimatedValue(event.target.value)} /></label>
              {isElevated && <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-sm font-medium">Assigned to</span><select aria-label="Assigned to" className={inputCls} value={assignedTo} onChange={event => setAssignedTo(event.target.value)}><option value="">Unassigned</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
            </div></details>
            {isElevated && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Site visit & request details</summary><div className="mt-4"><LeadIntake id={lead.id} mode="manage" /></div></details>}
            {extras?.design && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Website design</summary><div className="mt-3 space-y-2 text-sm"><p>Design ref: {extras.design.ref}</p>{extras.design.service && <p>{extras.design.service}</p>}{extras.design.location && <p>{extras.design.location}</p>}{extras.design.bestTime && <p>Requested time: {extras.design.bestTime}</p>}{extras.design.sourceTool && <p>From: {extras.design.sourceTool}</p>}{extras.design.designSpec && <p className="whitespace-pre-wrap break-words">{extras.design.designSpec}</p>}</div></details>}
            <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm text-muted-foreground">More actions</summary><div className="mt-3 flex flex-wrap gap-2">
              {lead.clientId != null ? <Link className={quickBtn} href={`/crm/clients?client=${lead.clientId}`} onClick={event => { if (hasUnsavedChanges && !window.confirm('Discard your unsaved changes?')) event.preventDefault(); }}>View client</Link> : <button type="button" className={quickBtn} disabled={convert.isPending} onClick={() => convert.mutate()}><UserPlus className="h-4 w-4" />Convert to client</button>}
              {isElevated && <button type="button" disabled={del.isPending} className={cn(quickBtn, 'text-destructive')} onClick={() => { if (window.confirm(`Delete lead "${lead.name}"? This can't be undone from the app.`)) del.mutate(); }}><Trash2 className="h-4 w-4" />Delete lead</button>}
            </div></details>
          </div>}
        </form>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const business=useBusiness();
  const { isElevated } = useAuth();

  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useRememberedState("client/src/pages/crm/leads.tsx:q","");
  const [source, setSource] = useRememberedState("client/src/pages/crm/leads.tsx:source","");
  const site=business==='all'?'':business;
  const setSite=(value:string)=>setBusiness(value||'all');
  const [stage, setStage] = useRememberedState("client/src/pages/crm/leads.tsx:stage","");
  const [assignee, setAssignee] = useRememberedState("client/src/pages/crm/leads.tsx:assignee","");
  const [from, setFrom] = useRememberedState("client/src/pages/crm/leads.tsx:from","");
  const [to, setTo] = useRememberedState("client/src/pages/crm/leads.tsx:to","");

  const [newOpen, setNewOpen] = useState(false);
  const leadLink = useDeepLink("lead");
  const [detailId, setDetailId] = useState<number | null>(leadLink ? Number(leadLink) : null);
  useEffect(() => { if (leadLink) {setDetailId(Number(leadLink));consumeRecordLink("lead");} }, [leadLink]);
  const [closing, setClosing] = useState<{ lead: Lead; to: "won" | "lost" } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<LeadStage | null>(null);

  const {page,setPage}=useListPage('leads:client/src/pages/crm/leads.tsx',[q.trim(),source,site,assignee,from,to,stage]);
  const params = new URLSearchParams();
    params.set('page',String(page));params.set('limit','50');
  if (q.trim()) params.set("q", q.trim());
  if (source) params.set("source", source);
  if (site) params.set("site", site);
  if(stage)params.set("stage",stage);
  if (assignee) params.set("assignedTo", assignee);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const leadsUrl = `/api/crm/leads${params.toString() ? `?${params.toString()}` : ""}`;

  const { data: leads = [], isLoading,isError,error,refetch } = useQuery<Lead[]>({
    queryKey: ["crm-leads", q.trim(), source, site, assignee, from, to,page],
    queryFn: async () => (await apiRequest("GET", leadsUrl)).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });
  const userName = (id: number | null) =>
    id == null ? "—" : users.find((u) => u.id === id)?.name ?? `#${id}`;

  const patchStage = useApiMutation<any, { id: number; stage: LeadStage }>({
    request: ({ id, stage: next }) => {
      const prev = leads.find((l) => l.id === id)?.stage;
      // Dragging out of won/lost must clear the stale reason (and closed
      // revenue when it was won) so those columns don't keep old values.
      const clearsClose = next !== "won" && next !== "lost";
      return {
        method: "PATCH",
        url: `/api/crm/leads/${id}`,
        body: {
          stage: next,
          ...(clearsClose ? { winLossReason: null } : {}),
          ...(clearsClose && prev === "won" ? { revenueClosedCents: 0 } : {}),
        },
      };
    },
    invalidate: LEAD_KEYS,
    errorTitle: "Could not move lead",
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
  const linkedLead = useQuery<Lead>({queryKey:['crm-lead',detailId],queryFn:async()=>(await apiRequest('GET',`/api/crm/leads/${detailId}`)).json(),enabled:detailId!==null&&!leads.some(l=>l.id===detailId)});
  const detailLead = detailId != null ? leads.find((l) => l.id === detailId) ?? linkedLead.data : undefined;

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
        <select className={selectCls} value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {LEAD_SITES.map((s) => (
            <option key={s} value={s}>{leadSiteLabel[s]}</option>
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

      <PageButtons page={page} setPage={setPage} count={leads.length}/>
      {isError ? <RetryBlock query={{error,refetch}}/> : isLoading ? (
        <LoadingBlock />
      ) : leads.length === 0 ? (
        <EmptyState icon={Users} message="No leads yet">
          <button
            onClick={() => setNewOpen(true)}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Add your first lead
          </button>
        </EmptyState>
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
                    <Chip className="bg-muted text-muted-foreground">{column.length}</Chip>
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
                            <SiteChip site={lead.site} />
                            <Chip tone="blue">{LEAD_SOURCE_LABELS[lead.source]}</Chip>
                            {lead.stale && <Chip tone="amber">Stale</Chip>}
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
                        <SiteChip site={lead.site} className="ml-2" />
                        {lead.stale && (
                          <Chip tone="amber" className="ml-2">Stale</Chip>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Chip tone={STAGE_TONE[lead.stage]}>
                          {LEAD_STAGE_LABELS[lead.stage]}
                        </Chip>
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
          onOutcome={to => { setClosing({ lead: detailLead, to }); setDetailId(null); }}
        />
      )}
    </div>
  );
}
