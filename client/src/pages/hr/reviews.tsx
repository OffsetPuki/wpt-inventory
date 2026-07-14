import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { Chip } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { PublicUser } from "@shared/schema";
import {
  REVIEW_STATUSES,
  type Employee,
  type PerformanceReview,
  type PerfReviewStatus,
} from "@shared/hr-schema";
import { Loader2, Plus, Star, ClipboardList, Trash2 } from "lucide-react";

const textareaCls =
  "min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const STATUS_CHIP: Record<PerfReviewStatus, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  final: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};
const STATUS_LABEL: Record<PerfReviewStatus, string> = {
  draft: "Draft",
  final: "Final",
};

type ReviewRow = PerformanceReview & { employeeName: string };

function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            rating && i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          )}
        />
      ))}
    </span>
  );
}

function RatingInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i === value ? 0 : i)}
          aria-label={`${i} star${i === 1 ? "" : "s"}`}
          className="rounded p-0.5 transition-transform hover:scale-110"
        >
          <Star
            className={cn(
              "h-6 w-6",
              i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
            )}
          />
        </button>
      ))}
      {value > 0 && <span className="ml-1 text-sm text-muted-foreground">{value}/5</span>}
    </div>
  );
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function ReviewDialog({
  review,
  onClose,
}: {
  review: ReviewRow | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState(review ? String(review.employeeId) : "");
  const [periodLabel, setPeriodLabel] = useState(review?.periodLabel ?? "");
  const [rating, setRating] = useState(review?.overallRating ?? 0);
  const [strengths, setStrengths] = useState(review?.strengths ?? "");
  const [improvements, setImprovements] = useState(review?.improvements ?? "");
  const [goals, setGoals] = useState(review?.goals ?? "");
  const [status, setStatus] = useState<PerfReviewStatus>(review?.status ?? "draft");
  const [reviewDate, setReviewDate] = useState(review?.reviewDate ?? "");

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["hr-employees"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/employees")).json(),
  });

  const save = useApiMutation({
    request: () => {
      const body = {
        employeeId: Number(employeeId),
        periodLabel: periodLabel.trim(),
        overallRating: rating || null,
        strengths: strengths.trim() || null,
        improvements: improvements.trim() || null,
        goals: goals.trim() || null,
        status,
        reviewDate: reviewDate || null,
        ...(review ? {} : { reviewerId: user?.id ?? null }),
      };
      return review
        ? { method: "PATCH", url: `/api/hr/reviews/${review.id}`, body }
        : { method: "POST", url: "/api/hr/reviews", body };
    },
    invalidate: [["hr-reviews"]],
    successTitle: review ? "Review updated" : "Review created",
    errorTitle: "Could not save review",
    onSuccess: onClose,
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/hr/reviews/${review!.id}` }),
    invalidate: [["hr-reviews"]],
    successTitle: "Review deleted",
    errorTitle: "Could not delete review",
    onSuccess: onClose,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={review ? "Edit review" : "New performance review"}
      maxWidth="max-w-xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!employeeId) {
            toast({ variant: "destructive", title: "Pick an employee" });
            return;
          }
          if (!periodLabel.trim()) {
            toast({ variant: "destructive", title: "Period label is required" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Employee</span>
            <select
              className={inputCls}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Period</span>
            <input
              className={inputCls}
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder='e.g. "H1 2026"'
            />
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Overall rating</span>
          <RatingInput value={rating} onChange={setRating} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Strengths</span>
          <textarea
            className={textareaCls}
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Areas to improve</span>
          <textarea
            className={textareaCls}
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Goals</span>
          <textarea
            className={textareaCls}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as PerfReviewStatus)}
            >
              {REVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Review date</span>
            <input
              type="date"
              className={inputCls}
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-1 flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            {review ? "Save changes" : "Create review"}
          </button>
          {review && (
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => {
                if (window.confirm("Delete this review?")) del.mutate();
              }}
              className="flex h-12 items-center gap-2 rounded-xl border border-border px-4 font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HrReviewsPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; review: ReviewRow | null }>({
    open: false,
    review: null,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["hr-employees"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/employees")).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
  });

  const { data: reviews = [], isLoading } = useQuery<ReviewRow[]>({
    queryKey: ["hr-reviews", employeeId, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (employeeId) params.set("employeeId", employeeId);
      if (status) params.set("status", status);
      const qs = params.toString();
      return (await apiRequest("GET", `/api/hr/reviews${qs ? `?${qs}` : ""}`)).json();
    },
  });

  const reviewerName = (id: number | null) => users.find((u) => u.id === id)?.name ?? "—";

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Performance reviews" description="Ratings, feedback, and goals over time">
        <button
          onClick={() => setDialog({ open: true, review: null })}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New review
        </button>
      </Header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className={cn(inputCls, "sm:w-64")}
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.firstName} {e.lastName}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={cn(inputCls, "sm:w-44")}
        >
          <option value="">All statuses</option>
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : reviews.length === 0 ? (
        <EmptyState icon={ClipboardList} message="No reviews found">
          <button
            onClick={() => setDialog({ open: true, review: null })}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Write the first review
          </button>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Reviewer</th>
                <th className="px-4 py-3 font-medium">Rating</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reviews.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDialog({ open: true, review: r })}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{r.employeeName}</td>
                  <td className="px-4 py-3 text-foreground">{r.periodLabel}</td>
                  <td className="px-4 py-3 text-muted-foreground">{reviewerName(r.reviewerId)}</td>
                  <td className="px-4 py-3">
                    <Stars rating={r.overallRating} />
                  </td>
                  <td className="px-4 py-3">
                    <Chip className={STATUS_CHIP[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Chip>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.reviewDate ? formatDate(r.reviewDate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.open && (
        <ReviewDialog
          review={dialog.review}
          onClose={() => setDialog({ open: false, review: null })}
        />
      )}
    </div>
  );
}
