// =============================================================================
//  Lead → quote close check — what happens to a customer's quotes when the
//  owner drags their lead to Won or Lost on the board.
//  Run:  npx tsx scripts/check-lead-quote-close.mjs
//        (tsx, not node — it imports the server's TypeScript directly)
//
//  This closes MONEY records the owner never opened: an accepted quote lands in
//  the monthly revenue chart and the costing report, a declined one drops out
//  of the dashboard's open pipeline and stops the automated follow-up emails.
//  So the rules worth pinning are the ones that would be silent if wrong:
//    · only the right customer's quotes move (email OR normalized phone),
//    · a won lead accepts ONE quote — sibling revisions would double-book it,
//    · already-answered quotes are never re-stamped,
//    · a loss reason with no customer-facing equivalent lands on "other".
//
//  ⚠ It writes quotes, so it must NEVER open the real database. DATA_DIR is
//  pinned to a throwaway directory BEFORE server/storage.ts is imported — that
//  import opens the database file, so this must stay above the imports.
// =============================================================================

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cjm-lead-quote-check-"));

const { sqlite } = await import("../server/storage.ts");
const { closeQuotesForLead } = await import("../server/crm.ts");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

// The quote module's tables (its own DDL lives in server/quotes.ts, which we
// don't load here — no routes, no express).
sqlite.exec(`
  CREATE TABLE quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'custom',
    customer_name TEXT,
    design_ref TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    sent_at INTEGER,
    accepted_at INTEGER,
    accept_note TEXT,
    declined_at INTEGER,
    decline_reason TEXT,
    decline_note TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE web_designs (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, email TEXT, phone TEXT);
`);

const NOW = 1_760_000_000_000;
let seq = 0;
const addQuote = (o = {}) => {
  const number = `Q-2026-${String(700 + ++seq).padStart(4, "0")}`;
  sqlite.prepare(`
    INSERT INTO quotes (number, customer_name, design_ref, total_cents, payload, status, sent_at, created_at)
    VALUES (@number, @name, @ref, @total, @payload, @status, @sentAt, @createdAt)
  `).run({
    number,
    name: o.name ?? "Customer",
    ref: o.ref ?? null,
    total: o.total ?? 100000,
    payload: JSON.stringify({ customer: { email: o.email ?? "", phone: o.phone ?? "" } }),
    status: o.status ?? "sent",
    sentAt: o.sentAt ?? NOW - 86_400_000,
    createdAt: o.createdAt ?? NOW - 86_400_000,
  });
  return number;
};
const row = (number) => sqlite.prepare("SELECT * FROM quotes WHERE number = ?").get(number);
const reset = () => { sqlite.exec("DELETE FROM quotes; DELETE FROM web_designs"); seq = 0; };
const lead = (o) => ({ id: 1, name: "Test", email: null, phone: null, ...o });

console.log("\nLost lead:");
{
  const mine = addQuote({ email: "Nicole@Example.COM " });
  const draft = addQuote({ email: "nicole@example.com", status: "draft" });
  const theirs = addQuote({ email: "someone.else@example.com" });
  const closed = closeQuotesForLead(
    lead({ email: "nicole@example.com" }), "lost", "price", NOW,
  );
  check("declines the customer's sent quote", row(mine).status === "declined", row(mine).status);
  check("carries the lead's loss reason", row(mine).decline_reason === "price");
  check("stamps when and why", row(mine).declined_at === NOW && !!row(mine).decline_note);
  check("takes unsent drafts out of the pipeline too", row(draft).status === "declined");
  check("leaves another customer's quote alone", row(theirs).status === "sent");
  check("reports what it closed", closed.length === 2, JSON.stringify(closed));
  reset();
}

{
  // "No response" / "good fit" have no customer-facing decline reason.
  const q = addQuote({ email: "a@b.com" });
  closeQuotesForLead(lead({ email: "a@b.com" }), "lost", "no_response", NOW);
  check("a reason the customer could not pick falls back to other",
    row(q).decline_reason === "other", row(q).decline_reason);
  reset();
}

console.log("\nWon lead:");
{
  const older = addQuote({ email: "n@example.com", sentAt: NOW - 10 * 86_400_000 });
  const newest = addQuote({ email: "n@example.com", sentAt: NOW - 2 * 86_400_000 });
  closeQuotesForLead(lead({ email: "n@example.com" }), "won", "good_fit", NOW);
  check("accepts the newest quote", row(newest).status === "accepted", row(newest).status);
  check("stamps the acceptance", row(newest).accepted_at === NOW && !!row(newest).accept_note);
  check("does NOT accept the superseded revision as well — that would double-book the job",
    row(older).status === "declined", row(older).status);
  check("and says which quote replaced it",
    (row(older).decline_note || "").includes(newest), row(older).decline_note);
  reset();
}

console.log("\nMatching:");
{
  const q = addQuote({ phone: "+1 (817) 555-0123" });
  closeQuotesForLead(lead({ phone: "817-555-0123" }), "lost", "timing", NOW);
  check("matches a phone the browser autofilled with a country code",
    row(q).status === "declined", row(q).status);
  reset();
}
{
  const q = addQuote({ phone: "+44 20 7946 0958" });
  closeQuotesForLead(lead({ phone: "020 7946 0958" }), "lost", "timing", NOW);
  check("does not collide a UK number with a 10-digit US one",
    row(q).status === "sent", row(q).status);
  reset();
}
{
  // Builder customer card left blank — the contact came in on the website
  // design the quote was started from.
  sqlite.prepare("INSERT INTO web_designs (ref, email, phone) VALUES (?, ?, ?)")
    .run("CJM-R75CA", "greg@example.com", null);
  const q = addQuote({ ref: "cjm-r75ca" });
  closeQuotesForLead(lead({ email: "greg@example.com" }), "lost", "price", NOW);
  check("falls back to the linked website design's contact",
    row(q).status === "declined", row(q).status);
  reset();
}
{
  const q = addQuote({ name: "Tim Cookson" }); // no email, no phone anywhere
  const closed = closeQuotesForLead(lead({ name: "Tim Cookson" }), "lost", "price", NOW);
  check("never closes a quote on the name alone",
    row(q).status === "sent" && closed.length === 0);
  reset();
}
{
  const q = addQuote({ email: "x@y.com" });
  const closed = closeQuotesForLead(lead({ email: null, phone: null }), "lost", "price", NOW);
  check("a lead with no contact channel closes nothing",
    row(q).status === "sent" && closed.length === 0);
  reset();
}

console.log("\nAlready answered:");
{
  const accepted = addQuote({ email: "z@z.com", status: "accepted" });
  const declined = addQuote({ email: "z@z.com", status: "declined" });
  const deleted = addQuote({ email: "z@z.com" });
  sqlite.prepare("UPDATE quotes SET deleted_at = ? WHERE number = ?").run(NOW, deleted);
  const closed = closeQuotesForLead(lead({ email: "z@z.com" }), "lost", "price", NOW);
  check("the customer's own accept is not overwritten", row(accepted).status === "accepted");
  check("an existing decline is left as the customer left it",
    row(declined).status === "declined" && row(declined).decline_reason === null);
  check("a deleted quote stays out of it",
    row(deleted).status === "sent" && closed.length === 0);
  reset();
}

console.log(failures === 0
  ? "\nAll lead → quote close checks passed.\n"
  : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
