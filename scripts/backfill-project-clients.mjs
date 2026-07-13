// One-time backfill (wiring plan, Fix 2): link existing projects to CRM
// clients by matching the free-text `customer` column against crm_clients
// names (case-insensitive, trimmed). Only UNAMBIGUOUS matches are linked —
// zero or multiple candidates are reported for manual linking in the UI.
// Idempotent: projects that already have a client_id are skipped.
//
//   node scripts/backfill-project-clients.mjs [path/to/inventory.db]
//
// Run with the server STOPPED.
import Database from "better-sqlite3";

const dbPath = process.argv[2] ?? "data/inventory.db";
const db = new Database(dbPath);

const unlinked = db.prepare(`
  SELECT id, job_number, name, customer FROM projects
  WHERE deleted_at IS NULL AND client_id IS NULL
    AND customer IS NOT NULL AND TRIM(customer) != ''
`).all();

const findClients = db.prepare(`
  SELECT id, name FROM crm_clients
  WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM(?))
`);
const link = db.prepare("UPDATE projects SET client_id = ? WHERE id = ?");

let linked = 0;
const manual = [];
for (const p of unlinked) {
  const candidates = findClients.all(p.customer);
  if (candidates.length === 1) {
    link.run(candidates[0].id, p.id);
    console.log(`  linked: ${p.job_number} "${p.name}" → client #${candidates[0].id} ${candidates[0].name}`);
    linked++;
  } else {
    manual.push({ ...p, candidates: candidates.length });
  }
}

console.log(`\nBackfill done: ${linked} linked, ${manual.length} need manual linking, ${unlinked.length} scanned.`);
if (manual.length) {
  console.log("Manual review (0 = no client with that name, 2+ = ambiguous):");
  for (const m of manual) {
    console.log(`  - ${m.job_number} "${m.name}" customer="${m.customer}" (${m.candidates} candidate(s))`);
  }
}
