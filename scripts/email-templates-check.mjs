// =============================================================================
//  Email template check.
//  Run:  npx tsx scripts/email-templates-check.mjs
//        (tsx, not node — it imports the server's TypeScript directly)
//
//  Moving nine emails out of the code and into an editable catalog is a silent
//  change if it goes wrong: the customer still gets AN email, just the wrong
//  one. So the first block below pins each template against the exact wording
//  it replaced, character for character.
//
//  The rest covers the machinery: the unsubscribe link an owner can't delete,
//  the off switch, and the once-and-only-once guarantee on scheduled sends.
//
//  No email is sent — the transport is stubbed — and every row this writes is
//  removed again on the way out.
// =============================================================================

process.env.RESEND_API_KEY = "test-key-not-real";
process.env.MAIL_FROM = "CJM Metals <support@cjmmetals.com>";
process.env.OWNER_EMAIL = "owner@cjmmetals.example";
process.env.MAIL_ARCHIVE = "off";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}
function same(name, actual, expected) {
  if (actual === expected) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}

let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  return { ok: true, status: 200, text: async () => "", json: async () => ({ id: "stub" }) };
};

const { renderTemplate, render, runCustomEmailSweep } = await import("../server/email-templates.ts");
const { sqlite } = await import("../server/storage.ts");

const SIGNOFF = "— CJM Metals · Arlington, TX";

console.log("\nWording is unchanged from what the code used to send:");
{
  const share = renderTemplate("quote.share", {
    firstName: "Amy", customerName: "Amy Linton",
    quoteNumber: "Q-2026-0631", quoteUrl: "https://x/q/abc",
  });
  same("quote share — subject", share.subject, "Your quote from CJM Metals — Q-2026-0631");
  same("quote share — body", share.text,
    // Full name in the greeting, exactly as this email always read.
    `Hi Amy Linton,\n\n` +
    `Your quote Q-2026-0631 from CJM Metals is ready. View it (and accept it online) here:\n\n` +
    `https://x/q/abc\n\n` +
    `Questions? Just reply to this email or give us a call.\n\n` +
    SIGNOFF);

  const overdue = renderTemplate("invoice.overdue", {
    firstName: "Amy", invoiceNumber: "INV-2026-0042", balance: "$1,200.00", dueDate: "2026-09-08",
  });
  same("overdue reminder — subject", overdue.subject, "Friendly reminder — invoice INV-2026-0042 — CJM Metals");
  same("overdue reminder — body", overdue.text,
    `Hi Amy,\n\n` +
    `Just a friendly reminder that invoice INV-2026-0042 has an outstanding ` +
    `balance of $1,200.00 (it was due 2026-09-08). If you've already sent ` +
    `payment, please disregard this note.\n\n` +
    `Questions? Just reply to this email or give us a call.\n\n` +
    SIGNOFF);

  const review = renderTemplate("review.request", { firstName: "Amy", reviewUrl: "https://x/review/abc" });
  same("review request — subject", review.subject, "How did we do? — CJM Metals");
  same("review request — body", review.text,
    `Hi Amy,\n\n` +
    `Thanks for choosing CJM Metals for your project. If you have a minute, ` +
    `we'd really appreciate a quick review — it takes about 30 seconds:\n\n` +
    `https://x/review/abc\n\n` +
    `Thank you!\n\n` +
    SIGNOFF);

  const partial = renderTemplate("payment.receipt.partial", {
    firstName: "Amy", amount: "$500.00", invoiceNumber: "INV-2026-0042", balance: "$700.00",
  });
  same("receipt with a balance", partial.text,
    `Hi Amy,\n\n` +
    `We received your payment of $500.00 on invoice INV-2026-0042. Remaining balance: $700.00.\n\n` +
    SIGNOFF);

  const final = renderTemplate("payment.receipt.final", {
    firstName: "Amy", amount: "$700.00", invoiceNumber: "INV-2026-0042",
  });
  same("receipt paid in full", final.text,
    `Hi Amy,\n\n` +
    `We received your payment of $700.00 on invoice INV-2026-0042. Your invoice is paid in full — thank you!\n\n` +
    SIGNOFF);

  const leave = renderTemplate("hr.leave.decision", {
    firstName: "Sam", status: "approved", leaveType: "vacation", dates: "2026-09-01–2026-09-05",
  });
  same("leave decision", leave.text,
    `Hi Sam,\n\nYour vacation leave request for 2026-09-01–2026-09-05 was approved.`);

  const fu1 = renderTemplate("quote.followup1", {
    firstName: "Amy", quoteNumber: "Q-2026-0631", quoteTotal: "$3,655.67",
    quoteUrl: "https://x/q/abc", unsubscribeUrl: "https://x/q/optout?token=abc",
  });
  check("follow-up #1 keeps its unsubscribe link", fu1.text.endsWith(
    `${SIGNOFF}\n\nNo more emails about this quote: https://x/q/optout?token=abc`), fu1.text.slice(-90));
}

