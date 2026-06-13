import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthToken } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { type Settings } from "@shared/schema";
import Header from "@/components/Header";
import { formatDateTime } from "@/lib/format";
import { Loader2, Save, Upload, Plug, Unplug, RefreshCw, ExternalLink } from "lucide-react";

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
    refetchInterval: false,
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

interface QbStatus {
  connected: boolean;
  configured: boolean;
  realmId?: string;
  environment?: string;
  lastSyncAt?: number | null;
  reconnectNeeded?: boolean;
  queue?: { pending: number; error: number; manual: number };
  unmapped?: { items: number; projects: number };
}

function QuickBooksCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: status } = useQuery<QbStatus>({
    queryKey: ["qb-status"],
    queryFn: async () => (await apiRequest("GET", "/api/qb/status")).json(),
  });

  // Intuit redirects back to "/?qb=connected#/settings" — surface the result
  // once and clean the URL so refreshes don't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qb = params.get("qb");
    if (!qb) return;
    if (qb === "connected") {
      toast({ variant: "success", title: "QuickBooks connected", description: "Run a sync to pull items and purchase orders." });
      qc.invalidateQueries({ queryKey: ["qb-status"] });
    } else {
      toast({ variant: "destructive", title: "QuickBooks connection failed", description: params.get("qbmsg") ?? undefined });
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, [qc]);

  function connect() {
    setBusy(true);
    // Full-page hop to the public connect endpoint, which 302s to Intuit's
    // consent screen. Same URL we give Intuit as the Connect/Reconnect URL.
    window.location.href = "/api/qb/connect";
  }

  async function syncNow() {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/qb/sync");
      const s = await res.json();
      toast({
        variant: "success",
        title: "Synced",
        description: `${s.purchaseOrders} POs, ${s.items} items, ${s.customers} customers pulled.`,
      });
      qc.invalidateQueries({ queryKey: ["qb-status"] });
      qc.invalidateQueries({ queryKey: ["pos"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sync failed", description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/qb/disconnect");
      toast({ variant: "success", title: "QuickBooks disconnected" });
      qc.invalidateQueries({ queryKey: ["qb-status"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Disconnect failed", description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  const needsAttention =
    (status?.queue?.error ?? 0) + (status?.queue?.manual ?? 0) +
    (status?.unmapped?.items ?? 0) + (status?.unmapped?.projects ?? 0);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">QuickBooks Online</h2>
        <span
          className={
            "rounded-full px-2.5 py-0.5 text-xs font-medium " +
            (status?.connected
              ? status.reconnectNeeded
                ? "bg-orange-500/15 text-orange-400"
                : "bg-green-500/15 text-green-400"
              : "bg-secondary text-secondary-foreground")
          }
        >
          {status?.connected ? (status.reconnectNeeded ? "Reconnect needed" : "Connected") : "Not connected"}
        </span>
        {status?.environment === "sandbox" && status?.connected && (
          <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">Sandbox</span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        POs are pulled from QuickBooks; project part-issues are pushed back as
        zero-dollar job costs. The bookkeeper keeps owning POs and Bills.
        {status?.connected && status.lastSyncAt ? ` Last sync ${formatDateTime(status.lastSyncAt)}.` : ""}
      </p>

      {status?.connected && needsAttention > 0 && (
        <p className="mb-3 text-sm text-orange-400">
          {status.unmapped?.items ? `${status.unmapped.items} unmapped items. ` : ""}
          {status.unmapped?.projects ? `${status.unmapped.projects} unmapped projects. ` : ""}
          {status.queue?.error ? `${status.queue.error} failed pushes. ` : ""}
          {status.queue?.manual ? `${status.queue.manual} adjustments to enter in QBO by hand.` : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!status?.connected || status.reconnectNeeded ? (
          <button
            onClick={connect}
            disabled={busy || status?.configured === false}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plug className="h-5 w-5" />}
            Connect to QuickBooks
          </button>
        ) : null}
        {status?.connected && (
          <>
            <button
              onClick={syncNow}
              disabled={busy}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
              Sync now
            </button>
            <Link
              href="/qb"
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary"
            >
              <ExternalLink className="h-5 w-5" />
              Mapping & queue
            </Link>
            <button
              onClick={disconnect}
              disabled={busy}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-destructive hover:border-destructive disabled:opacity-60"
            >
              <Unplug className="h-5 w-5" />
              Disconnect
            </button>
          </>
        )}
        {status?.configured === false && (
          <p className="self-center text-sm text-muted-foreground">
            Set QB_CLIENT_ID / QB_CLIENT_SECRET in .env first.
          </p>
        )}
      </div>

      {/* Intuit requires public Privacy Policy and EULA URLs when applying for
          production keys — these are the links to hand them. */}
      <p className="mt-4 text-sm text-muted-foreground">
        Public legal pages (give these URLs to Intuit):{" "}
        <a href="/privacy" target="_blank" rel="noopener" className="text-primary hover:underline">Privacy Policy</a>
        <span className="mx-1.5">·</span>
        <a href="/eula" target="_blank" rel="noopener" className="text-primary hover:underline">EULA</a>
      </p>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Settings" description="Branding & integrations" />
      <div className="flex flex-col gap-5">
        <BrandingTab />
        <QuickBooksCard />
      </div>
    </div>
  );
}
