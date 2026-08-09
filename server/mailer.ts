import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { sqlite, storage } from "./storage";

// ─── Outbound mail ───────────────────────────────────────────────────────────
// One tiny facade the whole suite sends through. Two transports, tried in
// priority order:
//   1. Resend HTTP API (RESEND_API_KEY) — works on hosts that block outbound
//      SMTP entirely (Railway's Hobby plan blocks 465 AND 587; verified
//      2026-07-02 on the website's server).
//   2. Gmail SMTP via nodemailer (SMTP_USER + SMTP_PASS) — same transporter
//      shape and short timeouts as the website's src/pages/api/quote.ts, so a
//      blocked/stalled connection fails in seconds instead of hanging.
// Unconfigured is a supported state: mailEnabled() is false and every send is
// a logged no-op — callers never need their own "is email set up" checks.
//
// Env:
//   RESEND_API_KEY — enables the Resend transport
//   SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT — enables the SMTP transport
//   MAIL_FROM   — sender ("CJM Metals Suite <owner@…>"); required for Resend,
//                 defaults to the SMTP user for SMTP
//   OWNER_EMAIL — where sendOwnerMail delivers (falls back to TO_EMAIL, the
//                 website's owner-notification address, then SMTP_USER)
//   MAIL_ARCHIVE — blind copy of every outbound email, so the shop has its own
//                 record of what went out under its name. Defaults to the owner
//                 address; set MAIL_ARCHIVE=off to disable.
//
// ⚠ Mail sent over the Resend API never passes through Gmail, so it CANNOT
// appear in Gmail's Sent folder — the archive copy below is what makes a send
// visible in the mailbox, and every send is also written to the audit log.

