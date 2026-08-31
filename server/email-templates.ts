import { sqlite } from "./storage";
import { isOptedOut, mailEnabled, sendMail } from "./mailer";

// ─── Editable email templates ────────────────────────────────────────────────
// Every automated email the shop sends to someone OUTSIDE the business, with
// its wording owned by the shop rather than by this file.
//
//   · Built-ins ship with the wording that was previously hardcoded at the send
//     site. An owner edit is stored as an override; deleting the override
//     restores the original. Each can be switched off.
//   · Custom templates are created by the owner: pick an event the suite
//     already timestamps, a delay in days, and write the wording. The hourly
//     sweep (automations.ts) sends them.
//
// ⚠ Owner-editable text goes to CUSTOMERS. Two guardrails: a template that
// carries an unsubscribe link always sends with it, appended if the owner
// deleted the token; and templates whose body is built from figures rather
// than prose (the invoice itself) are listed but locked.
//
// The internal "[CJM Suite]" alerts to the owner are deliberately NOT here —
// they are diagnostics, not correspondence, and several are generated tables.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    subject TEXT,
    body TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    -- Owner-created templates only:
    custom INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    anchor TEXT,
    delay_days INTEGER,
    updated_at INTEGER
  )
`);

// One row per (custom template, entity) so a scheduled email is sent once and
// once only, however many times the sweep runs.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS email_custom_sends (
    template_id TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (template_id, entity_id)
  )
`);

export interface TemplateVar {
  token: string;
  meaning: string;
  /** Empty value ⇒ the whole line it sits on is dropped. */
  optional?: boolean;
}

export interface BuiltIn {
  id: string;
  name: string;
  audience: "customer" | "employee";
  /** Plain English: when this goes out. Shown in the UI. */
  trigger: string;
  subject: string;
  body: string;
  vars: TemplateVar[];
  /** False for mail the business can't function without sending. */
  canDisable: boolean;
  /** Set when the body is generated from figures — listed, not editable. */
  locked?: string;
  /** Token whose value is re-appended if the owner deletes it. */
  mustInclude?: string;
}

// Shop identity lives in quote_settings.shop (owner-edited in the Price Book
// screen) — one place to change the name/city everywhere mail is signed. The
// literal is only the pre-settings fallback.
function shopRow(): { name: string; location: string } {
  try {
    const row = sqlite.prepare("SELECT shop FROM quote_settings WHERE id = 1").get() as
      | { shop?: string }
      | undefined;
    const shop = row?.shop ? JSON.parse(row.shop) : null;
    return {
      name: typeof shop?.name === "string" ? shop.name.trim() : "",
      location: typeof shop?.location === "string" ? shop.location.trim() : "",
    };
  } catch {
    /* quote_settings not created yet */
    return { name: "", location: "" };
  }
}

// The shop's name on its own, for the templates that used to spell "CJM Metals"
// into their subject line. The suite quotes concrete and insulation too now, so
// a customer who asked cjm-concrete.com for a driveway was reading "Your quote
// from CJM Metals" on the one document where he decides whether to spend money.
//
// Both fall back to the historical literal, unchanged — the pre-settings
// default is not the place to make a branding decision. The fix the owner
// actually wants is one settings edit: set the shop name in the Price Book
// screen to the parent brand ("CJM Trades") and every subject, sign-off and
// invoice header follows it, on all four trades, with no deploy.
// ponytail: one name for the whole family. Real per-trade branding needs the
// sister sites to host their own /quote and /invoice pages first — until they
// do, a per-site name would only put the wrong label on a metals link.
export function shopBrand(): string {
  return shopRow().name || "CJM Metals";
}

export function shopSignoff(): string {
  const { name, location } = shopRow();
  if (name) return `— ${name}${location ? ` · ${location}` : ""}`;
  return "— CJM Metals · Arlington, TX";
}

// Rendered lazily per send via the auto-injected {{signoff}} / {{brand}} vars,
// so a shop rename reaches every default template without touching this file.
const SIGNOFF = "{{signoff}}";

