// One-time backfill (wiring plan, Fix 1): post a Finance expense for every
// payroll run that was already marked PAID before the payroll→finance hook
// existed. Idempotent — `auto:payroll-run:<id>` in notes is the dedupe key,
// so rerunning skips anything already posted.
//
//   node scripts/backfill-payroll-expenses.mjs [path/to/inventory.db]
//
// Run with the server STOPPED (better-sqlite3 holds an exclusive lock during
// writes; avoids stepping on live traffic).
import Database from "better-sqlite3";

const dbPath = process.argv[2] ?? "data/inventory.db";
const db = new Database(dbPath);

const runs = db.prepare(`
  SELECT r.id, r.period_start, r.period_end, r.pay_date,
         COALESCE((SELECT SUM(p.gross_cents) FROM hr_payslips p WHERE p.run_id = r.id), 0) AS gross
  FROM hr_payroll_runs r
  WHERE r.status = 'paid'
  ORDER BY r.id
`).all();

const dupe = db.prepare(
  "SELECT id FROM fin_expenses WHERE deleted_at IS NULL AND notes LIKE ?",
);
// created_at falls back to the table's DEFAULT (unixepoch() * 1000).
const insert = db.prepare(`
  INSERT INTO fin_expenses (date, vendor, category, amount_cents, payment_method, billable, notes)
  VALUES (?, 'Payroll', 'payroll', ?, 'other', 0, ?)
`);

let posted = 0;
let skipped = 0;
for (const r of runs) {
  if (dupe.get(`%auto:payroll-run:${r.id}%`) || r.gross <= 0) {
    skipped++;
    continue;
  }
  // Historical accuracy: book it on the pay date, else the period end.
  insert.run(
    r.pay_date ?? r.period_end,
    r.gross,
    `auto:payroll-run:${r.id} — payroll ${r.period_start} → ${r.period_end}`,
  );
  console.log(`  posted: run #${r.id} (${r.period_start} → ${r.period_end}) — $${(r.gross / 100).toFixed(2)}`);
  posted++;
}
console.log(
  `Backfill done: ${posted} expense(s) posted, ${skipped} skipped (already posted / zero gross), ${runs.length} paid run(s) scanned.`,
);
