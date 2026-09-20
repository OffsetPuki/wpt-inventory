import {MarketingHistory,MarketingPreferences,MarketingReviewChecks} from '@/components/MarketingTools';
import {useMarketingPlace} from '@/hooks/useMarketingPlace';
import {useAuth} from '@/lib/auth';
import PublicWorkEditor from '@/components/PublicWorkEditor';
import { portfolioDomains } from '@shared/portfolio';
import { useState,useEffect } from "react";
import GrowthReport from '@/components/GrowthReport';
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
  Pencil,
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
  const {data,isError,refetch}=useQuery<MarketingStats>({queryKey:['marketing','stats'],queryFn:async()=>(await apiRequest('GET','/api/marketing/stats')).json()});
  return <>{isError&&<p role="alert">Could not load marketing alerts. <button className={secondaryBtn} onClick={()=>refetch()}>Retry</button></p>}<AlertBanners alerts={data?.alerts||[]}/><GrowthReport/></>;
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

function ReviewDialog({ open, onClose,item }: { open: boolean; onClose: () => void;item?:Review }) {
  const [reviewSite,setReviewSite]=useState<string>(item?.site||"metals");
  const [source, setSource] = useState<ReviewSource>(item?.source||"google");
  const [author, setAuthor] = useState(item?.author||"");
  const [rating, setRating] = useState(String(item?.rating||5));
  const [date, setDate] = useState(item?.reviewDate||"");
  const [text, setText] = useState(item?.text||"");
  const existing=useQuery<Review[]>({queryKey:['marketing-review-duplicates'],queryFn:async()=>(await apiRequest('GET','/api/marketing/reviews')).json()});
  const [externalUrl,setExternalUrl]=useState(item?.externalUrl||"");

  const create = useApiMutation({
    request: () => ({
      method: item?"PATCH":"POST",
      url: "/api/marketing/reviews"+(item?"/"+item.id:""),
      body: {
        source,version:item?.version,externalUrl:externalUrl||null,
        site:reviewSite,
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
    <Modal open={open} onClose={onClose} title={item?"Edit review":"Log a review"} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">Trade<select className={inputCls} value={reviewSite} onChange={e=>setReviewSite(e.target.value)}>{["metals","concrete","insulation","trades"].map(site=><option key={site}>{site}</option>)}</select></label>
        {existing.data?.some(r=>r.id!==item?.id&&r.site===reviewSite&&r.source===source&&((externalUrl&&r.externalUrl===externalUrl)||(text.trim()&&r.author===author.trim()&&r.text===text.trim())))&&<p role="status" className="rounded border p-3">A matching review is already logged. Check the existing review before adding another.</p>}
        <label>Original review link (optional)<input type="url" className={inputCls} value={externalUrl} onChange={e=>setExternalUrl(e.target.value)}/></label>
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
          {item?"Save changes":"Log review"}
        </button>
      </form>
    </Modal>
  );
}

function ReviewsTab() {
  const {user}=useAuth(),manager=['owner','manager'].includes(user?.role||'');
  const [sourceFilter,setSourceFilter]=useMarketingPlace<string>('reviewSource','all');
  const [editing,setEditing]=useState<Review|null>(null);
  const [business,setBusiness]=useMarketingPlace<string>('reviewBusiness','all'),[filter,setFilter]=useMarketingPlace<string>('reviewFilter','active');
  const [search,setSearch]=useState(''),[limit,setLimit]=useState(20),[page,setPage]=useState(0);
  useEffect(()=>setPage(0),[search,business,filter,sourceFilter]);
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  // clientName is joined server-side when the review is linked to a CRM client.
  const { data: allReviews = [], isLoading,isError,refetch } = useQuery<(Review & { clientName?: string | null })[]>({
    queryKey: ["marketing", "reviews",filter,business,search,page,sourceFilter],
    queryFn: async () => (await apiRequest("GET", `/api/marketing/reviews?limit=20${sourceFilter==='all'?'':'&source='+sourceFilter}&offset=${page*20}&search=${encodeURIComponent(search)}${business==='all'?'':'&site='+business}${filter==='unresponded'?'&responded=0':''}&archived=${filter==='archived'?'1':'0'}`)).json(),
  });
  const { data: stats } = useQuery<MarketingStats>({
    queryKey: ["marketing", "stats"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/stats")).json(),
  });

  const reviews=allReviews.filter(r=>(business==='all'||r.site===business)&&(filter!=='unresponded'||!r.responded)&&(`${r.author||''} ${r.text||''}`).toLowerCase().includes(search.toLowerCase()));
  const archive=useApiMutation<unknown,Review>({request:r=>({method:r.archivedAt?'POST':'DELETE',url:`/api/marketing/reviews/${r.id}`+(r.archivedAt?'/restore':''),body:{version:r.version}}),invalidate:[['marketing']],successTitle:'Review updated',errorTitle:'Could not update review'});
  const toggleResponded = useApiMutation<Review, Review>({
    request: (r) => ({
      method: "PATCH",
      url: `/api/marketing/reviews/${r.id}`,
      body: { responded: !r.responded,version:r.version },
    }),
    invalidate: [["marketing"]],
    successTitle: (row) => (row.responded ? "Marked as responded" : "Marked as needing a response"),
    errorTitle: "Could not update review",
  });

  // Kept as a raw mutation: its success toast carries a conditional `description`
  // ("The site picks it up within ~5 minutes.") that useApiMutation can't express.
  const togglePublished = useMutation({
    mutationFn: async (r: Review) =>
      (await apiRequest("PATCH", `/api/marketing/reviews/${r.id}`, { published: !r.published,version:r.version })).json(),
    onSuccess: (row: Review) => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      toast({
        variant: "success",
        title: row.published ? `Published to CJM ${row.site}` : "Removed from the website",
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

      <div className="flex flex-wrap gap-3 mb-4"><label>Business<select className={inputCls} value={business} onChange={e=>setBusiness(e.target.value)}>{['all','metals','concrete','insulation','trades','unassigned'].map(x=><option key={x}>{x}</option>)}</select></label><label>Show<select className={inputCls} value={filter} onChange={e=>setFilter(e.target.value)}>{['active','unresponded','archived'].map(x=><option key={x}>{x}</option>)}</select></label><label>Source<select aria-label="Filter review source" className={inputCls} value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">All sources</option>{REVIEW_SOURCES.map(x=><option value={x} key={x}>{REVIEW_SOURCE_LABELS[x]}</option>)}</select></label><label>Search reviews<input className={inputCls} value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
      {isError?<div role="alert">Could not load reviews. <button className={secondaryBtn} onClick={()=>refetch()}>Retry</button></div>:isLoading ? (
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
          {reviews.slice(0,limit).map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} /><span className={cn(chipCls, neutralChip)}>CJM {r.site}</span>
                  <span className={cn(chipCls, neutralChip)}>{REVIEW_SOURCE_LABELS[r.source]}</span>
                  {r.externalUrl&&<a className="text-xs underline" href={r.externalUrl} target="_blank" rel="noreferrer">Original review</a>}
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
                    disabled={togglePublished.isPending||!manager||!!r.archivedAt||r.site==='unassigned'}
                    title={`Publish only to CJM ${r.site} — confirm the review belongs to this trade`}
                    className={cn(
                      smallBtn,
                      r.published &&
                        "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                    )}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {r.published ? "On website" : "Publish"}
                  </button>
                  <button className={smallBtn} onClick={()=>setEditing(r)}>Edit</button>
                  {manager&&<button className={smallBtn} disabled={archive.isPending} onClick={()=>{if(r.archivedAt||confirm('Archive this review? You can restore it later.'))archive.mutate(r);}}>{r.archivedAt?'Restore':'Archive'}</button>}
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

      <p className="text-xs text-muted-foreground mt-3">Mark responded updates your task list; it does not post a reply to Google.</p>
      <div className="flex gap-3 mt-4"><button className={secondaryBtn} disabled={page===0} onClick={()=>setPage(n=>n-1)}>Previous reviews</button><button className={secondaryBtn} disabled={allReviews.length<20} onClick={()=>setPage(n=>n+1)}>Next reviews</button></div>
      {reviews.length>limit&&<button className={secondaryBtn} onClick={()=>setLimit(n=>n+20)}>Show more reviews</button>}
      {editing&&<ReviewDialog key={editing.id} open item={editing} onClose={()=>setEditing(null)}/>}
      {addOpen && <ReviewDialog open={addOpen} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ─── Portfolio tab ────────────────────────────────────────────────────────────
// "Recent work" photos published to the cjmmetals.com gallery feed.

// One dialog for both: pass `item` to edit an existing photo's title, category
// or picture (PATCH); leave it out to add a new one (POST).
function PortfolioDialog({open,onClose,item}:{open:boolean;onClose:()=>void;item?:PortfolioItem}) { return open ? <PublicWorkEditor item={item} onClose={onClose}/> : null; }

function PortfolioTab() {
  const {user}=useAuth(),manager=['owner','manager'].includes(user?.role||'');
  const qc=useQueryClient();
  const [business,setBusiness]=useMarketingPlace<string>('portfolioBusiness','all'),[filter,setFilter]=useMarketingPlace<string>('portfolioFilter','active');
  const [search,setSearch]=useState(''),[limit,setLimit]=useState(20),[page,setPage]=useState(0);
  useEffect(()=>setPage(0),[search,business,filter]);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PortfolioItem | null>(null);

  const { data: allItems = [], isLoading,isError,refetch } = useQuery<PortfolioItem[]>({
    queryKey: ["marketing", "portfolio",filter,business,search,page],
    queryFn: async () => (await apiRequest("GET", `/api/marketing/portfolio?limit=20&offset=${page*20}&search=${encodeURIComponent(search)}${business==='all'?'':'&site='+business}${filter==='published'?'&published=1':filter==='drafts'?'&published=0':''}&archived=${filter==='archived'?'1':'0'}`)).json(),
  });

  const items=allItems.filter(r=>(business==='all'||r.site===business)&&(filter!=='drafts'||!r.published)&&(filter!=='published'||r.published)&&(`${r.title} ${r.city||''} ${r.category||''}`).toLowerCase().includes(search.toLowerCase()));
  const reorder=useApiMutation<unknown,number>({request:id=>{const ordered=[...allItems];const i=ordered.findIndex(r=>r.id===id);if(i>0)[ordered[i-1],ordered[i]]=[ordered[i],ordered[i-1]];return {method:'POST',url:'/api/marketing/portfolio/reorder',body:{items:ordered.map(r=>({id:r.id,version:r.version}))}};},invalidate:[['marketing','portfolio']],successTitle:'Work order updated',errorTitle:'Could not reorder work'});
  const togglePublished = useApiMutation<PortfolioItem, PortfolioItem>({
    request: (it) => ({
      method: "PATCH",
      url: `/api/marketing/portfolio/${it.id}`,
      body: { published: !it.published, approved: !it.published,version:it.version },
    }),
    invalidate: [["marketing", "portfolio"]],
    successTitle: (row) => (row.published ? `Shown on ${portfolioDomains[row.site]}` : "Hidden from the website"),
    errorTitle: "Could not update",
  });

  const remove = useApiMutation<unknown, PortfolioItem>({
    request: (it) => ({ method: it.archivedAt?"POST":"DELETE", url: `/api/marketing/portfolio/${it.id}`+(it.archivedAt?"/restore":""),body:{version:it.version} }),
    invalidate: [["marketing", "portfolio"]],
    successTitle: "Removed from the portfolio",
    errorTitle: "Could not remove",
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Prepare photos and project pages for each trade. Review the public details before publishing. Drafts stay private.
        </p>
        <button onClick={() => setAddOpen(true)} className={cn(primaryBtn, "shrink-0")}>
          <Plus className="h-5 w-5" />
          Add work
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4"><label>Business<select className={inputCls} value={business} onChange={e=>setBusiness(e.target.value)}>{['all','metals','concrete','insulation','trades'].map(x=><option key={x}>{x}</option>)}</select></label><label>Show<select className={inputCls} value={filter} onChange={e=>setFilter(e.target.value)}>{['active','drafts','published','archived'].map(x=><option key={x}>{x}</option>)}</select></label><label>Search work<input className={inputCls} value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
      {isError?<div role="alert">Could not load portfolio. <button className={secondaryBtn} onClick={()=>refetch()}>Retry</button></div>:isLoading ? (
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
          {items.slice(0,limit).map((it) => (
            <div key={it.id} className="overflow-hidden rounded-xl border border-border bg-card">
              {it.photoUrl ? <img loading="lazy" src={it.photoUrl} alt={it.title} className="aspect-square w-full object-cover" /> : <div className="aspect-square w-full grid place-items-center text-sm text-muted-foreground bg-muted">Add a photo to publish</div>}
              <div className="flex flex-col gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">CJM {it.site} · {it.published ? "Published" : "Draft"}</p><p className="truncate text-sm font-medium text-foreground">{it.title}</p>{it.city && <p className="text-xs">{it.city}</p>}{it.published && it.projectPage && <a className="text-xs underline" target="_blank" rel="noreferrer" href={`${portfolioDomains[it.site]}/work/${it.id}`}>View project page</a>}
                  {it.category && <p className="text-xs text-muted-foreground">{it.category}</p>}
                </div>
                {/* flex-wrap: in the phone's two-column grid the three buttons
                    are wider than the card, and overflow-hidden would clip the
                    Delete button. The icon pair drops to its own line instead. */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => it.published ? togglePublished.mutate(it) : setEditing(it)}
                    disabled={togglePublished.isPending||!manager||!!it.archivedAt}
                    className={cn(
                      smallBtn,
                      it.published &&
                        "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                    )}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {it.published ? "Unpublish" : "Review and publish"}
                  </button>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {manager&&!it.archivedAt&&<button className={smallBtn} disabled={page>0||business!=='all'||!!search||filter!=='active'||allItems[0]?.id===it.id||reorder.isPending} onClick={()=>reorder.mutate(it.id)}>Move earlier</button>}
                    <button
                      onClick={() => setEditing(it)}
                      className={smallBtn}
                      aria-label={`Edit ${it.title}`}
                      title="Review photo and project details"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (it.archivedAt||window.confirm(`Archive "${it.title}"? It can be restored later.`)) remove.mutate(it);
                      }}
                      className={cn(smallBtn, "text-destructive hover:border-destructive")}
                      disabled={!manager} aria-label={it.archivedAt?"Restore":"Archive"}
                    >
                      {it.archivedAt?"Restore":<Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 mt-4"><button className={secondaryBtn} disabled={page===0} onClick={()=>setPage(n=>n-1)}>Previous work</button><button className={secondaryBtn} disabled={allItems.length<20} onClick={()=>setPage(n=>n+1)}>Next work</button></div>
      {items.length>limit&&<button className={secondaryBtn} onClick={()=>setLimit(n=>n+20)}>Show more work</button>}
      {addOpen && <PortfolioDialog open={addOpen} onClose={() => setAddOpen(false)} />}
      {/* Keyed by id so switching photos remounts the dialog with fresh fields. */}
      {editing && (
        <PortfolioDialog key={editing.id} open item={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsForm({ settings }: { settings: MarketingSettings }) {
  const {user}=useAuth();
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
        expectedUpdatedAt:settings.updatedAt,
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
        <span className="text-sm font-medium text-foreground">Automatically queue review requests when invoices are paid</span>
      </label>
      <button type="submit" disabled={save.isPending} className={cn(primaryBtn, "mt-1")}>
        {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
        Save settings
      </button>
    </form>
  );
}

function SettingsTab() {
  const { data,isError,refetch } = useQuery<MarketingSettings>({
    queryKey: ["marketing", "settings"],
    queryFn: async () => (await apiRequest("GET", "/api/marketing/settings")).json(),
  });

  if(isError)return <div role="alert">Could not load settings. <button className={secondaryBtn} onClick={()=>refetch()}>Retry</button></div>;
  if (!data) return <LoadingBlock />;
  return (
    <div className="max-w-lg rounded-xl border border-border bg-card p-5">
      <SectionTitle>Automation settings</SectionTitle>
      {/* Key on the fetch's updatedAt so a refetch after save re-seeds the form. */}
      <SettingsForm key={String(data.updatedAt)} settings={data} /><MarketingPreferences/><MarketingReviewChecks/><MarketingHistory/>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "reviews", label: "Reviews" },
  { id: "portfolio", label: "Portfolio" },
  { id: "connections", label: "Connections" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function MarketingPage() {
  const {user}=useAuth();const manager=['owner','manager'].includes(user?.role||'');
  const [tab, setTab] = useMarketingPlace<TabId>("tab","overview");
  useEffect(()=>{if(!manager&&!['reviews','portfolio'].includes(tab))setTab("portfolio");},[manager,tab]);

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Marketing" description="Website inquiries, job outcomes, reviews and approved project photos" />

      <div className="mb-6 flex flex-wrap gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.filter(t=>manager||['reviews','portfolio'].includes(t.id)).map((t) => (
          <button
            aria-pressed={tab===t.id} key={t.id}
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
      {tab === "campaigns" && <GrowthReport view="campaigns"/>}
      {tab === "connections" && <GrowthReport view="connections"/>}
      {tab === "reviews" && <ReviewsTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