export const BUILT_INS: BuiltIn[] = [
  {
    id: "quote.share",
    name: "Quote sent to the customer",
    audience: "customer",
    trigger: "When you share a quote with “email the customer” ticked.",
    subject: "Your quote from {{brand}} — {{quoteNumber}}",
    body:
      // Full name, as this email has always greeted people. {{firstName}} is
      // there in the token list if the shop prefers it.
      `Hi {{customerName}},\n\n` +
      `Your quote {{quoteNumber}} from {{brand}} is ready. View it (and accept it online) here:\n\n` +
      `{{quoteUrl}}\n\n` +
      `Questions? Just reply to this email or give us a call.\n\n` +
      SIGNOFF,
    vars: [
      { token: "firstName", meaning: "Customer's first name (“there” if unknown)" },
      { token: "customerName", meaning: "Customer's full name" },
      { token: "quoteNumber", meaning: "e.g. Q-2026-0631" },
      { token: "quoteUrl", meaning: "Link to their online quote" },
    ],
    canDisable: false,
  },
  {
    // Sent by the intake endpoint for the concrete, insulation and trades
    // sites. Those three deliver all their customer mail through a Google Apps
    // Script webhook that has never been configured, so until now a customer
    // who filled in their form got a thank-you page and then nothing at all —
    // no reference, nothing to reply to, no proof they had made contact. The
    // metals site's own script already sends this, which is why the intake
    // skips metals rather than emailing those customers twice.
    id: "lead.received",
    name: "Enquiry received — confirmation",
    audience: "customer",
    trigger:
      "When someone submits the quote form on the concrete, insulation or trades site.",
    subject: "We got your request — {{brand}}",
    body:
      `Hi {{firstName}},\n\n` +
      `Thanks for getting in touch — we have your request and we'll come back to ` +
      `you within one business day.\n` +
      `{{refLine}}\n` +
      `What you asked about:\n{{service}}\n\n` +
      `If anything changes, or you want to send photos, just reply to this email.\n\n` +
      SIGNOFF,
    vars: [
      { token: "firstName", meaning: "Customer's first name (“there” if unknown)" },
      { token: "service", meaning: "What they asked for" },
      { token: "refLine", meaning: "Their project code, when the form carried one", optional: true },
    ],
    canDisable: true,
  },
  {
    id: "quote.accepted",
    name: "Quote accepted — confirmation",
    audience: "customer",
    trigger: "The moment a customer accepts their quote online.",
    subject: "Quote {{quoteNumber}} accepted — {{brand}}",
    body:
      `Hi {{customerName}},\n\n` +
      `Got it — your quote {{quoteNumber}} is locked in. We'll call you to go over ` +
      `the contract and get it out to you, so we can get started on the work.\n\n` +
      SIGNOFF,
    vars: [
      { token: "customerName", meaning: "Customer's name (“there” if unknown)" },
      { token: "firstName", meaning: "Customer's first name" },
      { token: "quoteNumber", meaning: "e.g. Q-2026-0631" },
    ],
    canDisable: false,
  },
  {
    id: "quote.followup1",
    name: "Quote follow-up — any questions?",
    audience: "customer",
    trigger: "2 days after a quote is sent, if they haven't accepted.",
    subject: "Any questions about your quote? — {{quoteNumber}}",
    body:
      `Hi {{firstName}},\n\n` +
      `Just checking in — any questions about your quote {{quoteNumber}} ({{quoteTotal}})? ` +
      `You can view it, and accept it online, here:\n\n` +
      `{{quoteUrl}}\n\n` +
      `Happy to walk through any part of it — just reply to this email or give us a call.\n\n` +
      SIGNOFF + `\n\nNo more emails about this quote: {{unsubscribeUrl}}`,
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "quoteNumber", meaning: "e.g. Q-2026-0631" },
      { token: "quoteTotal", meaning: "Quote total, e.g. $3,655.67" },
      { token: "quoteUrl", meaning: "Link to their online quote" },
      { token: "unsubscribeUrl", meaning: "Stops further emails about this quote" },
    ],
    canDisable: true,
    mustInclude: "unsubscribeUrl",
  },
  {
    id: "quote.followup2",
    name: "Quote follow-up — last note",
    audience: "customer",
    trigger: "7 days after a quote is sent, if they still haven't accepted.",
    subject: "Last note on quote {{quoteNumber}} — {{brand}}",
    body:
      `Hi {{firstName}},\n\n` +
      `Last note from us — happy to adjust the design or the price if the quote ` +
      `isn't quite right. It's still open here:\n\n` +
      `{{quoteUrl}}\n\n` +
      SIGNOFF + `\n\nNo more emails about this quote: {{unsubscribeUrl}}`,
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "quoteNumber", meaning: "e.g. Q-2026-0631" },
      { token: "quoteUrl", meaning: "Link to their online quote" },
      { token: "unsubscribeUrl", meaning: "Stops further emails about this quote" },
    ],
    canDisable: true,
    mustInclude: "unsubscribeUrl",
  },
  {
    id: "invoice.overdue",
    name: "Overdue invoice reminder",
    audience: "customer",
    trigger: "Once an invoice is past its due date, then every 7 days until paid.",
    subject: "Friendly reminder — invoice {{invoiceNumber}} — {{brand}}",
    body:
      `Hi {{firstName}},\n\n` +
      `Just a friendly reminder that invoice {{invoiceNumber}} has an outstanding ` +
      `balance of {{balance}} (it was due {{dueDate}}). If you've already sent ` +
      `payment, please disregard this note.\n\n` +
      `Questions? Just reply to this email or give us a call.\n\n` +
      SIGNOFF,
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "invoiceNumber", meaning: "e.g. INV-2026-0042" },
      { token: "balance", meaning: "Amount still outstanding" },
      { token: "dueDate", meaning: "The invoice's due date" },
    ],
    canDisable: true,
  },
  {
    id: "review.request",
    name: "Review request",
    audience: "customer",
    trigger: "When an invoice is paid in full. Once per invoice, ever.",
    subject: "How did we do? — {{brand}}",
    body:
      `Hi {{firstName}},\n\n` +
      `Thanks for choosing {{brand}} for your project. If you have a minute, ` +
      `we'd really appreciate a quick review — it takes about 30 seconds:\n\n` +
      `{{reviewUrl}}\n\n` +
      `Thank you!\n\n` +
      SIGNOFF,
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "reviewUrl", meaning: "Their personal review link" },
    ],
    canDisable: true,
  },
  {
    id: "payment.receipt.partial",
    name: "Payment receipt — balance remaining",
    audience: "customer",
    trigger: "Every time you record a payment that doesn't clear the invoice.",
    subject: "Received {{amount}} on {{invoiceNumber}} — {{brand}}",
    body:
      `Hi {{firstName}},\n\n` +
      `We received your payment of {{amount}} on invoice {{invoiceNumber}}. ` +
      `Remaining balance: {{balance}}.\n\n` +
      SIGNOFF,
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "amount", meaning: "The payment you recorded" },
      { token: "invoiceNumber", meaning: "e.g. INV-2026-0042" },
      { token: "balance", meaning: "What's still owed" },
    ],
    canDisable: true,
  },
  {
    id: "payment.receipt.final",
    name: "Payment receipt — paid in full",
    audience: "customer",
    trigger: "When a recorded payment clears the invoice.",
    subject: "Received {{amount}} on {{invoiceNumber}} — {{brand}}",
    body:
      `Hi {{firstName}},\n\n` +
      `We received your payment of {{amount}} on invoice {{invoiceNumber}}. ` +
      `Your invoice is paid in full — thank you!\n\n` +
      SIGNOFF,
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "amount", meaning: "The payment you recorded" },
      { token: "invoiceNumber", meaning: "e.g. INV-2026-0042" },
    ],
    canDisable: true,
  },
];

