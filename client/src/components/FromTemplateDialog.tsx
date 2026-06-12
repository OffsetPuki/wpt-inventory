import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import type { JobTemplate, TemplateParam } from "@shared/schema";
import Modal from "./Modal";
import LucideIcon from "./LucideIcon";
import { ArrowLeft, Loader2 } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function parseParams(tpl: JobTemplate): TemplateParam[] {
  try {
    return JSON.parse(tpl.params as unknown as string);
  } catch {
    return [];
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: number) => void;
}

export default function FromTemplateDialog({ open, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<JobTemplate | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [jobNumber, setJobNumber] = useState("");
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");

  const { data: templates = [] } = useQuery<JobTemplate[]>({
    queryKey: ["job-templates"],
    queryFn: async () => (await apiRequest("GET", "/api/job-templates")).json(),
    enabled: open,
    // Admin-managed config — basically never changes during a user's session.
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  function reset() {
    setSelected(null);
    setValues({});
    setJobNumber("");
    setName("");
    setCustomer("");
    setNotes("");
  }

  function pick(tpl: JobTemplate) {
    const params = parseParams(tpl);
    const initial: Record<string, any> = {};
    for (const p of params) initial[p.key] = p.defaultValue ?? "";
    setValues(initial);
    setName(tpl.label); // pre-fill project name with template label
    setSelected(tpl);
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/projects/from-template", {
        templateKey: selected!.key,
        params: values,
        jobNumber: jobNumber.trim(),
        name: name.trim(),
        customer: customer.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ variant: "success", title: "Project created" });
      reset();
      onCreated(project.id);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not create", description: e?.message }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobNumber.trim() || !name.trim()) {
      toast({ variant: "destructive", title: "Job number and name are required" });
      return;
    }
    create.mutate();
  }

  function handleClose() {
    reset();
    onClose();
  }

  const enabledTemplates = templates.filter((t) => t.enabled);
  const params = selected ? parseParams(selected) : [];

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={selected ? selected.label : "Start from template"}
      maxWidth="max-w-lg"
    >
      {!selected ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {enabledTemplates.map((t) => (
            <button
              key={t.key}
              onClick={() => pick(t)}
              className="flex flex-col gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary"
            >
              <LucideIcon name={t.icon} className="h-6 w-6 text-primary" />
              <span className="font-semibold text-foreground">{t.label}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{t.blurb}</span>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="-mt-1 inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Pick another template
          </button>

          {params.map((p) => (
            <label key={p.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                {p.label}
                {p.unit ? ` (${p.unit})` : ""}
              </span>
              {p.kind === "select" ? (
                <select
                  className={inputCls}
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                >
                  {(p.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={inputCls}
                  type={p.kind === "number" ? "number" : "text"}
                  step="any"
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                />
              )}
              {p.helper && <span className="text-xs text-muted-foreground">{p.helper}</span>}
            </label>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Job number</span>
              <input
                className={inputCls}
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                placeholder="e.g. WPT-2026-014"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Project name</span>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Customer (optional)</span>
            <input
              className={inputCls}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </label>

          <button
            type="submit"
            disabled={create.isPending}
            className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            Create project & build checklist
          </button>
        </form>
      )}
    </Modal>
  );
}