// ─── Email opt-outs (Phase F) ────────────────────────────────────────────────
// Per-ADDRESS unsubscribe list for automated customer emails (quote follow-up
// ladder, overdue-invoice chaser, review requests). Owner-initiated sends
// (invoice email, share link, receipts) deliberately ignore it — the customer
// opted out of the robot, not the business. Rows come from the public
// /q/optout endpoint (public-portal.ts). Lives here because every automated
// sender already imports this module.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS email_optouts (
    email TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`);

const normalizeEmail = (e: string): string => e.trim().toLowerCase();

/** Has this address unsubscribed from automated emails? Never throws. */
export function isOptedOut(email: string | null | undefined): boolean {
  if (!email || !email.trim()) return false;
  try {
    return !!sqlite.prepare("SELECT 1 FROM email_optouts WHERE email = ?")
      .get(normalizeEmail(email));
  } catch {
    return false;
  }
}

/** Record an unsubscribe. Returns true when a new row was written. */
export function optOutEmail(email: string): boolean {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  return sqlite.prepare(
    "INSERT OR IGNORE INTO email_optouts (email, created_at) VALUES (?, ?)",
  ).run(norm, Date.now()).changes > 0;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** File attachments (Phase E: the weekly backup email). Buffer content only. */
  attachments?: { filename: string; content: Buffer }[];
  /**
   * Which template this came from. renderTemplate() puts it here, so a caller
   * spreading `...msg` carries it without knowing about it — that's what makes
   * the sent history able to say WHICH email each row was.
   */
  template?: string;
}

function mailFrom(): string | null {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (process.env.SMTP_USER) return `CJM Metals Suite <${process.env.SMTP_USER}>`;
  return null;
}

function ownerAddress(): string | null {
  return process.env.OWNER_EMAIL || process.env.TO_EMAIL || process.env.SMTP_USER || null;
}

/**
 * Who gets a blind copy of every outbound email. The suite sends over an HTTP
 * API, so the shop's mailbox has no other record that a customer was written
 * to — this copy IS the sent-mail folder. Defaults to the owner; MAIL_ARCHIVE
 * redirects it, MAIL_ARCHIVE=off turns it off.
 */
function archiveAddress(): string | null {
  const set = (process.env.MAIL_ARCHIVE || "").trim();
  if (set.toLowerCase() === "off") return null;
  return set || ownerAddress();
}

/** Archive copy for this message — skipped when it's already the recipient. */
function archiveFor(to: string): string | null {
  const archive = archiveAddress();
  if (!archive) return null;
  // sendOwnerMail already delivers to the owner; a blind copy of that is just
  // the same email twice.
  return normalizeEmail(archive) === normalizeEmail(to) ? null : archive;
}

/**
 * Durable record of every send attempt, success or failure, in the suite's own
 * audit log — the one place that answers "what has this system emailed out?"
 * even for messages that never left (no transport, provider rejection).
 * Best-effort: a logging failure must never sink the email.
 */
function recordSend(
  msg: MailMessage,
  outcome: { ok: boolean; via: string; bcc: string | null; error?: string },
): void {
  try {
    storage.appendAudit({
      userName: "mailer",
      action: outcome.ok ? "email.sent" : "email.failed",
      targetType: "email",
      targetName: msg.to,
      details: {
        subject: msg.subject,
        via: outcome.via,
        ...(msg.template ? { template: msg.template } : {}),
        ...(outcome.bcc ? { archivedTo: outcome.bcc } : {}),
        ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => a.filename) } : {}),
        ...(outcome.error ? { error: outcome.error.slice(0, 300) } : {}),
      },
    });
  } catch {
    /* the audit row is a nicety; the email is the job */
  }
}

const resendConfigured = (): boolean => !!(process.env.RESEND_API_KEY && mailFrom());
const smtpConfigured = (): boolean => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/** Is any transport configured? Callers use this to skip email-only steps. */
export function mailEnabled(): boolean {
  return resendConfigured() || smtpConfigured();
}

// Lazy singleton — building a transporter is cheap but not free, and most
// requests never send mail. Rebuilt never: env doesn't change mid-process.
let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS (set SMTP_PORT=587 if 465 is blocked)
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

async function sendViaResend(msg: MailMessage, bcc: string | null): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(bcc ? { bcc } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.attachments
        ? {
            attachments: msg.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString("base64"),
            })),
          }
        : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return true;
}

async function sendViaSmtp(msg: MailMessage, bcc: string | null): Promise<boolean> {
  await getTransporter().sendMail({
    from: mailFrom() ?? undefined,
    to: msg.to,
    ...(bcc ? { bcc } : {}),
    subject: msg.subject,
    text: msg.text,
    replyTo: msg.replyTo,
    attachments: msg.attachments,
  });
  return true;
}

/**
 * Send one plain-text email. Logs failures and resolves false — NEVER throws,
 * so callers can fire-and-forget from anywhere (including setImmediate hooks
 * on financially critical paths) without their own try/catch.
 */
export async function sendMail(
  msg: MailMessage,
  opts?: { archive?: boolean },
): Promise<boolean> {
  const bcc = opts?.archive === false ? null : archiveFor(msg.to);
  const via = resendConfigured() ? "resend" : smtpConfigured() ? "smtp" : "none";
  try {
    if (via === "resend") {
      await sendViaResend(msg, bcc);
    } else if (via === "smtp") {
      await sendViaSmtp(msg, bcc);
    } else {
      console.warn(`[mailer] no transport configured — "${msg.subject}" to ${msg.to} not sent`);
      recordSend(msg, { ok: false, via, bcc: null, error: "no transport configured" });
      return false;
    }
    recordSend(msg, { ok: true, via, bcc });
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[mailer] send FAILED:", error);
    recordSend(msg, { ok: false, via, bcc, error });
    return false;
  }
}

/** Notify the owner (OWNER_EMAIL → TO_EMAIL → SMTP_USER). Same never-throws contract. */
export async function sendOwnerMail(msg: Omit<MailMessage, "to">): Promise<boolean> {
  const to = ownerAddress();
  if (!to) {
    console.warn(`[mailer] no owner address configured — "${msg.subject}" not sent`);
    return false;
  }
  // Never archived: the owner is already the recipient, and one of these
  // carries the weekly database snapshot — a redirected MAIL_ARCHIVE must not
  // become a second copy of the whole business.
  return sendMail({ ...msg, to }, { archive: false });
}