/** Listed in the UI so the owner can see it exists, but not editable. */
export const LOCKED_NOTE = "Built from the invoice's own figures — line items, "
  + "totals, retainage and deposit — so its wording can't be edited without "
  + "breaking the arithmetic.";

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * Replace {{tokens}}. A line carrying an OPTIONAL token that resolved to
 * nothing is dropped whole — that's how a quote's "due {{dueDate}}" sentence
 * disappears when there's no due date, without the owner writing any
 * conditional syntax.
 */
export function render(text: string, vars: Record<string, string>, optional: Set<string> = new Set()): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    let drop = false;
    const out = line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, token: string) => {
      const value = vars[token] ?? "";
      if (!value && optional.has(token)) drop = true;
      return value;
    });
    if (!drop) kept.push(out);
  }
  return kept.join("\n");
}

interface StoredRow {
  id: string; subject: string | null; body: string | null; enabled: number;
  custom: number; name: string | null; anchor: string | null; delay_days: number | null;
}

const storedRow = (id: string): StoredRow | undefined =>
  sqlite.prepare("SELECT * FROM email_templates WHERE id = ?").get(id) as StoredRow | undefined;

/** Is this email switched on? Unknown ids default to on. */
export function isEnabled(id: string): boolean {
  const row = storedRow(id);
  return row ? row.enabled === 1 : true;
}

/**
 * The subject + body to send for `id`, with the owner's edits applied and
 * variables filled. Returns null when the owner has switched it off — callers
 * treat that as "don't send".
 */
