import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatPercent, parseMoney } from "@/lib/format";
import {
  CAMPAIGN_CHANNELS,
  REVIEW_SOURCES,
  MK_TASK_KINDS,
  CHANNEL_LABELS,
  CAMPAIGN_STATUS_LABELS,
  REVIEW_SOURCE_LABELS,
  MK_TASK_KIND_LABELS,
  type Campaign,
  type Review,
  type MkTask,
  type MarketingSettings,
  type CampaignChannel,
  type CampaignStatus,
  type ReviewSource,
  type MkTaskKind,
} from "@shared/marketing-schema";
import {
  LEAD_STAGES,
  LEAD_SOURCES,
  LEAD_STAGE_LABELS,
  LEAD_SOURCE_LABELS,
  WIN_LOSS_REASON_LABELS,
  type Lead,
  type LeadStage,
  type WinLossReason,
} from "@shared/crm-schema";
import type { PublicUser } from "@shared/schema";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ClipboardList,
  Loader2,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Square,
  Star,
  Users,
  X,
} from "lucide-react";

// ─── Shared bits ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";
const textareaCls =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";
const primaryBtn =
  "flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60";
const secondaryBtn =
  "flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary";
const smallBtn =
  "flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:border-primary disabled:opacity-60";
const chipCls = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

const STAGE_CHIP: Record<LeadStage, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  contacted: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  quote_sent: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  follow_up: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  lost: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const CAMPAIGN_STATUS_CHIP: Record<CampaignStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ended: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
};

const TASK_KIND_CHIP: Record<MkTaskKind, string> = {
  follow_up: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  callback: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  quote_reminder: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  campaign_deadline: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  review_request: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  other: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
};

const neutralChip = "bg-muted text-muted-foreground";

