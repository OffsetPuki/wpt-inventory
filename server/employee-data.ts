import { sqlite } from './storage';

export function initializeEmployeeTime() {
  const columns = new Set((sqlite.prepare('PRAGMA table_info(pm_time_entries)').all() as any[]).map(c => c.name));
  for (const [name, definition] of Object.entries({ shift_id: 'INTEGER', work_kind: "TEXT NOT NULL DEFAULT 'work'", approval_status: "TEXT NOT NULL DEFAULT 'legacy'" })) {
    if (!columns.has(name)) sqlite.exec(`ALTER TABLE pm_time_entries ADD COLUMN ${name} ${definition}`);
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS employee_shifts (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), started_at INTEGER NOT NULL,
      ended_at INTEGER, status TEXT NOT NULL DEFAULT 'running', version INTEGER NOT NULL DEFAULT 1,
      origin TEXT NOT NULL DEFAULT 'clock', reason TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER REFERENCES users(id), reviewed_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS employee_one_shift ON employee_shifts(user_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS employee_shift_history ON employee_shifts(user_id,started_at);
    CREATE INDEX IF NOT EXISTS employee_shift_entries ON pm_time_entries(shift_id);
    CREATE TABLE IF NOT EXISTS employee_time_requests (
      id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES pm_time_entries(id), user_id INTEGER NOT NULL REFERENCES users(id),
      started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, reason TEXT NOT NULL, original TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', decision_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      decided_by INTEGER, decided_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS employee_one_correction ON employee_time_requests(entry_id) WHERE status='pending';
    CREATE TABLE IF NOT EXISTS employee_job_assignments (
      project_id INTEGER NOT NULL REFERENCES projects(id), user_id INTEGER NOT NULL REFERENCES users(id),
      active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY(project_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS employee_clock_policy (
      id INTEGER PRIMARY KEY CHECK(id=1), break_paid INTEGER NOT NULL, meal_paid INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO employee_clock_policy VALUES(1,1,0);
  `);
}

export const assignedJobSql = (alias = 'p') => `(
  EXISTS(SELECT 1 FROM employee_job_assignments a WHERE a.project_id=${alias}.id AND a.user_id=@uid AND a.active=1)
  OR (NOT EXISTS(SELECT 1 FROM employee_job_assignments a WHERE a.project_id=${alias}.id AND a.user_id=@uid)
    AND EXISTS(SELECT 1 FROM pm_tasks t WHERE t.project_id=${alias}.id AND t.assignee_id=@uid AND t.deleted_at IS NULL)))`;

export function employeeHasJob(userId: number, projectId: number) {
  return !!sqlite.prepare(`SELECT 1 FROM projects p WHERE p.id=@id AND p.deleted_at IS NULL AND ${assignedJobSql()}`).get({ uid: userId, id: projectId });
}

export function employeeFileAllowed(userId: number, url: string) {
  const original = (sqlite.prepare('SELECT url FROM suite_photo_previews WHERE thumbnail_url=?').get(url) as any)?.url || url;
  return !!sqlite.prepare(`SELECT 1 FROM suite_files f JOIN projects p ON p.id=f.project_id WHERE f.url=@url AND p.deleted_at IS NULL AND ${assignedJobSql()} LIMIT 1`).get({ uid: userId, url: original });
}

export function shiftEntries(id: number) {
  return sqlite.prepare(`SELECT t.*,p.name AS project_name FROM pm_time_entries t LEFT JOIN projects p ON p.id=t.project_id WHERE t.shift_id=? ORDER BY t.started_at,t.id`).all(id) as any[];
}

export function recalculateShift(id: number) {
  // Carry fractional minutes across job changes so repeated short segments cannot inflate pay.
  let elapsed = 0, allocated = 0;
  for (const entry of shiftEntries(id)) {
    if (entry.ended_at == null) continue;
    if (!entry.work_kind.startsWith('unpaid_')) elapsed += Math.max(0, entry.ended_at - entry.started_at);
    const rounded = Math.round(elapsed / 60000);
    sqlite.prepare('UPDATE pm_time_entries SET duration_min=? WHERE id=?').run(rounded - allocated, entry.id);
    allocated = rounded;
  }
}

export const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export function intervalProblem(userId: number, start: number, end: number, exceptId = 0): string | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > 86400000 || end > Date.now() + 60000) return 'Use a completed time interval of up to 24 hours, ending no later than now.';
  if (sqlite.prepare('SELECT 1 FROM hr_payroll_runs WHERE from_date<=? AND to_date>=?').get(dayKey(end-1), dayKey(start))) return 'This payroll period is closed. Ask the owner to record a payroll correction in an open period.';
  if (sqlite.prepare('SELECT 1 FROM pm_time_entries WHERE user_id=? AND id<>? AND started_at<? AND coalesce(ended_at,?)>? LIMIT 1').get(userId, exceptId, end, Date.now()+1, start)) return 'These times overlap another recorded entry. Review the existing hours first.';
  return null;
}

export function setupIssues(userId: number) {
  const people = sqlite.prepare('SELECT * FROM hr_employees WHERE user_id=?').all(userId) as any[];
  if (people.length !== 1) return [people.length ? 'More than one employee profile uses this login. The owner must resolve the duplicate.' : 'Your login needs an employee profile. Your time will still be recorded.'];
  const e = people[0], issues: string[] = [];
  if (e.deleted_at != null || e.status === 'terminated') issues.push('The linked employee profile is inactive. Ask the owner to review it.');
  const rate = sqlite.prepare('SELECT rate_cents FROM hr_pay_rates WHERE employee_id=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1').get(e.id, dayKey(Date.now())) as any;
  if (!rate || rate.rate_cents <= 0) issues.push('Your pay information needs owner review before payroll can close.');
  return issues;
}

export type PayrollIssue = { userId: number; name: string; kind: string; message: string; entryId?: number };
export function employeePayrollIssues(start: number, end: number): PayrollIssue[] {
  const rows = sqlite.prepare(`SELECT t.*,u.name FROM pm_time_entries t JOIN users u ON u.id=t.user_id WHERE t.started_at<? AND coalesce(t.ended_at,?)>? ORDER BY t.user_id,t.started_at,t.id`).all(end, Date.now()+1, start) as any[];
  const issues: PayrollIssue[] = [], seen = new Set<string>(), lastEnd = new Map<number,number>();
  const add = (row: any, kind: string, message: string) => { const key = `${row.user_id}:${kind}`; if (!seen.has(key)) { seen.add(key); issues.push({ userId: row.user_id, name: row.name, kind, message, entryId: row.id }); } };
  for (const row of rows) {
    if (row.ended_at == null) add(row, 'running', 'Clock out or review the running timer before closing payroll.');
    if (!['legacy','approved'].includes(row.approval_status)) add(row, 'approval', 'Recorded time is waiting for review.');
    if (row.started_at < (lastEnd.get(row.user_id) ?? 0)) add(row, 'overlap', 'Time entries overlap. Review them before closing payroll.');
    lastEnd.set(row.user_id, Math.max(lastEnd.get(row.user_id) ?? 0, row.ended_at ?? Date.now()));
    const people = sqlite.prepare('SELECT id FROM hr_employees WHERE user_id=?').all(row.user_id) as any[];
    if (people.length !== 1) { add(row, 'profile', people.length ? 'Resolve duplicate employee links.' : 'Link this login to an employee profile so these hours reach payroll.'); continue; }
    if (row.duration_min <= 0 && row.ended_at != null) continue;
    for (let day = new Date(Math.max(start,row.started_at)); day.getTime() < Math.min(end,row.ended_at ?? Date.now()+1); day.setDate(day.getDate()+1)) {
      const rate = sqlite.prepare('SELECT rate_cents FROM hr_pay_rates WHERE employee_id=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1').get(people[0].id, dayKey(day.getTime())) as any;
      if (!rate || rate.rate_cents <= 0) { add(row, 'rate', 'A dated pay rate is missing or zero for recorded work.'); break; }
      day.setHours(0,0,0,0);
    }
  }
  const corrections = sqlite.prepare(`SELECT t.id,t.user_id,u.name FROM employee_time_requests r JOIN pm_time_entries t ON t.id=r.entry_id JOIN users u ON u.id=t.user_id WHERE r.status='pending' AND ((t.started_at<? AND t.ended_at>?) OR (r.started_at<? AND r.ended_at>?))`).all(end,start,end,start) as any[];
  for (const row of corrections) add(row, 'correction', 'A time correction is awaiting a decision.');
  return issues;
}
