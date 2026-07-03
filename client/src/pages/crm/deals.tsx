import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, parseMoney } from "@/lib/format";
import {
  DEAL_STAGES,
  WIN_LOSS_REASONS,
  DEAL_STAGE_LABELS,
  WIN_LOSS_REASON_LABELS,
  type Deal,
  type DealStage,
  type WinLossReason,
  type Client,
} from "@shared/crm-schema";
import type { PublicUser } from "@shared/schema";
import { Loader2, Plus, Handshake, LayoutGrid, List } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const chipCls = "rounded-full px-2.5 py-0.5 text-xs font-medium";

const STAGE_STYLE: Record<DealStage, string> = {
  qualified: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  proposal: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  negotiation: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  lost: "bg-red-500/10 text-red-700 dark:text-red-400",
};

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function DealModal({
  deal,
  clients,
  users,
  isElevated,
  onClose,
}: {
  deal: Deal | null;
  clients: Client[];
  users: PublicUser[];
  isElevated: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(deal?.title ?? "");
  const [clientId, setClientId] = useState(deal?.clientId != null ? String(deal.clientId) : "");
  const [value, setValue] = useState(deal?.valueCents ? String(deal.valueCents / 100) : "");
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "qualified");
  const [winLossReason, setWinLossReason] = useState<WinLossReason | "">(deal?.winLossReason ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(deal?.expectedCloseDate ?? "");
  const [ownerId, setOwnerId] = useState(deal?.ownerId != null ? String(deal.ownerId) : "");
  const [notes, setNotes] = useState(deal?.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        clientId: clientId ? parseInt(clientId, 10) : null,
        valueCents: parseMoney(value),
        stage,
        winLossReason: winLossReason || undefined,
        expectedCloseDate: expectedCloseDate || null,
        ...(isElevated ? { ownerId: ownerId ? parseInt(ownerId, 10) : null } : {}),
        notes: notes.trim() || null,
      };
      const res = deal
        ? await apiRequest("PATCH", `/api/crm/deals/${deal.id}`, body)
        : await apiRequest("POST", "/api/crm/deals", body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-deals"] });
      qc.invalidateQueries({ queryKey: ["crm-stats"] });
      toast({ variant: "success", title: deal ? "Deal updated" : "Deal created" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save deal", description: e?.message }),
  });

  return (
    <Modal open onClose={onClose} title={deal ? "Edit deal" : "New deal"} maxWidth="max-w-lg">
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
            <span className="text-sm font-medium text-foreground">Client</span>
            <select className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Value ($)</span>
            <input className={inputCls} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Stage</span>
            <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>{DEAL_STAGE_LABELS[s]}</option>
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
            <span className="text-sm font-medium text-foreground">Expected close</span>
            <input type="date" className={inputCls} value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} />
          </label>
          {isElevated && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Owner</span>
              <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
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
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {deal ? "Save changes" : "Create deal"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Won / lost close dialog ──────────────────────────────────────────────────

function CloseDealModal({
  deal,
  to,
  onClose,
}: {
  deal: Deal;
  to: "won" | "lost";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<WinLossReason | "">(deal.winLossReason ?? "");

  const close = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PATCH", `/api/crm/deals/${deal.id}`, {
          stage: to,
          winLossReason: reason || undefined,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-deals"] });
      qc.invalidateQueries({ queryKey: ["crm-stats"] });
      toast({ variant: "success", title: to === "won" ? "Deal won" : "Deal marked lost" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update deal", description: e?.message }),
  });

  return (
    <Modal open onClose={onClose} title={to === "won" ? `Mark "${deal.title}" won` : `Mark "${deal.title}" lost`}>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const { isElevated } = useAuth();
  const qc = useQueryClient();

  const [view, setView] = useState<"board" | "table">("board");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [closing, setClosing] = useState<{ deal: Deal; to: "won" | "lost" } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);

  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["crm-deals"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/deals")).json(),
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["crm-clients"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/clients")).json(),
  });
  const clientName = (id: number | null) =>
    id == null ? "—" : clients.find((c) => c.id === id)?.name ?? `#${id}`;

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });
  const ownerName = (id: number | null) =>
    id == null ? "—" : users.find((u) => u.id === id)?.name ?? `#${id}`;

  const patchStage = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: DealStage }) =>
      (await apiRequest("PATCH", `/api/crm/deals/${id}`, { stage })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-deals"] });
      qc.invalidateQueries({ queryKey: ["crm-stats"] });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not move deal", description: e?.message }),
  });

  const handleDrop = (dealId: number, target: DealStage) => {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === target) return;
    if (target === "won" || target === "lost") {
      setClosing({ deal, to: target });
    } else {
      patchStage.mutate({ id: dealId, stage: target });
    }
  };

  const openEditor = (deal: Deal | null) => {
    setEditing(deal);
    setEditorOpen(true);
  };

  const toggleBtn = (active: boolean) =>
    cn(
      "flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <div className="mx-auto max-w-full">
      <Header title="Deals" description="Track larger opportunities through to close">
        <div className="flex items-center gap-1 rounded-xl border border-border p-1">
          <button className={toggleBtn(view === "board")} onClick={() => setView("board")}>
            <LayoutGrid className="h-4 w-4" /> Board
          </button>
          <button className={toggleBtn(view === "table")} onClick={() => setView("table")}>
            <List className="h-4 w-4" /> Table
          </button>
        </div>
        <button
          onClick={() => openEditor(null)}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New deal
        </button>
      </Header>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : deals.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Handshake className="h-12 w-12" />
          <p className="text-lg">No deals yet</p>
          <button
            onClick={() => openEditor(null)}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Add your first deal
          </button>
        </div>
      ) : view === "board" ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex items-start gap-3">
            {DEAL_STAGES.map((s) => {
              const column = deals.filter((d) => d.stage === s);
              const columnValue = column.reduce((sum, d) => sum + d.valueCents, 0);
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
                    <span className="text-sm font-medium text-foreground">{DEAL_STAGE_LABELS[s]}</span>
                    <span className={cn(chipCls, "bg-muted text-muted-foreground")}>{column.length}</span>
                  </div>
                  <p className="px-2 pb-2 text-xs tabular-nums text-muted-foreground">
                    {formatMoney(columnValue)}
                  </p>
                  <div className="flex flex-col gap-2">
                    {column.map((deal) => (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", String(deal.id))}
                        onClick={() => openEditor(deal)}
                        className="cursor-grab rounded-lg border border-border bg-card p-3 transition-shadow hover:border-primary/50 hover:shadow-md"
                      >
                        <p className="font-medium text-foreground">{deal.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{clientName(deal.clientId)}</p>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="tabular-nums text-foreground">{formatMoney(deal.valueCents)}</span>
                          {deal.expectedCloseDate && (
                            <span className="text-xs text-muted-foreground">
                              {formatDate(deal.expectedCloseDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {column.length === 0 && (
                      <p className="px-2 py-6 text-center text-xs text-muted-foreground">No deals</p>
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
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Expected close</th>
                {isElevated && <th className="px-4 py-3 font-medium">Owner</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deals.map((deal) => (
                <tr
                  key={deal.id}
                  onClick={() => openEditor(deal)}
                  className="cursor-pointer hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{deal.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{clientName(deal.clientId)}</td>
                  <td className="px-4 py-3">
                    <span className={cn(chipCls, STAGE_STYLE[deal.stage])}>
                      {DEAL_STAGE_LABELS[deal.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(deal.valueCents)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—"}
                  </td>
                  {isElevated && (
                    <td className="px-4 py-3 text-muted-foreground">{ownerName(deal.ownerId)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorOpen && (
        <DealModal
          key={editing?.id ?? "new"}
          deal={editing}
          clients={clients}
          users={users}
          isElevated={isElevated}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
        />
      )}
      {closing && (
        <CloseDealModal deal={closing.deal} to={closing.to} onClose={() => setClosing(null)} />
      )}
    </div>
  );
}