console.log("\nGuardrails:");
{
  // An owner who deletes the unsubscribe token gets it back — the ladder is
  // automated mail, and opting out of it has to stay possible.
  sqlite.prepare(`
    INSERT INTO email_templates (id, subject, body, enabled, custom, updated_at)
    VALUES ('quote.followup1', 'Hi', 'No link here at all.', 1, 0, ?)
    ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, body = excluded.body
  `).run(Date.now());
  const stripped = renderTemplate("quote.followup1", { unsubscribeUrl: "https://x/optout" });
  check("a deleted unsubscribe link is put back", stripped.text.includes("https://x/optout"), stripped.text);

  // Off means off.
  sqlite.prepare("UPDATE email_templates SET enabled = 0 WHERE id = 'quote.followup1'").run();
  check("a switched-off email renders nothing to send", renderTemplate("quote.followup1", {}) === null);
  sqlite.prepare("DELETE FROM email_templates WHERE id = 'quote.followup1'").run();

  // A line whose optional value is missing disappears, so the owner never has
  // to write conditional syntax.
  same("an empty optional line drops out",
    render("Hi Amy,\nDue {{dueDate}}\nThanks", { dueDate: "" }, new Set(["dueDate"])),
    "Hi Amy,\nThanks");
  same("...and stays when it has a value",
    render("Hi Amy,\nDue {{dueDate}}\nThanks", { dueDate: "Sept 8" }, new Set(["dueDate"])),
    "Hi Amy,\nDue Sept 8\nThanks");
}

console.log("\nScheduled emails send once, and only once:");
{
  const TOKEN = "e".repeat(48);
  const marker = "TPLCHECK";
  sqlite.prepare("DELETE FROM quotes WHERE number = ?").run(`Q-${marker}`);
  const payload = JSON.stringify({ customer: { email: "customer@example.com" } });
  const sentAt = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
  const q = sqlite.prepare(`
    INSERT INTO quotes (number, type, customer_name, total_cents, payload, share_token, status, sent_at)
    VALUES (?, 'table', 'Amy Linton', 172839, ?, ?, 'sent', ?) RETURNING id
  `).get(`Q-${marker}`, payload, TOKEN, sentAt);

  sqlite.prepare("DELETE FROM email_templates WHERE id = ?").run("custom.tplcheck");
  sqlite.prepare("DELETE FROM email_custom_sends WHERE template_id = ?").run("custom.tplcheck");
  sqlite.prepare(`
    INSERT INTO email_templates (id, subject, body, enabled, custom, name, anchor, delay_days, updated_at)
    VALUES ('custom.tplcheck', 'How is it holding up, {{firstName}}?', 'Hi {{firstName}}, about {{quoteNumber}}.', 1, 1, 'Check-in', 'quote.sent', 30, ?)
  `).run(Date.now());

  sent = [];
  const n1 = await runCustomEmailSweep();
  check("the due quote gets the email", n1 >= 1 && sent.length >= 1, `sent ${sent.length}`);
  const mine = sent.find((m) => String(m.subject).includes("holding up"));
  check("addressed to the customer", mine?.to === "customer@example.com", JSON.stringify(mine?.to));
  same("variables filled from the quote", mine?.subject, "How is it holding up, Amy?");
  same("body filled too", mine?.text, "Hi Amy, about Q-TPLCHECK.");

  // The sent history reads these rows back, and can only say WHICH email each
  // one was because renderTemplate stamps its id onto the message.
  const logged = sqlite.prepare(`
    SELECT action, target_name, details FROM audit_log
    WHERE action IN ('email.sent','email.failed') AND details LIKE ?
  `).all('%"template":"custom.tplcheck"%');
  check("the send lands in the history, tagged with its template", logged.length === 1, `${logged.length} rows`);
  check("history row names the recipient", logged[0]?.target_name === "customer@example.com");
  same("history row carries the subject", JSON.parse(logged[0]?.details ?? "{}").subject,
    "How is it holding up, Amy?");

  sent = [];
  await runCustomEmailSweep();
  check("a second sweep does not send it again", sent.length === 0, `sent ${sent.length}`);

  // A quote that hasn't reached the delay yet must wait its turn.
  sqlite.prepare("UPDATE quotes SET sent_at = ? WHERE number = ?").run(Date.now(), `Q-${marker}`);
  sqlite.prepare("DELETE FROM email_custom_sends WHERE template_id = 'custom.tplcheck'").run();
  sent = [];
  await runCustomEmailSweep();
  check("a quote sent today is not chased 30 days early", sent.length === 0, `sent ${sent.length}`);

  sqlite.prepare("DELETE FROM email_templates WHERE id = 'custom.tplcheck'").run();
  sqlite.prepare("DELETE FROM email_custom_sends WHERE template_id = 'custom.tplcheck'").run();
  sqlite.prepare("DELETE FROM quotes WHERE number = ?").run(`Q-${marker}`);
  // The sweep really sent (to a stub), so the mailer really audited it.
  sqlite.prepare("DELETE FROM audit_log WHERE action LIKE 'email.%' AND details LIKE ?")
    .run("%holding up%");
  check("test data cleaned up",
    sqlite.prepare("SELECT count(*) c FROM quotes WHERE number = ?").get(`Q-${marker}`).c === 0
    && sqlite.prepare("SELECT count(*) c FROM audit_log WHERE details LIKE ?").get("%holding up%").c === 0);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
