import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/Header";
import { toast } from "@/components/ui/toaster";
import { Loader2, Mail, Plus, RotateCcw, Trash2 } from "lucide-react";

// ─── Emails ──────────────────────────────────────────────────────────────────
// Every automated email that leaves the shop, in one place: read the wording,
// rewrite it, switch one off, or add a new one timed off something the suite
// already knows happened.
//
// Not shown: the "[CJM Suite]" alerts to the owner. Those are diagnostics, not
// correspondence — several are generated tables, and nobody outside sees them.

interface TemplateVar { token: string; meaning: string; optional?: boolean }

interface Template {
  id: string;
  name: string;
  audience: "customer" | "employee";
  trigger: string;
  subject: string;
  body: string;
  vars: TemplateVar[];
  enabled: boolean;
  custom: boolean;
  canDisable: boolean;
  edited?: boolean;
  locked?: string;
  defaultSubject?: string;
  defaultBody?: string;
  anchor?: string | null;
  delayDays?: number;
}

interface Anchor { key: string; label: string; vars: TemplateVar[] }

const AUDIENCE_LABEL: Record<string, string> = {
  customer: "To the customer",
  employee: "To the employee",
};

export default function EmailsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery<{ templates: Template[]; anchors: Anchor[]; lockedNote: string }>({
    queryKey: ["email-templates"],
    queryFn: async () => (await apiRequest("GET", "/api/email-templates")).json(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["email-templates"] });

  const save = useMutation({
    mutationFn: async (v: { id: string; subject?: string; body?: string; enabled?: boolean }) =>
      (await apiRequest("PUT", `/api/email-templates/${encodeURIComponent(v.id)}`, v)).json(),
    onSuccess: () => { refresh(); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ variant: "destructive", title: "Not saved", description: e?.message }),
  });

  const reset = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("DELETE", `/api/email-templates/${encodeURIComponent(id)}`)).json(),
    onSuccess: () => { refresh(); setOpenId(null); toast({ title: "Back to the original wording" }); },
    onError: (e: any) => toast({ variant: "destructive", title: "Failed", description: e?.message }),
  });

  const create = useMutation({
    mutationFn: async (v: Record<string, unknown>) =>
      (await apiRequest("POST", "/api/email-templates", v)).json(),
    onSuccess: (r: any) => {
      refresh();
      setCreating(false);
      toast({
        title: "Email created",
        description: r?.backlogSuppressed
          ? `It'll go out from now on. ${r.backlogSuppressed} past record${r.backlogSuppressed === 1 ? "" : "s"} skipped so nobody gets a late surprise.`
          : "It'll go out when the event next happens.",
      });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Not created", description: e?.message }),
  });

  const runPreview = async (subject: string, body: string) => {
    const res = await apiRequest("POST", "/api/email-templates/preview", { subject, body });
    setPreview(await res.json());
  };

  const open = (t: Template) => {
    setOpenId(t.id);
    setDraft({ subject: t.subject, body: t.body });
    setPreview(null);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const templates = data?.templates ?? [];
  const anchors = data?.anchors ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <Header
        title="Emails"
        description="Everything the suite sends out under your name. Change the wording, switch one off, or add your own."
      >
        <button
          onClick={() => { setCreating(true); setOpenId(null); }}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> New email
        </button>
      </Header>

      {creating && <NewEmailForm anchors={anchors} onCancel={() => setCreating(false)} onCreate={(v) => create.mutate(v)} busy={create.isPending} />}

      <ul className="mt-4 flex flex-col gap-3">
        {templates.map((t) => (
          <li key={t.id} className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <Mail className={`h-5 w-5 shrink-0 ${t.enabled ? "text-primary" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {AUDIENCE_LABEL[t.audience] ?? t.audience}
                  </span>
                  {t.custom && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Yours</span>}
                  {t.edited && !t.custom && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Edited</span>}
                  {!t.enabled && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">Off</span>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t.trigger}</p>
              </div>

              <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  disabled={!t.canDisable || save.isPending}
                  title={t.canDisable ? "Send this email" : "This one always sends"}
                  onChange={(e) => save.mutate({ id: t.id, enabled: e.target.checked })}
                />
                On
              </label>

              <button
                onClick={() => (openId === t.id ? setOpenId(null) : open(t))}
                className="shrink-0 rounded-lg border border-input px-3 py-2 text-sm"
              >
                {openId === t.id ? "Close" : "Edit wording"}
              </button>
            </div>

            {openId === t.id && (
              <div className="border-t border-border p-4">
                {t.locked ? (
                  <p className="text-sm text-muted-foreground">{t.locked}</p>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-foreground">Subject</label>
                    <input
                      value={draft.subject}
                      onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
                    />

                    <label className="mt-4 block text-sm font-medium text-foreground">Message</label>
                    <textarea
                      value={draft.body}
                      onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      rows={12}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm leading-relaxed"
                    />

                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground">
                        Click to insert. Anything in double braces is filled in when the email goes out.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {t.vars.map((v) => (
                          <button
                            key={v.token}
                            title={v.meaning}
                            onClick={() => setDraft((d) => ({ ...d, body: `${d.body}{{${v.token}}}` }))}
                            className="rounded-full border border-input px-2 py-1 font-mono text-xs text-foreground"
                          >
                            {`{{${v.token}}}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => save.mutate({ id: t.id, subject: draft.subject, body: draft.body })}
                        disabled={save.isPending}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => runPreview(draft.subject, draft.body)}
                        className="rounded-lg border border-input px-4 py-2 text-sm"
                      >
                        Preview
                      </button>
                      {t.custom ? (
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${t.name}"? It stops sending immediately.`)) reset.mutate(t.id);
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-input px-4 py-2 text-sm text-destructive"
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (window.confirm("Put the original wording back?")) reset.mutate(t.id);
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-input px-4 py-2 text-sm"
                        >
                          <RotateCcw className="h-4 w-4" /> Original wording
                        </button>
                      )}
                    </div>

                    {preview && (
                      <div className="mt-4 rounded-lg border border-border bg-background p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          What the customer gets (with example details)
                        </p>
                        <p className="mt-2 font-medium text-foreground">{preview.subject}</p>
                        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted-foreground">{preview.text}</pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewEmailForm({
  anchors, onCancel, onCreate, busy,
}: {
  anchors: Anchor[];
  onCancel: () => void;
  onCreate: (v: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [anchor, setAnchor] = useState(anchors[0]?.key ?? "");
  const [delayDays, setDelayDays] = useState(30);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const vars = anchors.find((a) => a.key === anchor)?.vars ?? [];

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4">
      <h3 className="font-medium text-foreground">New automated email</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Goes out once per customer, the given number of days after the event. Anyone
        already past that point when you save is skipped, so nobody gets a late surprise.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-foreground">What is it for?</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Warranty check-in"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
          />
        </label>
        <div className="flex gap-2">
          <label className="block w-24">
            <span className="text-sm font-medium text-foreground">Days</span>
            <input
              type="number"
              min={0}
              value={delayDays}
              onChange={(e) => setDelayDays(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
            />
          </label>
          <label className="block flex-1">
            <span className="text-sm font-medium text-foreground">After</span>
            <select
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className="mt-1 h-[42px] w-full rounded-lg border border-input bg-background px-3 text-base"
            >
              {anchors.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="text-sm font-medium text-foreground">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="How's the gate holding up?"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-sm font-medium text-foreground">Message</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={"Hi {{firstName}},\n\nJust checking in..."}
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-2">
        {vars.map((v) => (
          <button
            key={v.token}
            title={v.meaning}
            onClick={() => setBody((b) => `${b}{{${v.token}}}`)}
            className="rounded-full border border-input px-2 py-1 font-mono text-xs"
          >
            {`{{${v.token}}}`}
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          disabled={busy || !name.trim() || !subject.trim() || !body.trim()}
          onClick={() => onCreate({ name: name.trim(), anchor, delayDays, subject, body })}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Create
        </button>
        <button onClick={onCancel} className="rounded-lg border border-input px-4 py-2 text-sm">Cancel</button>
      </div>
    </div>
  );
}
