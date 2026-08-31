import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { inputCls, primaryBtn, secondaryBtn, thCls, tdCls, chipCls } from "@/lib/ui-styles";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatPercent, parseMoney } from "@/lib/format";
import {
  REVIEW_SOURCES,
  REVIEW_SOURCE_LABELS,
  type Review,
  type MarketingSettings,
  type ReviewSource,
  type PortfolioItem,
} from "@shared/marketing-schema";
import { uploadPhoto } from "@/lib/uploadPhoto";
import { LEAD_SOURCE_LABELS } from "@shared/crm-schema";
import {
  AlertTriangle,
  Check,
  Globe,
  Image as ImageIcon,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
} from "lucide-react";

// ─── Shared bits ──────────────────────────────────────────────────────────────

// Local-only Tailwind strings (no shared equivalent yet); inputCls / primaryBtn /
// secondaryBtn / chipCls now come from @/lib/ui-styles.
const textareaCls =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";
const smallBtn =
  "flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:border-primary disabled:opacity-60";

const neutralChip = "bg-muted text-muted-foreground";

function sourceLabel(source: string): string {
  return (LEAD_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

// ─── API payload shapes (server/marketing.ts) ────────────────────────────────

interface OverviewPayload {
  thisWeek: {
    leads: number;
    quotesSent: number;
    closeRate: number | null;
    revenueCents: number;
    bestSource: { source: string; leads: number } | null;
  };
  alerts: string[];
}

interface MarketingStats {
  leadsThisWeek: number;
  openTasks: number;
  overdueTasks: number;
  avgRating30d: number | null;
  unrespondedReviews: number;
  alerts: string[];
}

// GET /api/marketing/attribution — all-time rollups; the Overview renders the
// core by-source table (byCampaign/byUtmSource stay server-side, unused here).
interface AttributionPayload {
  bySource: { source: string; leads: number; won: number; revenueCents: number }[];
}

// ─── Small presentational helpers ─────────────────────────────────────────────

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-semibold text-foreground">{children}</h2>;
}

// thCls / tdCls now come from @/lib/ui-styles; the right-aligned variants stay local.
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const tdRight = "px-3 py-2.5 text-right tabular-nums";

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useQuery<OverviewPayload>({
    queryKey: ["marketing", "overview"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/overview")).json(),
  });
  const { data: attribution } = useQuery<AttributionPayload>({
    queryKey: ["marketing", "attribution"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/attribution")).json(),
  });

  if (isLoading || !data) return <LoadingBlock />;

  const w = data.thisWeek;
  const bySource = attribution?.bySource ?? [];

  return (
    <div>
      <AlertBanners alerts={data.alerts} />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Leads this week" value={w.leads} />
        <KpiCard label="Quotes sent" value={w.quotesSent} sub="last 7 days" />
        <KpiCard label="Close rate" value={formatPercent(w.closeRate, 0)} sub="this month" />
        <KpiCard label="Revenue" value={formatMoney(w.revenueCents)} sub="this month" />
        <KpiCard
          label="Best source"
          value={<span className="text-lg">{w.bestSource ? sourceLabel(w.bestSource.source) : "—"}</span>}
          sub={w.bestSource ? `${w.bestSource.leads} lead${w.bestSource.leads === 1 ? "" : "s"} this week` : undefined}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <SectionTitle>Where leads come from (all-time)</SectionTitle>
        {bySource.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads to attribute yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Source</th>
                  <th className={thRight}>Leads</th>
                  <th className={thRight}>Won</th>
                  <th className={thRight}>Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bySource.map((s) => (
                  <tr key={s.source}>
                    <td className={cn(tdCls, "font-medium text-foreground")}>{sourceLabel(s.source)}</td>
                    <td className={tdRight}>{s.leads}</td>
                    <td className={tdRight}>{s.won}</td>
                    <td className={cn(tdRight, "font-medium text-foreground")}>{formatMoney(s.revenueCents)}</td>
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
  const [source, setSource] = useState<ReviewSource>("google");
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState("5");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");

  const create = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/marketing/reviews",
      body: {
        source,
        author: author.trim() || null,
        rating: parseInt(rating, 10),
        reviewDate: date || null,
        text: text.trim() || null,
      },
    }),
    invalidate: [["marketing"]],
    successTitle: "Review logged",
    errorTitle: "Could not log review",
    onSuccess: onClose,
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

  // clientName is joined server-side when the review is linked to a CRM client.
  const { data: reviews = [], isLoading } = useQuery<(Review & { clientName?: string | null })[]>({
    queryKey: ["marketing", "reviews"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/reviews")).json(),
  });
  const { data: stats } = useQuery<MarketingStats>({
    queryKey: ["marketing", "stats"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/stats")).json(),
  });

  const toggleResponded = useApiMutation<Review, Review>({
    request: (r) => ({
      method: "PATCH",
      url: `/api/marketing/reviews/${r.id}`,
      body: { responded: !r.responded },
    }),
    invalidate: [["marketing"]],
    successTitle: (row) => (row.responded ? "Marked as responded" : "Marked as needing a response"),
    errorTitle: "Could not update review",
  });

  // Kept as a raw mutation: its success toast carries a conditional `description`
  // ("The site picks it up within ~5 minutes.") that useApiMutation can't express.
  const togglePublished = useMutation({
    mutationFn: async (r: Review) =>
      (await apiRequest("PATCH", `/api/marketing/reviews/${r.id}`, { published: !r.published })).json(),
    onSuccess: (row: Review) => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({
        variant: "success",
        title: row.published ? "Published to cjmmetals.com" : "Removed from the website",
        description: row.published ? "The site picks it up within ~5 minutes." : undefined,
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
                  {r.clientName && r.clientName !== r.author && (
                    <span className="text-xs text-muted-foreground">Customer: {r.clientName}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(r.reviewDate ?? r.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => togglePublished.mutate(r)}
                    disabled={togglePublished.isPending}
                    title={r.published ? "Shown on cjmmetals.com — click to unpublish" : "Publish to the website testimonials"}
                    className={cn(
                      smallBtn,
                      r.published &&
                        "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                    )}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {r.published ? "On website" : "Publish"}
                  </button>
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

// ─── Portfolio tab ────────────────────────────────────────────────────────────
// "Recent work" photos published to the cjmmetals.com gallery feed.

function PortfolioDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const create = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/marketing/portfolio",
      body: {
        title: title.trim(),
        category: category.trim() || null,
        photoUrl,
        published: true,
      },
    }),
    invalidate: [["marketing", "portfolio"]],
    successTitle: "Added to the portfolio",
    errorTitle: "Could not add photo",
    onSuccess: onClose,
  });

  const pickPhoto = async (file: File) => {
    setUploading(true);
    try {
      setPhotoUrl(await uploadPhoto(file));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add work photo">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !photoUrl) {
            toast({ variant: "destructive", title: "A title and a photo are required" });
            return;
          }
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input
            className={inputCls}
            placeholder="e.g. Horizontal slat fence — Mansfield"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Category (optional)</span>
          <input
            className={inputCls}
            placeholder="Gates, Fencing, Carports, Railings, Furniture…"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-4">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-24 w-24 rounded-lg border border-border object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
            </div>
          )}
          <label className={cn(secondaryBtn, "cursor-pointer")}>
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            {photoUrl ? "Replace photo" : "Upload photo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])}
            />
          </label>
        </div>
        <button type="submit" disabled={create.isPending || uploading} className={cn(primaryBtn, "mt-1 justify-center")}>
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Add to portfolio
        </button>
      </form>
    </Modal>
  );
}

function PortfolioTab() {
  const [addOpen, setAddOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery<PortfolioItem[]>({
    queryKey: ["marketing", "portfolio"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/portfolio")).json(),
  });

  const togglePublished = useApiMutation<PortfolioItem, PortfolioItem>({
    request: (it) => ({
      method: "PATCH",
      url: `/api/marketing/portfolio/${it.id}`,
      body: { published: !it.published },
    }),
    invalidate: [["marketing", "portfolio"]],
    successTitle: (row) => (row.published ? "Shown on cjmmetals.com" : "Hidden from the website"),
    errorTitle: "Could not update",
  });

  const remove = useApiMutation<unknown, PortfolioItem>({
    request: (it) => ({ method: "DELETE", url: `/api/marketing/portfolio/${it.id}` }),
    invalidate: [["marketing", "portfolio"]],
    successTitle: "Removed from the portfolio",
    errorTitle: "Could not remove",
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Published photos appear in the website's "recent work" feed. New photos publish immediately.
        </p>
        <button onClick={() => setAddOpen(true)} className={cn(primaryBtn, "shrink-0")}>
          <Plus className="h-5 w-5" />
          Add photo
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState icon={ImageIcon} message="No work photos yet">
          <button onClick={() => setAddOpen(true)} className={secondaryBtn}>
            <Plus className="h-5 w-5" />
            Add your first photo
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((it) => (
            <div key={it.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <img src={it.photoUrl} alt={it.title} className="aspect-square w-full object-cover" />
              <div className="flex flex-col gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{it.title}</p>
                  {it.category && <p className="text-xs text-muted-foreground">{it.category}</p>}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => togglePublished.mutate(it)}
                    disabled={togglePublished.isPending}
                    className={cn(
                      smallBtn,
                      it.published &&
                        "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                    )}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {it.published ? "Live" : "Hidden"}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove "${it.title}" from the portfolio?`)) remove.mutate(it);
                    }}
                    className={cn(smallBtn, "text-destructive hover:border-destructive")}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && <PortfolioDialog open={addOpen} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsForm({ settings }: { settings: MarketingSettings }) {
  const [staleDays, setStaleDays] = useState(String(settings.staleLeadDays));
  const [followUpDays, setFollowUpDays] = useState(String(settings.quoteFollowUpDays));
  const [autoReview, setAutoReview] = useState(settings.autoReviewRequest);
  // Nullable: empty string ⇔ NULL ⇔ the website hides its lead-time banner.
  const [leadTime, setLeadTime] = useState(settings.leadTimeWeeks == null ? "" : String(settings.leadTimeWeeks));

  const save = useApiMutation({
    request: () => ({
      method: "PUT",
      url: "/api/marketing/settings",
      body: {
        staleLeadDays: parseInt(staleDays, 10) || settings.staleLeadDays,
        quoteFollowUpDays: parseInt(followUpDays, 10) || settings.quoteFollowUpDays,
        autoReviewRequest: autoReview,
        leadTimeWeeks: leadTime.trim() === "" ? null : parseInt(leadTime, 10) || 0,
      },
    }),
    invalidate: [["marketing"]],
    successTitle: "Settings saved",
    errorTitle: "Could not save settings",
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
        <span className="text-sm font-medium text-foreground">Website lead time (weeks)</span>
        <input
          type="number"
          min={0}
          max={52}
          className={inputCls}
          value={leadTime}
          onChange={(e) => setLeadTime(e.target.value)}
          placeholder="e.g. 3"
        />
        <span className="text-xs text-muted-foreground">
          Shown on cjmmetals.com as a booking-lead-time banner. Leave empty to hide it.
        </span>
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

function SettingsTab() {
  const { data } = useQuery<MarketingSettings>({
    queryKey: ["marketing", "settings"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/settings")).json(),
  });

  if (!data) return <LoadingBlock />;
  return (
    <div className="max-w-lg rounded-xl border border-border bg-card p-5">
      <SectionTitle>Automation settings</SectionTitle>
      {/* Key on the fetch's updatedAt so a refetch after save re-seeds the form. */}
      <SettingsForm key={String(data.updatedAt)} settings={data} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "reviews", label: "Reviews" },
  { id: "portfolio", label: "Portfolio" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function MarketingPage() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Marketing" description="Reviews, the website portfolio, and where leads come from" />

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
      {tab === "reviews" && <ReviewsTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
