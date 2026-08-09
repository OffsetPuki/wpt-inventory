// =============================================================================
//  Mailer archive + audit check.
//  Run:  npx tsx scripts/mailer-archive-check.mjs
//        (tsx, not node — it imports the server's TypeScript directly)
//
//  The suite sends over an HTTP API, so nothing it emails ever lands in the
//  shop's Gmail "Sent" folder. Two things make a send visible instead: a blind
//  archive copy, and an audit row per attempt. Both are easy to break silently
//  — a customer would never notice, and neither would the owner — so they get
//  a check.
//
//  No email is sent: the transport's fetch is stubbed and every audit row this
//  writes is deleted again on the way out.
// =============================================================================

process.env.RESEND_API_KEY = "test-key-not-real";
process.env.MAIL_FROM = "CJM Metals <support@cjmmetals.com>";
process.env.OWNER_EMAIL = "owner@cjmmetals.example";
delete process.env.MAIL_ARCHIVE;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

// Capture what would have gone to Resend.
let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, status: 200, text: async () => "", json: async () => ({ id: "stub" }) };
};

const { sendMail, sendOwnerMail } = await import("../server/mailer.ts");
const { sqlite } = await import("../server/storage.ts");

const AUDIT_MARK = "archive-check";
const lastBody = () => sent[sent.length - 1]?.body ?? {};
const auditRows = () => sqlite
  .prepare("SELECT action, target_name, details FROM audit_log WHERE details LIKE ? ORDER BY id")
  .all(`%${AUDIT_MARK}%`);

console.log("\nArchive copy:");
{
  await sendMail({ to: "customer@example.com", subject: `A quote (${AUDIT_MARK})`, text: "hi" });
  check("a customer email is blind-copied to the owner", lastBody().bcc === "owner@cjmmetals.example", JSON.stringify(lastBody().bcc));
  check("the customer still gets it, and can't see the copy", lastBody().to === "customer@example.com" && !("cc" in lastBody()));

  // sendOwnerMail already delivers to the owner — a blind copy is the same
  // email twice in the same mailbox.
  await sendOwnerMail({ subject: `Owner ping (${AUDIT_MARK})`, text: "hi" });
  check("owner notifications are not copied to themselves", lastBody().bcc === undefined, JSON.stringify(lastBody().bcc));

  process.env.MAIL_ARCHIVE = "archive@cjmmetals.example";
  await sendMail({ to: "customer@example.com", subject: `Redirected (${AUDIT_MARK})`, text: "hi" });
  check("MAIL_ARCHIVE redirects the copy", lastBody().bcc === "archive@cjmmetals.example");

  // The weekly backup rides sendOwnerMail with the whole database attached.
  // A redirected archive must never become a second copy of the business.
  await sendOwnerMail({
    subject: `Weekly backup (${AUDIT_MARK})`,
    text: "snapshot attached",
    attachments: [{ filename: "cjm.db.gz", content: Buffer.from("pretend-database") }],
  });
  check("the DB backup is never copied to a redirected archive", lastBody().bcc === undefined, JSON.stringify(lastBody().bcc));

  process.env.MAIL_ARCHIVE = "off";
  await sendMail({ to: "customer@example.com", subject: `No copy (${AUDIT_MARK})`, text: "hi" });
  check("MAIL_ARCHIVE=off turns it off", lastBody().bcc === undefined);
  delete process.env.MAIL_ARCHIVE;
}

console.log("\nAudit trail:");
{
  const rows = auditRows();
  check("every send is recorded", rows.length === 5, `got ${rows.length}`);
  check("all logged as sent", rows.every((r) => r.action === "email.sent"));
  check("the recipient is on the row", rows[0]?.target_name === "customer@example.com");
  const d = JSON.parse(rows[0]?.details ?? "{}");
  check("subject and transport are recorded", !!d.subject && d.via === "resend", JSON.stringify(d));
  check("and where the copy went", d.archivedTo === "owner@cjmmetals.example");
}

console.log("\nFailures are recorded too:");
{
  const before = auditRows().length;
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => "domain not verified" });
  const ok = await sendMail({ to: "customer@example.com", subject: `Rejected (${AUDIT_MARK})`, text: "hi" });
  const rows = auditRows();
  const last = rows[rows.length - 1];
  check("a rejected send resolves false, never throws", ok === false);
  check("and is logged as failed", last?.action === "email.failed", last?.action);
  check("with the provider's reason", /422|not verified/.test(JSON.parse(last?.details ?? "{}").error ?? ""), last?.details);
  check("nothing was silently dropped", rows.length === before + 1);
}

// Leave the audit log exactly as found.
sqlite.prepare("DELETE FROM audit_log WHERE details LIKE ?").run(`%${AUDIT_MARK}%`);
console.log(`\ncleaned up ${AUDIT_MARK} audit rows; ${auditRows().length} left`);

console.log(failures === 0 ? "\nALL CHECKS PASSED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
