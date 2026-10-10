import type Database from 'better-sqlite3';

// Early installations used this name for draft periods, without amounts or
// immutable snapshots. Preserve those rows separately; never invent their pay.
export function initializePayrollRuns(db: Database.Database) {
  db.transaction(() => {
    const columns = new Set((db.pragma('table_info(hr_payroll_runs)') as {name:string}[]).map(c => c.name));
    if (columns.has('period_start') && columns.has('period_end') && !columns.has('snapshot')) {
      db.exec('ALTER TABLE hr_payroll_runs RENAME TO hr_legacy_payroll_runs');
      for (const op of ['INSERT','UPDATE','DELETE']) db.exec(`DROP TRIGGER IF EXISTS suite_change_hr_payroll_runs_${op}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS hr_legacy_payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, period_start TEXT NOT NULL,
        period_end TEXT NOT NULL, pay_date TEXT, status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
      );
      CREATE TABLE IF NOT EXISTS hr_payroll_runs (
        id INTEGER PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
        snapshot TEXT NOT NULL, total_cents INTEGER NOT NULL, expense_id INTEGER,
        closed_by INTEGER NOT NULL, closed_at INTEGER NOT NULL, UNIQUE(from_date,to_date)
      );
    `);
  })();
}

export function legacyPayrollOverlap(db: Database.Database, from: string, to: string) {
  return !!db.prepare('SELECT 1 FROM hr_legacy_payroll_runs WHERE period_start<=? AND period_end>=? LIMIT 1').get(to,from);
}

export function payrollPeriodLocked(db: Database.Database, from: string, to: string) {
  return legacyPayrollOverlap(db,from,to) || !!db.prepare('SELECT 1 FROM hr_payroll_runs WHERE from_date<=? AND to_date>=? LIMIT 1').get(to,from);
}
