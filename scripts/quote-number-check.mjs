// =============================================================================
//  Quote number allocation check — the sequence behind "Q-2026-0631".
//  Run:  node scripts/quote-number-check.mjs
//  In-memory SQLite, no server and no real data touched. Exit 1 on any break.
//
//  Guards the two things that would quietly hand a customer the wrong number:
//  the substr offset that reads the tail off "Q-<year>-<0000>", and the floor
//  that continues the shop's own book instead of restarting at 1.
// =============================================================================

import Database from 'better-sqlite3';

const NUMBER_START = 631; // keep in sync with server/quotes.ts

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

const db = new Database(':memory:');
db.exec('CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE)');

// The exact expression server/quotes.ts seeds the sequence with.
const highestIssued = () => db.prepare(
  'SELECT coalesce(max(cast(substr(number, 8) as integer)), 0) AS m FROM quotes',
).get().m;

const nextNumber = (year = 2026) => {
  let seq = Math.max(highestIssued() + 1, NUMBER_START);
  for (let attempt = 0; attempt < 50; attempt++, seq++) {
    const number = `Q-${year}-${String(seq).padStart(4, '0')}`;
    try {
      db.prepare('INSERT INTO quotes (number) VALUES (?)').run(number);
      return number;
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) continue;
      throw e;
    }
  }
  throw new Error('too many collisions');
};

console.log('\nQuote numbering:');

// The four quotes already issued by the old max(id)+1 scheme.
for (const n of ['Q-2026-0001', 'Q-2026-0002', 'Q-2026-0003', 'Q-2026-0004']) {
  db.prepare('INSERT INTO quotes (number) VALUES (?)').run(n);
}
check('reads the tail off an issued number', highestIssued() === 4, `got ${highestIssued()}`);
check('next quote continues the shop book at 631', nextNumber() === 'Q-2026-0631');
check('then counts up', nextNumber() === 'Q-2026-0632' && nextNumber() === 'Q-2026-0633');

// A new year must NOT reset the ledger back down to the floor.
check('new year keeps counting, not restarts', nextNumber(2027) === 'Q-2027-0634');
check('and reads a prior-year tail correctly', highestIssued() === 634, `got ${highestIssued()}`);

// Numbers already in a customer's inbox are never reissued.
{
  const all = db.prepare('SELECT number FROM quotes').all().map((r) => r.number);
  check('no number handed out twice', new Set(all).size === all.length);
  check('existing quotes were left alone', all.includes('Q-2026-0004'));
}

// Past the floor, the constant stops mattering — the ledger drives itself.
{
  const fresh = new Database(':memory:');
  fresh.exec('CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE)');
  fresh.prepare('INSERT INTO quotes (number) VALUES (?)').run('Q-2026-0900');
  const m = fresh.prepare(
    'SELECT coalesce(max(cast(substr(number, 8) as integer)), 0) AS m FROM quotes',
  ).get().m;
  check('a book past the floor is not dragged back', Math.max(m + 1, NUMBER_START) === 901);
}

// Empty table: the very first quote on a fresh install starts at the floor.
{
  const fresh = new Database(':memory:');
  fresh.exec('CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE)');
  const m = fresh.prepare(
    'SELECT coalesce(max(cast(substr(number, 8) as integer)), 0) AS m FROM quotes',
  ).get().m;
  check('empty book starts at the floor', Math.max(m + 1, NUMBER_START) === NUMBER_START);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED ✓' : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
