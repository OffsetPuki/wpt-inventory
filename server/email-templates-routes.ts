import type { Express } from "express";
import { z } from "zod";
import { sqlite } from "./storage";
import { audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import {
  ANCHORS, BUILT_INS, LOCKED_NOTE, anchorFor, render, shopSignoff,
} from "./email-templates";

// ─── Emails section ──────────────────────────────────────────────────────────
// Read and rewrite the wording of every automated email, switch individual ones
// off, and create new ones timed off an event the suite already records.
//
// Elevated-only: this text goes out to customers under the shop's name, so it
// sits behind the same gate as pricing and payroll.

const templateEdit = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().max(20_000).optional(),
  enabled: z.boolean().optional(),
});

const customCreate = z.object({
  name: z.string().min(1).max(120),
  anchor: z.string().min(1).max(60),
  delayDays: z.number().int().min(0).max(3650),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
});

interface Row {
  id: string; subject: string | null; body: string | null; enabled: number;
  custom: number; name: string | null; anchor: string | null; delay_days: number | null;
  updated_at: number | null;
}

const rowFor = (id: string): Row | undefined =>
  sqlite.prepare("SELECT * FROM email_templates WHERE id = ?").get(id) as Row | undefined;

/** Sample values so the owner sees a realistic preview, not raw {{tokens}}. */
const SAMPLE: Record<string, string> = {
  firstName: "Amy",
  customerName: "Amy Linton",
  quoteNumber: "Q-2026-0631",
  quoteTotal: "$3,655.67",
  quoteUrl: "https://www.cjmmetals.com/quote/…",
  unsubscribeUrl: "https://…/q/optout?token=…",
  invoiceNumber: "INV-2026-0042",
  invoiceTotal: "$3,655.67",
  balance: "$1,200.00",
  dueDate: "2026-09-08",
  amount: "$2,455.67",
  reviewUrl: "https://www.cjmmetals.com/review/…",
  status: "approved",
  leaveType: "vacation",
  dates: "2026-09-01–2026-09-05",
  jobNumber: "J-2026-0117",
  projectName: "Bar table — 2 off",
};

// {{signoff}} is injected at SEND time from the shop settings (renderTemplate);
// the preview has to supply it too or every default template previews with a
// blank line where the shop's name belongs.
const previewVars = (): Record<string, string> => ({ ...SAMPLE, signoff: shopSignoff() });

