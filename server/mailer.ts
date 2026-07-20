import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

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

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** File attachments (Phase E: the weekly backup email). Buffer content only. */
  attachments?: { filename: string; content: Buffer }[];
}

function mailFrom(): string | null {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (process.env.SMTP_USER) return `CJM Metals Suite <${process.env.SMTP_USER}>`;
  return null;
}

function ownerAddress(): string | null {
  return process.env.OWNER_EMAIL || process.env.TO_EMAIL || process.env.SMTP_USER || null;
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

async function sendViaResend(msg: MailMessage): Promise<boolean> {
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

async function sendViaSmtp(msg: MailMessage): Promise<boolean> {
  await getTransporter().sendMail({
    from: mailFrom() ?? undefined,
    to: msg.to,
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
export async function sendMail(msg: MailMessage): Promise<boolean> {
  try {
    if (resendConfigured()) return await sendViaResend(msg);
    if (smtpConfigured()) return await sendViaSmtp(msg);
    console.warn(`[mailer] no transport configured — "${msg.subject}" to ${msg.to} not sent`);
    return false;
  } catch (err) {
    console.error("[mailer] send FAILED:", err instanceof Error ? err.message : err);
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
  return sendMail({ ...msg, to });
}