export function renderTemplate(
  id: string,
  vars: Record<string, string>,
): { subject: string; text: string; template: string } | null {
  const def = BUILT_INS.find((t) => t.id === id);
  const row = storedRow(id);
  if (row && row.enabled !== 1) return null;
  const subjectSrc = row?.subject ?? def?.subject ?? "";
  let bodySrc = row?.body ?? def?.body ?? "";

  // An unsubscribe link the owner deleted goes back on. It is not theirs to
  // remove — it's what keeps the follow-up ladder honest.
  if (def?.mustInclude && !bodySrc.includes(`{{${def.mustInclude}}}`)) {
    bodySrc += `\n\nNo more emails about this: {{${def.mustInclude}}}`;
  }

  const optional = new Set((def?.vars ?? []).filter((v) => v.optional).map((v) => v.token));
  // {{signoff}} and {{brand}} are auto-supplied (callers never pass them) — an
  // explicit var of the same name would win, which is fine.
  const allVars = { signoff: shopSignoff(), brand: shopBrand(), ...vars };
  return {
    subject: render(subjectSrc, allVars, optional).trim(),
    text: render(bodySrc, allVars, optional),
    // Rides along into sendMail so the sent history knows which email this was.
    template: id,
  };
}

// ─── Owner-created, event-timed emails ───────────────────────────────────────
// Each anchor is an event the suite already stamps a time on, plus how to find
// everyone due and who to write to. Adding an anchor here is what it takes to
// offer a new "send N days after ..." option.

export interface Anchor {
  key: string;
  label: string;
  /** Rows whose anchor event was at least `days` ago. */
  due(days: number): { entityId: number; email: string; vars: Record<string, string> }[];
  vars: TemplateVar[];
}

// Exported: every module that greets a customer by first name uses this one.
export const firstNameOf = (full: string | null | undefined): string =>
  String(full ?? "").trim().split(/\s+/)[0] || "there";