function sourceLabel(source: string): string {
  return (LEAD_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

function centsToInput(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function relDays(ms: number | null | undefined): string {
  if (!ms) return "never";
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ─── API payload shapes (server/marketing.ts, server/crm.ts) ─────────────────

interface OverviewPayload {
  thisWeek: {
    leads: number;
    quotesSent: number;
    closeRate: number | null;
    spendCents: number;
    revenueCents: number;
    bestSource: { source: string; leads: number } | null;
  };
  funnel: { stage: LeadStage; count: number }[];
  bySource: { source: string; leads: number; quoteSent: number; won: number; revenueCents: number }[];
  campaignPerf: {
    id: number;
    name: string;
    channel: CampaignChannel;
    status: CampaignStatus;
    spendCents: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
    leads: number;
    cplCents: number | null;
    estimates: number;
    won: number;
  }[];
  alerts: string[];
}

interface MarketingStats {
  leadsThisWeek: number;
  cplCents30d: number | null;
  activeCampaigns: number;
  openTasks: number;
  overdueTasks: number;
  avgRating30d: number | null;
  unrespondedReviews: number;
  alerts: string[];
}

interface CrmReports {
  byStage: { stage: LeadStage; count: number; valueCents: number }[];
  winLoss: { reason: WinLossReason; count: number }[];
}

// ─── Small presentational helpers ─────────────────────────────────────────────

function LoadingBlock() {
  return (
    <div className="flex justify-center py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  children,
}: {
  icon: typeof Megaphone;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
      <Icon className="h-12 w-12" />
      <p className="text-lg">{message}</p>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function AlertBanners({ alerts }: { alerts: string[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mb-6 flex flex-col gap-2">
      {alerts.map((a, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{a}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal funnel bars with conversion % between consecutive stages. */
function FunnelBars({ rows }: { rows: { stage: LeadStage; count: number; valueCents?: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col">
      {rows.map((r, i) => {
        const next = rows[i + 1];
        const conv = next && r.count > 0 ? next.count / r.count : null;
        return (
          <div key={r.stage}>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-sm text-muted-foreground">
                {LEAD_STAGE_LABELS[r.stage]}
              </span>
              <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                <div
                  className="h-full rounded-md bg-primary/80"
                  style={{ width: `${Math.max(r.count > 0 ? 3 : 0, (r.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                {r.count}
              </span>
              {r.valueCents !== undefined && (
                <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
                  {formatMoney(r.valueCents)}
                </span>
              )}
            </div>
            {next && (
              <p className="py-1 pl-24 text-xs text-muted-foreground">
                ↓ {conv == null ? "—" : formatPercent(conv, 0)} advance
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-semibold text-foreground">{children}</h2>;
}

const thCls = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const tdCls = "px-3 py-2.5";
const tdRight = "px-3 py-2.5 text-right tabular-nums";

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useQuery<OverviewPayload>({
    queryKey: ["marketing", "overview"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/overview")).json(),
  });

  if (isLoading || !data) return <LoadingBlock />;

  const w = data.thisWeek;

  return (
    <div>
      <AlertBanners alerts={data.alerts} />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Leads this week" value={w.leads} />
        <KpiCard label="Quotes sent" value={w.quotesSent} sub="last 7 days" />
        <KpiCard label="Close rate" value={formatPercent(w.closeRate, 0)} sub="this month" />
        <KpiCard label="Spend" value={formatMoney(w.spendCents)} sub="active campaigns" />
        <KpiCard label="Revenue" value={formatMoney(w.revenueCents)} sub="this month" />
        <KpiCard
          label="Best source"
          value={<span className="text-lg">{w.bestSource ? sourceLabel(w.bestSource.source) : "—"}</span>}
          sub={w.bestSource ? `${w.bestSource.leads} lead${w.bestSource.leads === 1 ? "" : "s"} this week` : undefined}
        />
      </div>

      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <SectionTitle>Lead funnel</SectionTitle>
        {data.funnel.every((f) => f.count === 0) ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads yet — the funnel fills in as leads come in.</p>
        ) : (
          <FunnelBars rows={data.funnel} />
        )}
      </div>

      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <SectionTitle>Lead sources</SectionTitle>
        {data.bySource.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No lead sources to report yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Source</th>
                  <th className={thRight}>Leads</th>
                  <th className={thRight}>Quotes</th>
                  <th className={thRight}>Won</th>
                  <th className={thRight}>Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.bySource.map((s) => (
                  <tr key={s.source}>
                    <td className={cn(tdCls, "font-medium text-foreground")}>{sourceLabel(s.source)}</td>
                    <td className={tdRight}>{s.leads}</td>
                    <td className={tdRight}>{s.quoteSent}</td>
                    <td className={tdRight}>{s.won}</td>
                    <td className={cn(tdRight, "font-medium text-foreground")}>{formatMoney(s.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <SectionTitle>Campaign performance</SectionTitle>
        {data.campaignPerf.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Campaign</th>
                  <th className={thCls}>Channel</th>
                  <th className={thCls}>Status</th>
                  <th className={thRight}>Spend</th>
                  <th className={thRight}>CTR</th>
                  <th className={thRight}>Leads</th>
                  <th className={thRight}>CPL</th>
                  <th className={thRight}>Won</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.campaignPerf.map((c) => (
                  <tr key={c.id}>
                    <td className={cn(tdCls, "font-medium text-foreground")}>{c.name}</td>
                    <td className={tdCls}>
                      <span className={cn(chipCls, neutralChip)}>{CHANNEL_LABELS[c.channel]}</span>
                    </td>
                    <td className={tdCls}>
                      <span className={cn(chipCls, CAMPAIGN_STATUS_CHIP[c.status])}>
                        {CAMPAIGN_STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className={tdRight}>{formatMoney(c.spendCents)}</td>
                    <td className={tdRight}>{c.ctr == null ? "—" : formatPercent(c.ctr, 2)}</td>
                    <td className={tdRight}>{c.leads}</td>
                    <td className={tdRight}>{c.cplCents == null ? "—" : formatMoney(c.cplCents)}</td>
                    <td className={tdRight}>{c.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Leads tab ────────────────────────────────────────────────────────────────

function LeadsTab() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [stage, setStage] = useState("");
  const [area, setArea] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (source) params.set("source", source);
  if (stage) params.set("stage", stage);
  if (area.trim()) params.set("serviceArea", area.trim());
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["crm-leads", qs],
    queryFn: async () => (await apiRequest("GET", `/api/crm/leads${qs ? `?${qs}` : ""}`)).json(),
  });

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["marketing", "campaigns"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/campaigns")).json(),
  });
  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
  });

  const campaignName = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns]);
  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Marketing view of the CRM lead list — source, campaign, and staleness at a glance.
        </p>
        <Link
          href="/crm/leads"
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open in CRM <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone…"
          className={inputCls}
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {LEAD_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls}>
          <option value="">All stages</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Service area (ZIP / city)"
          className={inputCls}
        />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : leads.length === 0 ? (
        <EmptyState icon={Users} message="No leads match these filters" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={thCls}>Name</th>
                <th className={thCls}>Source</th>
                <th className={thCls}>Campaign</th>
                <th className={thCls}>Stage</th>
                <th className={thRight}>Est. value</th>
                <th className={thCls}>Assigned</th>
                <th className={thCls}>Last contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((l) => {
                const lastTouch = l.lastContactAt ?? new Date(l.createdAt).getTime();
                return (
                  <tr key={l.id}>
                    <td className={cn(tdCls, "font-medium text-foreground")}>
                      <span className="flex items-center gap-2">
                        {l.name}
                        {l.stale && (
                          <span className={cn(chipCls, "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                            Stale
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className={cn(chipCls, neutralChip)}>{sourceLabel(l.source)}</span>
                    </td>
                    <td className={cn(tdCls, "text-muted-foreground")}>
                      {l.campaignId ? campaignName.get(l.campaignId) ?? `#${l.campaignId}` : "—"}
                    </td>
                    <td className={tdCls}>
                      <span className={cn(chipCls, STAGE_CHIP[l.stage])}>{LEAD_STAGE_LABELS[l.stage]}</span>
                    </td>
                    <td className={tdRight}>{formatMoney(l.estimatedValueCents)}</td>
                    <td className={cn(tdCls, "text-muted-foreground")}>
                      {l.assignedTo ? userName.get(l.assignedTo) ?? `#${l.assignedTo}` : "—"}
                    </td>
                    <td className={cn(tdCls, "text-muted-foreground")}>{relDays(lastTouch)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Campaigns tab ────────────────────────────────────────────────────────────

function CampaignDialog({
  open,
  onClose,
  campaign,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(campaign?.name ?? "");
  const [channel, setChannel] = useState<CampaignChannel>(campaign?.channel ?? "facebook");
  const [startDate, setStartDate] = useState(campaign?.startDate ?? "");
  const [endDate, setEndDate] = useState(campaign?.endDate ?? "");
  const [budget, setBudget] = useState(campaign ? centsToInput(campaign.budgetCents) : "");
  const [spend, setSpend] = useState(campaign ? centsToInput(campaign.spendCents) : "");
  const [impressions, setImpressions] = useState(campaign ? String(campaign.impressions) : "");
  const [clicks, setClicks] = useState(campaign ? String(campaign.clicks) : "");
  const [notes, setNotes] = useState(campaign?.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        channel,
        startDate: startDate || null,
        endDate: endDate || null,
        budgetCents: parseMoney(budget),
        spendCents: parseMoney(spend),
        impressions: parseInt(impressions, 10) || 0,
        clicks: parseInt(clicks, 10) || 0,
        notes: notes.trim() || null,
      };
      const res = campaign
        ? await apiRequest("PATCH", `/api/marketing/campaigns/${campaign.id}`, body)
        : await apiRequest("POST", "/api/marketing/campaigns", body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({ variant: "success", title: campaign ? "Campaign updated" : "Campaign created" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not save campaign", description: e.message }),
  });

  return (
    <Modal open={open} onClose={onClose} title={campaign ? "Edit campaign" : "New campaign"} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            toast({ variant: "destructive", title: "Campaign name is required" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Channel</span>
          <select
            className={inputCls}
            value={channel}
            onChange={(e) => setChannel(e.target.value as CampaignChannel)}
          >
            {CAMPAIGN_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Start date</span>
            <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">End date</span>
            <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Budget ($)</span>
            <input className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0.00" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Spend to date ($)</span>
            <input className={inputCls} value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="0.00" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Impressions</span>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={impressions}
              onChange={(e) => setImpressions(e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Clicks</span>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={clicks}
              onChange={(e) => setClicks(e.target.value)}
              placeholder="0"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" disabled={save.isPending} className={cn(primaryBtn, "mt-1")}>
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {campaign ? "Save changes" : "Create campaign"}
        </button>
      </form>
    </Modal>
  );
}

function CampaignsTab() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["marketing", "campaigns"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/campaigns")).json(),
  });

  // CPL / lead counts come from the overview payload (campaign ↔ lead linkage
  // lives server-side); reuse the cached query rather than recomputing.
  const { data: overview } = useQuery<OverviewPayload>({
    queryKey: ["marketing", "overview"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/overview")).json(),
  });
  const perfById = useMemo(
    () => new Map((overview?.campaignPerf ?? []).map((p) => [p.id, p])),
    [overview]
  );

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: CampaignStatus }) =>
      (await apiRequest("PATCH", `/api/marketing/campaigns/${id}`, { status })).json(),
    onSuccess: (_row, vars) => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({ variant: "success", title: `Campaign ${CAMPAIGN_STATUS_LABELS[vars.status].toLowerCase()}` });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not update campaign", description: e.message }),
  });

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className={primaryBtn}
        >
          <Plus className="h-5 w-5" />
          New campaign
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} message="No campaigns yet">
          <button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className={secondaryBtn}
          >
            <Plus className="h-5 w-5" />
            Create your first campaign
          </button>
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const perf = perfById.get(c.id);
            const ctr = c.impressions > 0 ? c.clicks / c.impressions : null;
            const pct = c.budgetCents > 0 ? Math.min(100, (c.spendCents / c.budgetCents) * 100) : 0;
            const overBudget = c.budgetCents > 0 && c.spendCents > c.budgetCents;
            return (
              <div key={c.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{c.name}</h3>
                  <span className={cn(chipCls, CAMPAIGN_STATUS_CHIP[c.status])}>
                    {CAMPAIGN_STATUS_LABELS[c.status]}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn(chipCls, neutralChip)}>{CHANNEL_LABELS[c.channel]}</span>
                  <span>
                    {c.startDate ? formatDate(c.startDate) : "No start"} — {c.endDate ? formatDate(c.endDate) : "ongoing"}
                  </span>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className={cn("tabular-nums", overBudget ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                      {formatMoney(c.spendCents)} spent
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.budgetCents > 0 ? `of ${formatMoney(c.budgetCents)}` : "no budget"}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", overBudget ? "bg-red-500" : "bg-primary")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Impr.</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {c.impressions.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Clicks</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{c.clicks.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">CTR</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {ctr == null ? "—" : formatPercent(ctr, 2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">CPL</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {perf?.cplCents == null ? "—" : formatMoney(perf.cplCents)}
                    </p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
                  <button
                    onClick={() => {
                      setEditing(c);
                      setDialogOpen(true);
                    }}
                    className={smallBtn}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  {c.status === "active" && (
                    <button
                      onClick={() => setStatus.mutate({ id: c.id, status: "paused" })}
                      disabled={setStatus.isPending}
                      className={smallBtn}
                    >
                      <Pause className="h-3.5 w-3.5" />
                      Pause
                    </button>
                  )}
                  {c.status === "paused" && (
                    <button
                      onClick={() => setStatus.mutate({ id: c.id, status: "active" })}
                      disabled={setStatus.isPending}
                      className={smallBtn}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Resume
                    </button>
                  )}
                  {c.status !== "ended" && (
                    <button
                      onClick={() => setStatus.mutate({ id: c.id, status: "ended" })}
                      disabled={setStatus.isPending}
                      className={smallBtn}
                    >
                      <Square className="h-3.5 w-3.5" />
                      End
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <CampaignDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          campaign={editing}
        />
      )}
    </div>
  );
}

// ─── Pipeline tab ─────────────────────────────────────────────────────────────

function PipelineTab() {
  const { data, isLoading } = useQuery<CrmReports>({
    queryKey: ["crm-reports"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/reports")).json(),
  });

  if (isLoading || !data) return <LoadingBlock />;

  // Zero-fill and order the stage rows the way the funnel flows.
  const byStage = new Map(data.byStage.map((r) => [r.stage, r]));
  const rows = LEAD_STAGES.map((stage) => ({
    stage,
    count: byStage.get(stage)?.count ?? 0,
    valueCents: byStage.get(stage)?.valueCents ?? 0,
  }));

  const won = byStage.get("won")?.count ?? 0;
  const lost = byStage.get("lost")?.count ?? 0;
  const winRate = won + lost > 0 ? won / (won + lost) : null;
  const maxReason = Math.max(1, ...data.winLoss.map((r) => r.count));

  return (
    <div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Won" value={won} />
        <KpiCard label="Lost" value={lost} />
        <KpiCard label="Win rate" value={formatPercent(winRate, 0)} sub="of decided leads" />
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        <SectionTitle>Stage-by-stage movement</SectionTitle>
        {rows.every((r) => r.count === 0) ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads in the pipeline yet.</p>
        ) : (
          <FunnelBars rows={rows} />
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <SectionTitle>Win / loss breakdown</SectionTitle>
        {data.winLoss.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No decided leads with a recorded reason yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.winLoss.map((r) => (
              <div key={r.reason} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-sm text-muted-foreground">
                  {WIN_LOSS_REASON_LABELS[r.reason]}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary/80"
                    style={{ width: `${Math.max(3, (r.count / maxReason) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reviews tab ──────────────────────────────────────────────────────────────

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-4 w-4",
            n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
          )}
        />
      ))}
    </span>
  );
}

function ReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [source, setSource] = useState<ReviewSource>("google");
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState("5");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/marketing/reviews", {
          source,
          author: author.trim() || null,
          rating: parseInt(rating, 10),
          reviewDate: date || null,
          text: text.trim() || null,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({ variant: "success", title: "Review logged" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not log review", description: e.message }),
  });

  return (
    <Modal open={open} onClose={onClose} title="Log a review" maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Source</span>
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as ReviewSource)}>
              {REVIEW_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {REVIEW_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Rating</span>
            <select className={inputCls} value={rating} onChange={(e) => setRating(e.target.value)}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Author (optional)</span>
            <input className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Review date</span>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Review text (optional)</span>
          <textarea className={textareaCls} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" disabled={create.isPending} className={cn(primaryBtn, "mt-1")}>
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Log review
        </button>
      </form>
    </Modal>
  );
}

function ReviewsTab() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: ["marketing", "reviews"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/reviews")).json(),
  });
  const { data: stats } = useQuery<MarketingStats>({
    queryKey: ["marketing", "stats"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/stats")).json(),
  });

  const toggleResponded = useMutation({
    mutationFn: async (r: Review) =>
      (await apiRequest("PATCH", `/api/marketing/reviews/${r.id}`, { responded: !r.responded })).json(),
    onSuccess: (row: Review) => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({
        variant: "success",
        title: row.responded ? "Marked as responded" : "Marked as needing a response",
      });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not update review", description: e.message }),
  });

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 gap-3 sm:max-w-md sm:grid-cols-2">
          <KpiCard
            label="Avg rating (30d)"
            value={stats?.avgRating30d != null ? stats.avgRating30d.toFixed(1) : "—"}
          />
          <KpiCard label="Awaiting response" value={stats?.unrespondedReviews ?? "—"} />
        </div>
        <button onClick={() => setAddOpen(true)} className={cn(primaryBtn, "shrink-0")}>
          <Plus className="h-5 w-5" />
          Log review
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : reviews.length === 0 ? (
        <EmptyState icon={Star} message="No reviews logged yet">
          <button onClick={() => setAddOpen(true)} className={secondaryBtn}>
            <Plus className="h-5 w-5" />
            Log your first review
          </button>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  <span className={cn(chipCls, neutralChip)}>{REVIEW_SOURCE_LABELS[r.source]}</span>
                  {r.author && <span className="text-sm font-medium text-foreground">{r.author}</span>}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(r.reviewDate ?? r.createdAt)}
                  </span>
                </div>
                <button
                  onClick={() => toggleResponded.mutate(r)}
                  disabled={toggleResponded.isPending}
                  className={cn(
                    smallBtn,
                    r.responded &&
                      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                  {r.responded ? "Responded" : "Mark responded"}
                </button>
              </div>
              {r.text && <p className="mt-2 text-sm text-muted-foreground">{r.text}</p>}
            </div>
          ))}
        </div>
      )}

      {addOpen && <ReviewDialog open={addOpen} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ─── Tasks tab ────────────────────────────────────────────────────────────────

const DUE_FILTERS = [
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "week", label: "This week" },
  { id: "", label: "All" },
] as const;

function TaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MkTaskKind>("follow_up");
  const [due, setDue] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [notes, setNotes] = useState("");

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
  });
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["marketing", "campaigns"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/campaigns")).json(),
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/marketing/tasks", {
          title: title.trim(),
          kind,
          // Due dates are day-granular in the UI; anchor to end of business
          // so a task isn't "overdue" the morning it's due.
          dueAt: due ? new Date(`${due}T17:00:00`).getTime() : null,
          assignedTo: assignedTo ? parseInt(assignedTo, 10) : null,
          campaignId: campaignId ? parseInt(campaignId, 10) : null,
          notes: notes.trim() || null,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({ variant: "success", title: "Task created" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not create task", description: e.message }),
  });

  return (
    <Modal open={open} onClose={onClose} title="New task" maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Task title is required" });
            return;
          }
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Kind</span>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as MkTaskKind)}>
              {MK_TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MK_TASK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Due date</span>
            <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Assignee</span>
            <select className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Campaign</span>
            <select className={inputCls} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">None</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" disabled={create.isPending} className={cn(primaryBtn, "mt-1")}>
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Create task
        </button>
      </form>
    </Modal>
  );
}

function TasksTab() {
  const qc = useQueryClient();
  const [due, setDue] = useState<string>("");
  const [status, setStatus] = useState<string>("open");
  const [newOpen, setNewOpen] = useState(false);

  const params = new URLSearchParams();
  if (due) params.set("due", due);
  // The server forces status=open for due=overdue; don't double-send.
  if (status && due !== "overdue") params.set("status", status);
  const qs = params.toString();

  const { data: tasks = [], isLoading } = useQuery<MkTask[]>({
    queryKey: ["marketing", "tasks", qs],
    queryFn: async () => (await apiRequest("GET", `/api/marketing/tasks${qs ? `?${qs}` : ""}`)).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
  });
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["marketing", "campaigns"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/campaigns")).json(),
  });
  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const campaignName = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns]);

  const setTaskStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "open" | "done" | "dismissed" }) =>
      (await apiRequest("PATCH", `/api/marketing/tasks/${id}`, { status })).json(),
    onSuccess: (_row, vars) => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({
        variant: "success",
        title:
          vars.status === "done" ? "Task completed" : vars.status === "dismissed" ? "Task dismissed" : "Task reopened",
      });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not update task", description: e.message }),
  });

  const now = Date.now();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {DUE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setDue(f.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                due === f.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={due === "overdue"}
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:opacity-60"
          >
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="dismissed">Dismissed</option>
            <option value="">Any status</option>
          </select>
        </div>
        <button onClick={() => setNewOpen(true)} className={primaryBtn}>
          <Plus className="h-5 w-5" />
          New task
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : tasks.length === 0 ? (
        <EmptyState icon={ClipboardList} message="No tasks here — you're caught up" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={thCls}>Task</th>
                <th className={thCls}>Kind</th>
                <th className={thCls}>Linked to</th>
                <th className={thCls}>Assignee</th>
                <th className={thCls}>Due</th>
                <th className={thRight}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.map((t) => {
                const overdue = t.status === "open" && t.dueAt != null && t.dueAt < now;
                return (
                  <tr key={t.id} className={cn(t.status !== "open" && "opacity-60")}>
                    <td className={cn(tdCls, "font-medium text-foreground")}>
                      <span className="flex items-center gap-2">
                        {t.title}
                        {t.autoCreated && <span className={cn(chipCls, neutralChip)}>Auto</span>}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className={cn(chipCls, TASK_KIND_CHIP[t.kind])}>{MK_TASK_KIND_LABELS[t.kind]}</span>
                    </td>
                    <td className={cn(tdCls, "text-muted-foreground")}>
                      {t.leadId != null ? (
                        <Link href="/crm/leads" className="text-primary hover:underline">
                          Lead #{t.leadId}
                        </Link>
                      ) : t.campaignId != null ? (
                        campaignName.get(t.campaignId) ?? `Campaign #${t.campaignId}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={cn(tdCls, "text-muted-foreground")}>
                      {t.assignedTo ? userName.get(t.assignedTo) ?? `#${t.assignedTo}` : "—"}
                    </td>
                    <td
                      className={cn(
                        tdCls,
                        "whitespace-nowrap tabular-nums",
                        overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"
                      )}
                    >
                      {t.dueAt != null ? formatDate(t.dueAt) : "—"}
                      {overdue && " · overdue"}
                    </td>
                    <td className={tdRight}>
                      <span className="flex justify-end gap-2">
                        {t.status === "open" ? (
                          <>
                            <button
                              onClick={() => setTaskStatus.mutate({ id: t.id, status: "done" })}
                              disabled={setTaskStatus.isPending}
                              className={smallBtn}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Complete
                            </button>
                            <button
                              onClick={() => setTaskStatus.mutate({ id: t.id, status: "dismissed" })}
                              disabled={setTaskStatus.isPending}
                              className={smallBtn}
                            >
                              <X className="h-3.5 w-3.5" />
                              Dismiss
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setTaskStatus.mutate({ id: t.id, status: "open" })}
                            disabled={setTaskStatus.isPending}
                            className={smallBtn}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reopen
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && <TaskDialog open={newOpen} onClose={() => setNewOpen(false)} />}
    </div>
  );
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

function SettingsForm({ settings, onClose }: { settings: MarketingSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const [staleDays, setStaleDays] = useState(String(settings.staleLeadDays));
  const [followUpDays, setFollowUpDays] = useState(String(settings.quoteFollowUpDays));
  const [cplAlert, setCplAlert] = useState((settings.cplAlertCents / 100).toFixed(2).replace(/\.00$/, ""));
  const [autoReview, setAutoReview] = useState(settings.autoReviewRequest);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PUT", "/api/marketing/settings", {
          staleLeadDays: parseInt(staleDays, 10) || settings.staleLeadDays,
          quoteFollowUpDays: parseInt(followUpDays, 10) || settings.quoteFollowUpDays,
          cplAlertCents: parseMoney(cplAlert),
          autoReviewRequest: autoReview,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({ variant: "success", title: "Settings saved" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not save settings", description: e.message }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Mark a lead stale after (days)</span>
        <input
          type="number"
          min={1}
          max={365}
          className={inputCls}
          value={staleDays}
          onChange={(e) => setStaleDays(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Quote follow-up reminder after (days)</span>
        <input
          type="number"
          min={1}
          max={90}
          className={inputCls}
          value={followUpDays}
          onChange={(e) => setFollowUpDays(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Cost-per-lead alert threshold ($)</span>
        <input className={inputCls} value={cplAlert} onChange={(e) => setCplAlert(e.target.value)} placeholder="150" />
      </label>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={autoReview}
          onChange={(e) => setAutoReview(e.target.checked)}
          className="h-5 w-5 accent-primary"
        />
        <span className="text-sm font-medium text-foreground">Automatically queue review requests on won jobs</span>
      </label>
      <button type="submit" disabled={save.isPending} className={cn(primaryBtn, "mt-1")}>
        {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
        Save settings
      </button>
    </form>
  );
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery<MarketingSettings>({
    queryKey: ["marketing", "settings"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/settings")).json(),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} title="Marketing automation settings">
      {!data ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <SettingsForm settings={data} onClose={onClose} />
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "leads", label: "Leads" },
  { id: "campaigns", label: "Campaigns" },
  { id: "pipeline", label: "Pipeline" },
  { id: "reviews", label: "Reviews" },
  { id: "tasks", label: "Tasks" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function MarketingPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Marketing" description="Leads, campaigns, reviews, and follow-ups in one place">
        <button onClick={() => setSettingsOpen(true)} className={secondaryBtn}>
          <Settings className="h-5 w-5" />
          Settings
        </button>
      </Header>

      <div className="mb-6 flex flex-wrap gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "leads" && <LeadsTab />}
      {tab === "campaigns" && <CampaignsTab />}
      {tab === "pipeline" && <PipelineTab />}
      {tab === "reviews" && <ReviewsTab />}
      {tab === "tasks" && <TasksTab />}

      {settingsOpen && <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