export function registerEmailTemplateRoutes(app: Express): void {
  // ─── List ─────────────────────────────────────────────────────────────────
  app.get("/api/email-templates", requireAuth, (_req, res) => {
    const rows = sqlite.prepare("SELECT * FROM email_templates").all() as Row[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Every built-in body ends with {{signoff}} (the shop's name + city, from
    // the Price Book settings) — document it so the owner sees a chip for it
    // instead of an unexplained token in the text they're editing.
    const SIGNOFF_VAR = {
      token: "signoff",
      meaning: "Your shop name and city, from the Price Book settings",
    };

    const builtIns = BUILT_INS.map((t) => {
      const row = byId.get(t.id);
      return {
        ...t,
        vars: [...t.vars, SIGNOFF_VAR],
        custom: false,
        enabled: row ? row.enabled === 1 : true,
        subject: row?.subject ?? t.subject,
        body: row?.body ?? t.body,
        edited: !!(row && (row.subject != null || row.body != null)),
        defaultSubject: t.subject,
        defaultBody: t.body,
      };
    });

    const custom = rows.filter((r) => r.custom === 1).map((r) => ({
      id: r.id,
      name: r.name ?? "Untitled",
      audience: "customer" as const,
      custom: true,
      enabled: r.enabled === 1,
      anchor: r.anchor,
      delayDays: r.delay_days ?? 0,
      trigger: `${r.delay_days ?? 0} day${(r.delay_days ?? 0) === 1 ? "" : "s"} `
        + `${anchorFor(r.anchor ?? "")?.label ?? r.anchor}`,
      subject: r.subject ?? "",
      body: r.body ?? "",
      vars: anchorFor(r.anchor ?? "")?.vars ?? [],
      canDisable: true,
      edited: true,
    }));

    res.json({
      templates: [...builtIns, ...custom],
      anchors: ANCHORS.map((a) => ({ key: a.key, label: a.label, vars: a.vars })),
      lockedNote: LOCKED_NOTE,
    });
  });

  // ─── Sent history ─────────────────────────────────────────────────────────
  // Every send attempt, newest first. The mailer already writes one audit row
  // per attempt — this reads them back rather than keeping a second ledger
  // that could disagree with the first. Failures are included on purpose: the
  // interesting question is usually "did that actually go?".
  app.get("/api/email-templates/history", requireAuth, (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const template = typeof req.query.template === "string" ? req.query.template : "";
    const rows = sqlite.prepare(`
      SELECT id, action, target_name, details, created_at
      FROM audit_log
      WHERE action IN ('email.sent', 'email.failed')
        ${template ? "AND details LIKE @like" : ""}
      ORDER BY id DESC
      LIMIT @limit
    `).all({ limit, like: `%"template":"${template}"%` }) as {
      id: number; action: string; target_name: string | null;
      details: string | null; created_at: number;
    }[];

    const nameOf = new Map<string, string>(BUILT_INS.map((t) => [t.id, t.name]));
    for (const r of sqlite.prepare("SELECT id, name FROM email_templates WHERE custom = 1").all() as any[]) {
      nameOf.set(r.id, r.name ?? r.id);
    }

    res.json({
      sends: rows.map((r) => {
        let d: any = {};
        try { d = r.details ? JSON.parse(r.details) : {}; } catch { /* row predates the field */ }
        return {
          id: r.id,
          to: r.target_name,
          subject: d.subject ?? "",
          template: d.template ?? null,
          // An email sent before this section existed, or one of the owner
          // alerts, has no template — say so rather than showing a blank.
          templateName: d.template ? (nameOf.get(d.template) ?? d.template) : null,
          via: d.via ?? null,
          archivedTo: d.archivedTo ?? null,
          error: d.error ?? null,
          ok: r.action === "email.sent",
          at: r.created_at,
        };
      }),
    });
  });

  // ─── Preview ──────────────────────────────────────────────────────────────
  // Renders whatever is in the editor right now against sample values, so the
  // owner sees the email a customer would get before saving it.
  app.post("/api/email-templates/preview", requireAuth, (req, res) => {
    const subject = String(req.body?.subject ?? "").slice(0, 300);
    const body = String(req.body?.body ?? "").slice(0, 20_000);
    const vars = previewVars();
    res.json({
      subject: render(subject, vars),
      text: render(body, vars),
    });
  });

  // ─── Edit a built-in (or a custom's wording) ──────────────────────────────
  app.put("/api/email-templates/:id", requireElevated, (req, res) => {
    try {
      const id = String(req.params.id);
      const data = templateEdit.parse(req.body);
      const builtIn = BUILT_INS.find((t) => t.id === id);
      const existing = rowFor(id);
      if (!builtIn && !existing) return res.status(404).json({ message: "No such email" });
      if (builtIn?.locked) return res.status(400).json({ message: builtIn.locked });
      if (data.enabled === false && builtIn && !builtIn.canDisable) {
        return res.status(400).json({ message: `"${builtIn.name}" can't be switched off.` });
      }

      sqlite.prepare(`
        INSERT INTO email_templates (id, subject, body, enabled, custom, updated_at)
        VALUES (@id, @subject, @body, @enabled, 0, @now)
        ON CONFLICT(id) DO UPDATE SET
          subject = COALESCE(@subject, email_templates.subject),
          body = COALESCE(@body, email_templates.body),
          enabled = COALESCE(@enabled, email_templates.enabled),
          updated_at = @now
      `).run({
        id,
        subject: data.subject ?? null,
        body: data.body ?? null,
        enabled: data.enabled == null ? null : data.enabled ? 1 : 0,
        now: Date.now(),
      });
      audit(req, "email.template_update", { targetType: "email_template", targetName: id });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ─── Reset a built-in / delete a custom ───────────────────────────────────
  app.delete("/api/email-templates/:id", requireElevated, (req, res) => {
    const id = String(req.params.id);
    const row = rowFor(id);
    if (!row) return res.json({ ok: true }); // already at its default
    if (row.custom === 1) {
      sqlite.prepare("DELETE FROM email_templates WHERE id = ?").run(id);
      // Its send history goes too — a re-created template with the same id
      // would otherwise inherit "already sent" for everyone.
      sqlite.prepare("DELETE FROM email_custom_sends WHERE template_id = ?").run(id);
      audit(req, "email.template_delete", { targetType: "email_template", targetName: id });
    } else {
      sqlite.prepare("UPDATE email_templates SET subject = NULL, body = NULL, updated_at = ? WHERE id = ?")
        .run(Date.now(), id);
      audit(req, "email.template_reset", { targetType: "email_template", targetName: id });
    }
    res.json({ ok: true });
  });

  // ─── Create a new event-timed email ───────────────────────────────────────
  app.post("/api/email-templates", requireElevated, (req, res) => {
    try {
      const data = customCreate.parse(req.body);
      if (!anchorFor(data.anchor)) {
        return res.status(400).json({ message: `Unknown event "${data.anchor}"` });
      }
      const base = "custom." + (data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "email");
      let id = base;
      for (let i = 2; rowFor(id); i++) id = `${base}-${i}`;

      sqlite.prepare(`
        INSERT INTO email_templates (id, subject, body, enabled, custom, name, anchor, delay_days, updated_at)
        VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?)
      `).run(id, data.subject, data.body, data.name, data.anchor, data.delayDays, Date.now());

      // Everything already past the delay when the email is created would
      // otherwise all go out on the next sweep — a customer from two years ago
      // getting a "30 days after your job" note. Mark the backlog as done.
      const anchor = anchorFor(data.anchor)!;
      let suppressed = 0;
      try {
        for (const row of anchor.due(data.delayDays)) {
          sqlite.prepare(
            "INSERT OR IGNORE INTO email_custom_sends (template_id, entity_id, sent_at) VALUES (?, ?, ?)",
          ).run(id, row.entityId, Date.now());
          suppressed++;
        }
      } catch { /* an anchor that can't be read now simply has no backlog */ }

      audit(req, "email.template_create", {
        targetType: "email_template", targetName: id,
        details: { anchor: data.anchor, delayDays: data.delayDays, backlogSuppressed: suppressed },
      });
      res.json({ ok: true, id, backlogSuppressed: suppressed });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
}