const usd = (cents: number): string =>
  `$${((cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Customer email on a quote: the builder's customer card, else its design row. */
function quoteEmail(payload: string | null, designRef: string | null): string {
  try {
    const p = payload ? JSON.parse(payload) : null;
    const e = p?.customer?.email;
    if (typeof e === "string" && e.includes("@")) return e;
  } catch { /* malformed payload — fall through to the design */ }
  if (designRef) {
    const d = sqlite.prepare("SELECT email FROM web_designs WHERE upper(ref) = ?")
      .get(designRef.toUpperCase()) as { email?: string } | undefined;
    if (d?.email) return d.email;
  }
  return "";
}

const DAY_MS = 24 * 60 * 60 * 1000;

const QUOTE_VARS: TemplateVar[] = [
  { token: "firstName", meaning: "Customer's first name" },
  { token: "customerName", meaning: "Customer's full name" },
  { token: "quoteNumber", meaning: "e.g. Q-2026-0631" },
  { token: "quoteTotal", meaning: "Quote total" },
];

export const ANCHORS: Anchor[] = [
  {
    key: "quote.sent",
    label: "after a quote is sent",
    vars: QUOTE_VARS,
    due: (days) => (sqlite.prepare(`
      SELECT id, number, customer_name, total_cents, payload, design_ref
      FROM quotes
      WHERE deleted_at IS NULL AND sent_at IS NOT NULL AND sent_at <= ?
    `).all(Date.now() - days * DAY_MS) as any[]).map((q) => ({
      entityId: q.id,
      email: quoteEmail(q.payload, q.design_ref),
      vars: {
        firstName: firstNameOf(q.customer_name),
        customerName: String(q.customer_name ?? "there"),
        quoteNumber: String(q.number),
        quoteTotal: usd(q.total_cents),
      },
    })),
  },
  {
    key: "quote.accepted",
    label: "after a quote is accepted",
    vars: QUOTE_VARS,
    due: (days) => (sqlite.prepare(`
      SELECT id, number, customer_name, total_cents, payload, design_ref
      FROM quotes
      WHERE deleted_at IS NULL AND accepted_at IS NOT NULL AND accepted_at <= ?
    `).all(Date.now() - days * DAY_MS) as any[]).map((q) => ({
      entityId: q.id,
      email: quoteEmail(q.payload, q.design_ref),
      vars: {
        firstName: firstNameOf(q.customer_name),
        customerName: String(q.customer_name ?? "there"),
        quoteNumber: String(q.number),
        quoteTotal: usd(q.total_cents),
      },
    })),
  },
  {
    key: "project.completed",
    label: "after a job is marked finished",
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "customerName", meaning: "Customer's full name" },
      { token: "jobNumber", meaning: "The job number" },
      { token: "projectName", meaning: "What the job is called" },
    ],
    due: (days) => (sqlite.prepare(`
      SELECT p.id, p.job_number, p.name, p.customer, c.name AS client_name, c.email
      FROM projects p LEFT JOIN crm_clients c ON c.id = p.client_id
      WHERE p.deleted_at IS NULL AND p.completed_at IS NOT NULL AND p.completed_at <= ?
    `).all(Date.now() - days * DAY_MS) as any[]).map((p) => ({
      entityId: p.id,
      email: String(p.email ?? ""),
      vars: {
        firstName: firstNameOf(p.client_name ?? p.customer),
        customerName: String(p.client_name ?? p.customer ?? "there"),
        jobNumber: String(p.job_number ?? ""),
        projectName: String(p.name ?? ""),
      },
    })),
  },
  {
    key: "invoice.paid",
    label: "after an invoice is paid in full",
    vars: [
      { token: "firstName", meaning: "Customer's first name" },
      { token: "customerName", meaning: "Customer's full name" },
      { token: "invoiceNumber", meaning: "e.g. INV-2026-0042" },
      { token: "invoiceTotal", meaning: "Invoice total" },
    ],
    // Paid = nothing left owing once retainage is set aside. The clock starts
    // at the payment that cleared it, not at the invoice date.
    due: (days) => (sqlite.prepare(`
      SELECT i.id, i.number, i.client_name, i.total_cents, c.email,
             (SELECT MAX(p.paid_at) FROM fin_invoice_payments p WHERE p.invoice_id = i.id) AS paid_at
      FROM fin_invoices i LEFT JOIN crm_clients c ON c.id = i.client_id
      WHERE i.deleted_at IS NULL AND i.status != 'void'
        AND i.total_cents - COALESCE(i.retainage_cents, 0) - i.paid_cents <= 0
    `).all() as any[])
      .filter((i) => i.paid_at != null && i.paid_at <= Date.now() - days * DAY_MS)
      .map((i) => ({
        entityId: i.id,
        email: String(i.email ?? ""),
        vars: {
          firstName: firstNameOf(i.client_name),
          customerName: String(i.client_name ?? "there"),
          invoiceNumber: String(i.number),
          invoiceTotal: usd(i.total_cents),
        },
      })),
  },
];

export const anchorFor = (key: string): Anchor | undefined =>
  ANCHORS.find((a) => a.key === key);

/**
 * Send every owner-created email that has come due. Driven by the same hourly
 * tick as the quote ladder. Idempotent: one row per (template, entity) in
 * email_custom_sends means a recipient is written to once, whatever happens.
 */
export async function runCustomEmailSweep(): Promise<number> {
  if (!mailEnabled()) return 0;
  const rows = sqlite.prepare(
    "SELECT * FROM email_templates WHERE custom = 1 AND enabled = 1",
  ).all() as StoredRow[];
  let sent = 0;
  for (const tpl of rows) {
    const anchor = anchorFor(tpl.anchor ?? "");
    if (!anchor) continue;
    const days = Math.max(0, Number(tpl.delay_days) || 0);
    let due: ReturnType<Anchor["due"]>;
    try {
      due = anchor.due(days);
    } catch (e) {
      console.error(`[email-templates] anchor ${tpl.anchor} failed:`, e);
      continue;
    }
    for (const row of due) {
      if (!row.email || isOptedOut(row.email)) continue;
      const already = sqlite.prepare(
        "SELECT 1 FROM email_custom_sends WHERE template_id = ? AND entity_id = ?",
      ).get(tpl.id, row.entityId);
      if (already) continue;
      // Claim it BEFORE sending: a crash mid-send costs one email, whereas
      // claiming after would re-send this every hour forever.
      sqlite.prepare(
        "INSERT OR IGNORE INTO email_custom_sends (template_id, entity_id, sent_at) VALUES (?, ?, ?)",
      ).run(tpl.id, row.entityId, Date.now());
      const subject = render(tpl.subject ?? "", row.vars);
      const text = render(tpl.body ?? "", row.vars);
      if (!subject.trim() || !text.trim()) continue;
      await sendMail({ to: row.email, subject, text, template: tpl.id });
      sent++;
    }
  }
  return sent;
}
