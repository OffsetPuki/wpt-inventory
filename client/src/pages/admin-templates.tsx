import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import {
  CATEGORIES,
  type Category,
  type JobTemplate,
  type TemplateParam,
  type TemplatePart,
} from "@shared/schema";
import { CATEGORY_LABELS } from "@/lib/format";
import Header from "@/components/Header";
import LucideIcon from "@/components/LucideIcon";
import { cn } from "@/lib/utils";
import { ChevronDown, Plus, Trash2, Save, Loader2, Calculator } from "lucide-react";

const NONE = "__none__";
const inputCls =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function parseParams(t: JobTemplate): TemplateParam[] {
  try { return JSON.parse(t.params as unknown as string); } catch { return []; }
}
function parseParts(t: JobTemplate): TemplatePart[] {
  try { return JSON.parse(t.parts as unknown as string); } catch { return []; }
}

function TemplateCard({ tpl }: { tpl: JobTemplate }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(tpl.label);
  const [blurb, setBlurb] = useState(tpl.blurb ?? "");
  const [icon, setIcon] = useState(tpl.icon);
  const [params, setParams] = useState<TemplateParam[]>(parseParams(tpl));
  const [parts, setParts] = useState<TemplatePart[]>(parseParts(tpl));
  const [preview, setPreview] = useState<{ label: string; qty: number; unit?: string }[] | null>(null);

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("PUT", `/api/job-templates/${tpl.key}`, { label, blurb, icon, params, parts }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-templates"] });
      toast({ variant: "success", title: "Template saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.message }),
  });
  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/job-templates/${tpl.key}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-templates"] });
      toast({ variant: "success", title: "Template deleted" });
    },
  });
  const runPreview = useMutation({
    mutationFn: async () => {
      const p: Record<string, any> = {};
      for (const par of params) p[par.key] = par.defaultValue ?? "";
      const res = await apiRequest("POST", `/api/job-templates/${tpl.key}/preview`, { params: p });
      return res.json();
    },
    onSuccess: (rows) => setPreview(rows),
    onError: (e: any) => toast({ variant: "destructive", title: "Preview failed", description: e?.message }),
  });

  function updateParam(i: number, patch: Partial<TemplateParam>) {
    setParams(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function updatePart(i: number, patch: Partial<TemplatePart>) {
    setParts(parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-4 text-left">
        <LucideIcon name={icon} className="h-5 w-5 text-primary" />
        <span className="font-semibold text-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{tpl.key}</span>
        <ChevronDown className={cn("ml-auto h-5 w-5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-5 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Label</span>
              <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Icon</span>
              <input className={inputCls} value={icon} onChange={(e) => setIcon(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-muted-foreground">Blurb</span>
              <input className={inputCls} value={blurb} onChange={(e) => setBlurb(e.target.value)} /></label>
          </div>

          {/* Params */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">Parameters</p>
            <div className="flex flex-col gap-2">
              {params.map((p, i) => (
                <div key={i} className="grid items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_100px_1fr_auto]">
                  <input className={inputCls} placeholder="key" value={p.key} onChange={(e) => updateParam(i, { key: e.target.value })} />
                  <input className={inputCls} placeholder="Label" value={p.label} onChange={(e) => updateParam(i, { label: e.target.value })} />
                  <select className={inputCls} value={p.kind} onChange={(e) => updateParam(i, { kind: e.target.value as TemplateParam["kind"] })}>
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                    <option value="select">Select</option>
                  </select>
                  <input className={inputCls} placeholder="default" value={String(p.defaultValue ?? "")} onChange={(e) => updateParam(i, { defaultValue: e.target.value })} />
                  <button onClick={() => setParams(params.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  {p.kind === "select" && (
                    <input className={cn(inputCls, "sm:col-span-5")} placeholder="Options (comma-separated)" value={(p.options ?? []).join(", ")} onChange={(e) => updateParam(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  )}
                </div>
              ))}
              <button onClick={() => setParams([...params, { key: "", label: "", kind: "number" }])} className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                <Plus className="h-4 w-4" /> Add parameter
              </button>
            </div>
          </div>

          {/* Parts */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">Parts</p>
            <div className="flex flex-col gap-2">
              {parts.map((p, i) => (
                <div key={i} className="grid items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1.5fr_1fr_1fr_70px_auto]">
                  <input className={inputCls} placeholder="Label" value={p.label} onChange={(e) => updatePart(i, { label: e.target.value })} />
                  <select className={inputCls} value={p.category ?? NONE} onChange={(e) => updatePart(i, { category: e.target.value === NONE ? undefined : (e.target.value as Category) })}>
                    <option value={NONE}>No category</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <input className={inputCls} placeholder="qty or formula" value={String(p.qty ?? "")} onChange={(e) => updatePart(i, { qty: e.target.value })} />
                  <input className={inputCls} placeholder="unit" value={p.unit ?? ""} onChange={(e) => updatePart(i, { unit: e.target.value || undefined })} />
                  <button onClick={() => setParts(parts.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button onClick={() => setParts([...parts, { label: "", qty: 1 }])} className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                <Plus className="h-4 w-4" /> Add part
              </button>
            </div>
          </div>

          {/* Preview */}
          <div>
            <button onClick={() => runPreview.mutate()} disabled={runPreview.isPending} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60">
              {runPreview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Preview math
            </button>
            <p className="mt-1 text-xs text-muted-foreground">Uses saved parts + parameter defaults. Save first to preview edits.</p>
            {preview && (
              <ul className="mt-3 flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
                {preview.map((r, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-foreground">{r.label}</span>
                    <span className="font-medium text-muted-foreground">{r.qty} {r.unit ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => del.mutate()} className="flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminTemplatesPage() {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  const { data: templates = [], isLoading } = useQuery<JobTemplate[]>({
    queryKey: ["job-templates"],
    queryFn: async () => (await apiRequest("GET", "/api/job-templates")).json(),
    refetchInterval: false,
  });
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/job-templates", { key: key.trim(), label: label.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-templates"] });
      setKey(""); setLabel("");
      toast({ variant: "success", title: "Template created" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not create", description: e?.message }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Job Templates" description="Checklists with formula-driven quantities" />

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map((t) => <TemplateCard key={t.key} tpl={t} />)}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); if (!key.trim() || !label.trim()) { toast({ variant: "destructive", title: "Key and label required" }); return; } create.mutate(); }}
        className="mt-6 grid items-end gap-3 rounded-xl border border-dashed border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]"
      >
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">New template key</span>
          <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="custom_job" /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Label</span>
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <button type="submit" className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Create
        </button>
      </form>
    </div>
  );
}
