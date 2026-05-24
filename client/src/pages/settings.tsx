import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthToken } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { AREAS, type Settings, type MapLayout, type Area } from "@shared/schema";
import { AREA_LABELS } from "@/lib/format";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { Loader2, Save, Plus, Trash2, Upload } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function applyAccent(h: number, s: number, l: number) {
  const root = document.documentElement;
  for (const v of ["--primary", "--accent", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"]) {
    root.style.setProperty(v, `${h} ${s}% ${l}%`);
  }
}

function BrandingTab() {
  const qc = useQueryClient();
  const logoRef = useRef<HTMLInputElement>(null);
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [hue, setHue] = useState(24);
  const [sat, setSat] = useState(90);
  const [light, setLight] = useState(50);
  const [uploading, setUploading] = useState(false);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await apiRequest("GET", "/api/settings")).json(),
  });

  useEffect(() => {
    if (!settings) return;
    setCompanyName(settings.companyName);
    setTagline(settings.companyTagline ?? "");
    setLogoUrl(settings.logoUrl ?? null);
    setHue(settings.accentHue);
    setSat(settings.accentSat);
    setLight(settings.accentLight);
  }, [settings]);

  useEffect(() => {
    applyAccent(hue, sat, light);
  }, [hue, sat, light]);

  const saveMut = useMutation({
    mutationFn: async () =>
      apiRequest("PUT", "/api/settings", {
        companyName: companyName.trim(),
        companyTagline: tagline.trim(),
        logoUrl,
        accentHue: hue,
        accentSat: sat,
        accentLight: light,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ variant: "success", title: "Branding saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.message }),
  });

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const token = getAuthToken();
      const res = await fetch("/api/upload", { method: "POST", headers: token ? { "X-Auth": token } : {}, body: fd });
      if (!res.ok) throw new Error("Upload failed");
      setLogoUrl((await res.json()).url);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Company name</span>
            <input className={inputCls} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Tagline</span>
            <input className={inputCls} value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-4">
          {logoUrl && <img src={logoUrl} alt="Logo" className="h-14 w-14 rounded-lg border border-border object-contain" />}
          <button
            onClick={() => logoRef.current?.click()}
            disabled={uploading}
            className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            Upload logo
          </button>
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-base font-semibold text-foreground">Accent color</h2>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl" style={{ background: `hsl(${hue} ${sat}% ${light}%)` }} />
          <div className="flex-1 space-y-3">
            {[
              { label: "Hue", val: hue, set: setHue, max: 360 },
              { label: "Saturation", val: sat, set: setSat, max: 100 },
              { label: "Lightness", val: light, set: setLight, max: 100 },
            ].map((s) => (
              <div key={s.label}>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{s.label}</span>
                  <span>{s.val}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={s.max}
                  value={s.val}
                  onChange={(e) => s.set(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={() => saveMut.mutate()}
        disabled={saveMut.isPending}
        className="flex h-12 w-fit items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {saveMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
        Save branding
      </button>
    </div>
  );
}

function MapsTab() {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [area, setArea] = useState<Area>("main_shop");

  const { data: layouts = [] } = useQuery<MapLayout[]>({
    queryKey: ["map-layouts"],
    queryFn: async () => (await apiRequest("GET", "/api/map-layouts")).json(),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["map-layouts"] });

  const create = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/map-layouts", { key: key.trim(), label: label.trim(), area, nodes: [] }),
    onSuccess: () => {
      setKey("");
      setLabel("");
      invalidate();
      toast({ variant: "success", title: "Map added" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not add", description: e?.message }),
  });
  const update = useMutation({
    mutationFn: async ({ k, patch }: { k: string; patch: any }) =>
      apiRequest("PUT", `/api/map-layouts/${k}`, patch),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: async (k: string) => apiRequest("DELETE", `/api/map-layouts/${k}`),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim() || !label.trim()) {
            toast({ variant: "destructive", title: "Key and label are required" });
            return;
          }
          create.mutate();
        }}
        className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Key (slug)</span>
          <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="north_yard" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Label</span>
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Area</span>
          <select className={inputCls} value={area} onChange={(e) => setArea(e.target.value as Area)}>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" /> Add
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {layouts.map((l) => (
          <li
            key={l.key}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <input
              className={cn(inputCls, "max-w-[200px]")}
              defaultValue={l.label}
              onBlur={(e) =>
                e.target.value !== l.label && update.mutate({ k: l.key, patch: { label: e.target.value } })
              }
            />
            <select
              className={cn(inputCls, "max-w-[180px]")}
              defaultValue={l.area}
              onChange={(e) => update.mutate({ k: l.key, patch: { area: e.target.value } })}
            >
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {AREA_LABELS[a]}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs text-muted-foreground">{l.key}</span>
            <button
              onClick={() => del.mutate(l.key)}
              className="ml-auto text-muted-foreground hover:text-destructive"
              aria-label="Delete map"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"branding" | "maps">("branding");

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Settings" description="Branding and shop maps" />

      <div className="mb-6 flex gap-2">
        {(["branding", "maps"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "maps" ? "Shop maps" : "Branding"}
          </button>
        ))}
      </div>

      {tab === "branding" ? <BrandingTab /> : <MapsTab />}
    </div>
  );
}
