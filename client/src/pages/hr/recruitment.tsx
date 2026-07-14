import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { Chip } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import {
  OPENING_STATUSES,
  OPENING_STATUS_LABELS,
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_LABELS,
  type JobOpening,
  type Candidate,
  type OpeningStatus,
  type CandidateStage,
} from "@shared/hr-schema";
import { Loader2, Plus, Briefcase, Pencil, Trash2, Star, UserPlus } from "lucide-react";

const textareaCls =
  "min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const OPENING_CHIP: Record<OpeningStatus, string> = {
  open: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  on_hold: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  closed: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
};

type OpeningRow = JobOpening & { candidateCount: number };

function daysSince(value: Date | number | string | null | undefined): number {
  if (!value) return 0;
  const t = new Date(value as any).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
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
      {value > 0 && (
        <span className="ml-1 text-sm text-muted-foreground">{value}/5</span>
      )}
    </div>
  );
}

// ─── Opening dialog ───────────────────────────────────────────────────────────

function OpeningDialog({
  opening,
  onClose,
  onDeleted,
}: {
  opening: JobOpening | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const [title, setTitle] = useState(opening?.title ?? "");
  const [department, setDepartment] = useState(opening?.department ?? "");
  const [status, setStatus] = useState<OpeningStatus>(opening?.status ?? "open");
  const [postedAt, setPostedAt] = useState(opening?.postedAt ?? "");
  const [description, setDescription] = useState(opening?.description ?? "");

  const save = useApiMutation({
    request: () => {
      const body = {
        title: title.trim(),
        department: department.trim() || null,
        status,
        postedAt: postedAt || null,
        description: description.trim() || null,
      };
      return opening
        ? { method: "PATCH", url: `/api/hr/openings/${opening.id}`, body }
        : { method: "POST", url: "/api/hr/openings", body };
    },
    invalidate: [["hr-openings"]],
    successTitle: opening ? "Opening updated" : "Opening created",
    errorTitle: "Could not save opening",
    onSuccess: onClose,
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/hr/openings/${opening!.id}` }),
    invalidate: [["hr-openings"]],
    successTitle: "Opening removed",
    errorTitle: "Could not remove opening",
    onSuccess: () => {
      onDeleted(opening!.id);
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={opening ? "Edit opening" : "New job opening"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Title is required" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Department</span>
            <input
              className={inputCls}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as OpeningStatus)}
            >
              {OPENING_STATUSES.map((s) => (
                <option key={s} value={s}>{OPENING_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Posted date</span>
          <input
            type="date"
            className={inputCls}
            value={postedAt}
            onChange={(e) => setPostedAt(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Description</span>
          <textarea
            className={textareaCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="mt-1 flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            {opening ? "Save changes" : "Create opening"}
          </button>
          {opening && (
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => {
                if (window.confirm("Remove this opening? Its candidates will be hidden with it."))
                  del.mutate();
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

// ─── Candidate dialog ─────────────────────────────────────────────────────────

function CandidateDialog({
  candidate,
  openingId,
  onClose,
}: {
  candidate: Candidate | null;
  openingId: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(candidate?.name ?? "");
  const [email, setEmail] = useState(candidate?.email ?? "");
  const [phone, setPhone] = useState(candidate?.phone ?? "");
  const [stage, setStage] = useState<CandidateStage>(candidate?.stage ?? "applied");
  const [rating, setRating] = useState(candidate?.rating ?? 0);
  const [notes, setNotes] = useState(candidate?.notes ?? "");

  const save = useApiMutation({
    request: () => {
      const body = {
        openingId,
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        stage,
        rating: rating || null,
        notes: notes.trim() || null,
      };
      return candidate
        ? { method: "PATCH", url: `/api/hr/candidates/${candidate.id}`, body }
        : { method: "POST", url: "/api/hr/candidates", body };
    },
    invalidate: [["hr-candidates"], ["hr-openings"]],
    successTitle: candidate ? "Candidate updated" : "Candidate added",
    errorTitle: "Could not save candidate",
    onSuccess: onClose,
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/hr/candidates/${candidate!.id}` }),
    invalidate: [["hr-candidates"], ["hr-openings"]],
    successTitle: "Candidate deleted",
    errorTitle: "Could not delete",
    onSuccess: onClose,
  });

  return (
    <Modal open onClose={onClose} title={candidate ? "Edit candidate" : "Add candidate"}>
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
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email</span>
            <input
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Phone</span>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        {candidate && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Stage</span>
            <select
              className={inputCls}
              value={stage}
              onChange={(e) => setStage(e.target.value as CandidateStage)}
            >
              {CANDIDATE_STAGES.map((s) => (
                <option key={s} value={s}>{CANDIDATE_STAGE_LABELS[s]}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Rating</span>
          <RatingInput value={rating} onChange={setRating} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes</span>
          <textarea
            className={textareaCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="mt-1 flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            {candidate ? "Save changes" : "Add candidate"}
          </button>
          {candidate && (
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => {
                if (window.confirm(`Delete candidate ${candidate.name}?`)) del.mutate();
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

export default function HrRecruitmentPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openingDialog, setOpeningDialog] = useState<{ open: boolean; opening: JobOpening | null }>(
    { open: false, opening: null }
  );
  const [candidateDialog, setCandidateDialog] = useState<{
    open: boolean;
    candidate: Candidate | null;
  }>({ open: false, candidate: null });

  const { data: openings = [], isLoading } = useQuery<OpeningRow[]>({
    queryKey: ["hr-openings"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/openings")).json(),
  });

  const selected = openings.find((o) => o.id === selectedId) ?? openings[0] ?? null;

  const { data: candidates = [], isLoading: candidatesLoading } = useQuery<Candidate[]>({
    queryKey: ["hr-candidates", selected?.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/hr/candidates?openingId=${selected!.id}`)).json(),
    enabled: !!selected,
  });

  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: CandidateStage }) =>
      (await apiRequest("PATCH", `/api/hr/candidates/${id}`, { stage })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-candidates"] });
      qc.invalidateQueries({ queryKey: ["hr-openings"] });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Could not move candidate", description: e?.message });
      qc.invalidateQueries({ queryKey: ["hr-candidates"] });
    },
  });

  return (
    <div className="mx-auto max-w-full">
      <Header title="Recruitment" description="Job openings and the candidate pipeline">
        <button
          onClick={() => setOpeningDialog({ open: true, opening: null })}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New opening
        </button>
      </Header>

      {isLoading ? (
        <LoadingBlock />
      ) : openings.length === 0 ? (
        <EmptyState icon={Briefcase} message="No job openings yet">
          <button
            onClick={() => setOpeningDialog({ open: true, opening: null })}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Post your first opening
          </button>
        </EmptyState>
      ) : (
        <>
          <div className="mb-8 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Posted</th>
                  <th className="px-4 py-3 text-right font-medium">Candidates</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {openings.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedId(o.id)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-accent/50",
                      selected?.id === o.id && "bg-primary/5"
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{o.title}</td>
                    <td className="px-4 py-3 text-foreground">{o.department ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Chip className={OPENING_CHIP[o.status]}>
                        {OPENING_STATUS_LABELS[o.status]}
                      </Chip>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {o.postedAt ? formatDate(o.postedAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {o.candidateCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpeningDialog({ open: true, opening: o });
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Edit opening"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <section>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                  Pipeline — {selected.title}
                </h2>
                <button
                  onClick={() => setCandidateDialog({ open: true, candidate: null })}
                  className="ml-auto flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
                >
                  <UserPlus className="h-5 w-5" />
                  Add candidate
                </button>
              </div>

              {candidatesLoading ? (
                <LoadingBlock />
              ) : (
                <div className="overflow-x-auto pb-4">
                  <div className="flex gap-3">
                    {CANDIDATE_STAGES.map((stage) => {
                      const inStage = candidates.filter((c) => c.stage === stage);
                      return (
                        <div
                          key={stage}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = Number(e.dataTransfer.getData("text/plain"));
                            const c = candidates.find((x) => x.id === id);
                            if (c && c.stage !== stage) move.mutate({ id, stage });
                          }}
                          className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-card p-3"
                        >
                          <div className="flex items-center justify-between px-1">
                            <span className="text-sm font-semibold text-foreground">
                              {CANDIDATE_STAGE_LABELS[stage]}
                            </span>
                            <Chip className="bg-muted text-muted-foreground">
                              {inStage.length}
                            </Chip>
                          </div>
                          {inStage.length === 0 ? (
                            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                              Drop candidates here
                            </p>
                          ) : (
                            inStage.map((c) => (
                              <div
                                key={c.id}
                                draggable
                                onDragStart={(e) =>
                                  e.dataTransfer.setData("text/plain", String(c.id))
                                }
                                onClick={() =>
                                  setCandidateDialog({ open: true, candidate: c })
                                }
                                className="cursor-grab rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/50"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                                  <span
                                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                                    title="Days in pipeline"
                                  >
                                    {daysSince(c.createdAt)}d
                                  </span>
                                </div>
                                <div className="mt-1.5">
                                  <Stars rating={c.rating} />
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {openingDialog.open && (
        <OpeningDialog
          opening={openingDialog.opening}
          onClose={() => setOpeningDialog({ open: false, opening: null })}
          onDeleted={(id) => {
            if (selectedId === id) setSelectedId(null);
          }}
        />
      )}
      {candidateDialog.open && selected && (
        <CandidateDialog
          candidate={candidateDialog.candidate}
          openingId={selected.id}
          onClose={() => setCandidateDialog({ open: false, candidate: null })}
        />
      )}
    </div>
  );
}
