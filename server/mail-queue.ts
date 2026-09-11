import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sqlite, dataDir } from "./storage";
import { enqueueFollowup } from "./outbox";
import type { MailMessage } from "./mailer";

sqlite.exec(
  `CREATE TABLE IF NOT EXISTS suite_mail(key TEXT PRIMARY KEY,payload TEXT NOT NULL,first_attempt_at INTEGER,accepted_at INTEGER,provider_id TEXT);`,
);
export function storedMail(
  msg: MailMessage,
  bcc: string | null,
  from: string | null,
  key?: string,
) {
  const deliveryKey = key || `mail:${crypto.randomUUID()}`;
  const existing: any = sqlite
    .prepare("SELECT * FROM suite_mail WHERE key=?")
    .get(deliveryKey);
  if (existing) return { ...existing, key: deliveryKey };
  const dir = path.join(dataDir, "mail-attachments");
  const attachments = msg.attachments?.map((a) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = crypto.randomUUID();
    fs.writeFileSync(path.join(dir, file), a.content, { mode: 0o600 });
    return { filename: a.filename, file };
  });
  const payload = JSON.stringify({ msg: { ...msg, attachments }, bcc, from });
  sqlite
    .prepare("INSERT INTO suite_mail(key,payload) VALUES(?,?)")
    .run(deliveryKey, payload);
  enqueueFollowup(`delivery:${deliveryKey}`, "mail", { key: deliveryKey });
  return {
    key: deliveryKey,
    payload,
    first_attempt_at: null,
    accepted_at: null,
  };
}
export function readMail(key: string) {
  const row: any = sqlite
    .prepare("SELECT * FROM suite_mail WHERE key=?")
    .get(key);
  if (!row) throw new Error("Queued message not found.");
  const data = JSON.parse(row.payload);
  if (!row.accepted_at)
    data.msg.attachments = data.msg.attachments?.map((a: any) => ({
      filename: a.filename,
      content: fs.readFileSync(
        path.join(dataDir, "mail-attachments", path.basename(a.file)),
      ),
    }));
  return { row, ...data };
}
export function markMailAccepted(key: string, providerId: string | null) {
  sqlite
    .prepare("UPDATE suite_mail SET accepted_at=?,provider_id=? WHERE key=?")
    .run(Date.now(), providerId, key);
  sqlite
    .prepare(
      "UPDATE suite_outbox SET status='completed',completed_at=?,last_error=NULL WHERE event_key=?",
    )
    .run(Date.now(), `delivery:${key}`);
  const row: any = sqlite
    .prepare("SELECT payload FROM suite_mail WHERE key=?")
    .get(key);
  const condition=JSON.parse(row.payload).msg.condition;
  if(condition?.kind==='review-open')sqlite.prepare('UPDATE review_requests SET sent_at=coalesce(sent_at,?) WHERE id=?').run(Date.now(),condition.id);
  for (const a of JSON.parse(row.payload).msg.attachments || []) {
    if (/^[a-f0-9-]+$/.test(a.file))
      fs.rmSync(path.join(dataDir, "mail-attachments", a.file), {
        force: true,
      });
  }
}
