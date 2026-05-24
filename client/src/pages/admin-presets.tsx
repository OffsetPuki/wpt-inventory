import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { CATEGORIES, type Category, type CustomField, type EquipmentPreset } from "@shared/schema";
import { CATEGORY_LABELS } from "@/lib/format";
import Header from "@/components/Header";
import LucideIcon from "@/components/LucideIcon";
import { cn } from "@/lib/utils";
import { ChevronDown, Plus, Trash2, Save, Loader2, X } from "lucide-react";

const inputCls =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function parseFields(p: EquipmentPreset): CustomField[] {
  try {
    return JSON.parse(p.customFields as unknown as string);
  } catch {
    return [];
  }
}
function parseExamples(p: EquipmentPreset): string[] {
  try {
    return JSON.parse(p.examples as unknown as string);
  } catch {
    return [];
  }
}

function FieldEditor({
  fields,
  onChange,
}: {
  fields: CustomField[];
  onChange: (f: CustomField[]) => void;
}) {
  function update(i: number, patch: Partial<CustomField>) {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f, i) => (
        <div key={i} className="grid items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_110px_80px_auto]">
          <input className={inputCls} placeholder="key" value={f.key} onChange={(e) => update(i, { key: e.target.value })} />
          <input className={inputCls} placeholder="Label" value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
          <select className={inputCls} value={f.kind} onChange={(e) => update(i, { kind: e.target.value as CustomField["kind"] })}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Select</option>
          </select>
          <input className={inputCls} placeholder="unit" value={f.unit ?? ""} onChange={(e) => update(i, { unit: e.target.value || undefined })} />
          <button onClick={() => onChange(fields.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive" aria-label="Remove field">
            <Trash2 className="h-4 w-4" />
          </button>
          {f.kind === "select" && (
            <input
              className={cn(inputCls, "sm:col-span-5")}
              placeholder="Options (comma-separated)"
              value={(f.options ?? []).join(", ")}
              onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          )}
        </div>
      ))}
      <button
        onClick={() => onChange([...fields, { key: "", label: "", kind: "text" }])}
        className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="h-4 w-4" /> Add field
      </button>
    </div>
  );
}

function PresetCard({ preset }: { preset: EquipmentPreset }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(preset.label);
  const [blurb, setBlurb] = useState(preset.blurb ?? "");
  const [icon, setIcon] = useState(preset.icon);
  const [defaultCategory, setDefaultCategory] = useState<Category>(preset.defaultCategory);
  const [examples, setExamples] = useState<string[]>(parseExamples(preset));
  const [exInput, setExInput] = useState("");
  const [fields, setFields] = useState<CustomField[]>(parseFields(preset));

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("PUT", `/api/equipment-presets/${preset.key}`, {
        label, blurb, icon, defaultCategory, examples, customFields: fields,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-presets"] });
      toast({ variant: "success", title: "Preset saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.message }),
  });
  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/equipment-presets/${preset.key}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-presets"] });
      toast({ variant: "success", title: "Preset deleted" });
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-4 text-left">
        <LucideIcon name={icon} className="h-5 w-5 text-primary" />
        <span className="font-semibold text-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{preset.key}</span>
        <ChevronDown className={cn("ml-auto h-5 w-5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Label</span>
              <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Icon (lucide name)</span>
              <input className={inputCls} value={icon} onChange={(e) => setIcon(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-muted-foreground">Blurb</span>
              <input className={inputCls} value={blurb} onChange={(e) => setBlurb(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Default category</span>
              <select className={inputCls} value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select></label>
          </div>

          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">Examples</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                  {ex}
                  <button onClick={() => setExamples(examples.filter((_, idx) => idx !== i))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <input
                className="h-7 w-32 rounded-full border border-dashed border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                placeholder="add + Enter"
                value={exInput}
                onChange={(e) => setExInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && exInput.trim()) {
                    e.preventDefault();
                    setExamples([...examples, exInput.trim()]);
                    setExInput("");
                  }
                }}
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">Custom fields</p>
            <FieldEditor fields={fields} onChange={setFields} />
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

export default function AdminPresetsPage() {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [defaultCategory, setDefaultCategory] = useState<Category>("tools");

  const { data: presets = [], isLoading } = useQuery<EquipmentPreset[]>({
    queryKey: ["equipment-presets"],
    queryFn: async () => (await apiRequest("GET", "/api/equipment-presets")).json(),
  });

  const create = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/equipment-presets", { key: key.trim(), label: label.trim(), defaultCategory }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-presets"] });
      setKey(""); setLabel("");
      toast({ variant: "success", title: "Preset created" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not create", description: e?.message }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Equipment Types" description="Presets that define custom fields for items" />

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {presets.map((p) => <PresetCard key={p.key} preset={p} />)}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); if (!key.trim() || !label.trim()) { toast({ variant: "destructive", title: "Key and label required" }); return; } create.mutate(); }}
        className="mt-6 grid items-end gap-3 rounded-xl border border-dashed border-border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">New preset key</span>
          <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="custom_part" /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Label</span>
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Category</span>
          <select className={inputCls} value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select></label>
        <button type="submit" className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Create
        </button>
      </form>
    </div>
  );
}
