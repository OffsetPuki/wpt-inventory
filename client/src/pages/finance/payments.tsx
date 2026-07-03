import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import {
  GATEWAY_KINDS,
  GATEWAY_KIND_LABELS,
  type PaymentGateway,
} from "@shared/finance-schema";
import { ChevronDown, ChevronRight, CreditCard, Loader2 } from "lucide-react";

const GATEWAY_KEYS = [["finance-gateways"], ["finance-stats"]];

// ─── Enabled toggle (checkbox styled as a pill switch) ───────────────────────

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span
        className={cn(
          "h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
          checked ? "bg-primary" : "bg-muted"
        )}
      />
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform",
          checked && "translate-x-5"
        )}
      />
    </label>
  );
}

// ─── Single gateway row ───────────────────────────────────────────────────────

function GatewayRow({ gateway }: { gateway: PaymentGateway }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [configDraft, setConfigDraft] = useState(gateway.config);

  const patch = useMutation({
    mutationFn: async (body: { enabled?: boolean; config?: string }) =>
      (await apiRequest("PATCH", `/api/finance/gateways/${gateway.key}`, body)).json(),
    onSuccess: (_row, body) => {
      GATEWAY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (body.enabled !== undefined) {
        toast({
          variant: "success",
          title: `${gateway.name} ${body.enabled ? "enabled" : "disabled"}`,
        });
      } else {
        toast({ variant: "success", title: "Configuration saved" });
      }
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update", description: e?.message }),
  });

  const saveConfig = () => {
    try {
      JSON.parse(configDraft);
    } catch {
      toast({
        variant: "destructive",
        title: "Invalid JSON",
        description: "The configuration must be a valid JSON string.",
      });
      return;
    }
    patch.mutate({ config: configDraft });
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        {gateway.enabled ? (
          <button
            onClick={() => {
              setExpanded((v) => {
                if (!v) setConfigDraft(gateway.config);
                return !v;
              });
            }}
            aria-label={expanded ? "Collapse configuration" : "Expand configuration"}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{gateway.name}</p>
          {gateway.feesNote && (
            <p className="truncate text-sm text-muted-foreground">{gateway.feesNote}</p>
          )}
        </div>
        <Toggle
          checked={gateway.enabled}
          disabled={patch.isPending}
          onChange={(next) => {
            if (!next) setExpanded(false);
            patch.mutate({ enabled: next });
          }}
          label={`Enable ${gateway.name}`}
        />
      </div>

      {gateway.enabled && expanded && (
        <div className="ml-9 mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              Configuration{" "}
              <span className="font-normal text-muted-foreground">
                — account ids / notes, JSON
              </span>
            </span>
            <textarea
              value={configDraft}
              onChange={(e) => setConfigDraft(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
            />
          </label>
          <button
            onClick={saveConfig}
            disabled={patch.isPending}
            className="flex h-9 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {patch.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save configuration
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { data: gateways = [], isLoading } = useQuery<PaymentGateway[]>({
    queryKey: ["finance-gateways"],
    queryFn: async () => (await apiRequest("GET", "/api/finance/gateways")).json(),
  });

  const enabledCount = gateways.filter((g) => g.enabled).length;
  const groups = GATEWAY_KINDS.map((kind) => ({
    kind,
    rows: gateways.filter((g) => g.kind === kind),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <Header
        title="Payment gateways"
        description="Which ways the business accepts money"
      />

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : gateways.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <CreditCard className="h-12 w-12" />
          <p className="text-lg">No gateways in the registry</p>
        </div>
      ) : (
        <>
          <p className="mb-6 text-lg text-foreground">
            <span className="font-semibold tabular-nums">{enabledCount}</span>
            <span className="text-muted-foreground">
              {" "}
              of {gateways.length} gateways enabled
            </span>
          </p>

          <div className="flex flex-col gap-6">
            {groups.map(({ kind, rows }) => (
              <section key={kind}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {GATEWAY_KIND_LABELS[kind]}
                </h2>
                <div className="divide-y divide-border rounded-xl border border-border bg-card">
                  {rows.map((g) => (
                    <GatewayRow key={g.key} gateway={g} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
