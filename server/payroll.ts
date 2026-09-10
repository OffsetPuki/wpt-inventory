import { sqlite } from "./storage";

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS hr_pay_rates (
    id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, effective_date TEXT NOT NULL,
    pay_type TEXT NOT NULL, rate_cents INTEGER NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(employee_id, effective_date)
  );
  CREATE TABLE IF NOT EXISTS hr_payroll_runs (
    id INTEGER PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL, snapshot TEXT NOT NULL,
    total_cents INTEGER NOT NULL, expense_id INTEGER, closed_by INTEGER NOT NULL, closed_at INTEGER NOT NULL,
    UNIQUE(from_date, to_date)
  );
  CREATE TABLE IF NOT EXISTS hr_time_corrections (
    id INTEGER PRIMARY KEY, time_entry_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    minutes_delta INTEGER NOT NULL, effective_date TEXT NOT NULL, rate_cents INTEGER NOT NULL,
    reason TEXT NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
`);

export function payrollDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use a valid YYYY-MM-DD date.");
  const date = new Date(`${value}T00:00:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== Number(value.slice(0, 4)) ||
    date.getMonth() + 1 !== Number(value.slice(5, 7)) ||
    date.getDate() !== Number(value.slice(8))
  )
    throw new Error("Invalid date.");
  return date;
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function payrollRange(from: string, to: string) {
  const start = payrollDate(from);
  const end = payrollDate(to);
  end.setDate(end.getDate() + 1);
  if (from > to || end.getTime() - start.getTime() > 367 * 86400000)
    throw new Error("Choose an ordered payroll period of at most one year.");
  return { start: start.getTime(), end: end.getTime() };
}
export function closedPeriod(from: string, to = from): boolean {
  return !!sqlite
    .prepare(
      "SELECT 1 FROM hr_payroll_runs WHERE from_date <= ? AND to_date >= ? LIMIT 1",
    )
    .get(to, from);
}
export function lockedTime(entry: {
  invoiceId?: number | null;
  startedAt: number;
  endedAt?: number | null;
}): boolean {
  return (
    entry.invoiceId != null ||
    closedPeriod(
      dateKey(new Date(entry.startedAt)),
      dateKey(
        new Date(
          Math.max(entry.startedAt, (entry.endedAt ?? entry.startedAt) - 1),
        ),
      ),
    )
  );
}

export function initializePayRates() {
  // Preserve the rate known at migration. Earlier rates cannot be recovered
  // from the old schema; existing history must be reviewed before first close.
  sqlite.exec(`INSERT INTO hr_pay_rates (employee_id, effective_date, pay_type, rate_cents, created_at)
    SELECT id, coalesce(hire_date, '0001-01-01'), pay_type, pay_rate_cents, unixepoch()*1000 FROM hr_employees e
    WHERE NOT EXISTS (SELECT 1 FROM hr_pay_rates r WHERE r.employee_id=e.id);
    CREATE TRIGGER IF NOT EXISTS hr_initial_pay_rate AFTER INSERT ON hr_employees BEGIN
      INSERT INTO hr_pay_rates (employee_id, effective_date, pay_type, rate_cents, created_at)
      VALUES (NEW.id, coalesce(NEW.hire_date, '0001-01-01'), NEW.pay_type, NEW.pay_rate_cents, unixepoch()*1000);
    END;`);
}

export function rateOn(
  employeeId: number,
  date: string,
): { pay_type: string; rate_cents: number } | undefined {
  return sqlite
    .prepare(
      "SELECT pay_type, rate_cents FROM hr_pay_rates WHERE employee_id=? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1",
    )
    .get(employeeId, date) as any;
}

export function payrollSummary(from: string, to: string) {
  const { start, end } = payrollRange(from, to);
  const closed = sqlite
    .prepare(
      "SELECT snapshot FROM hr_payroll_runs WHERE from_date=? AND to_date=?",
    )
    .get(from, to) as any;
  if (closed) return JSON.parse(closed.snapshot) as any[];
  const employees = sqlite
    .prepare("SELECT * FROM hr_employees ORDER BY last_name, first_name")
    .all() as any[];
  const rows: any[] = [];
  for (const employee of employees) {
    const entries =
      employee.user_id == null
        ? []
        : (sqlite
            .prepare(
              `SELECT * FROM pm_time_entries
      WHERE user_id=? AND ended_at IS NOT NULL AND started_at < ? AND ended_at > ?`,
            )
            .all(employee.user_id, end, start) as any[]);
    const corrections =
      employee.user_id == null
        ? []
        : (sqlite
            .prepare(
              `SELECT * FROM hr_time_corrections
      WHERE user_id=? AND effective_date>=? AND effective_date<=?`,
            )
            .all(employee.user_id, from, to) as any[]);
    if (
      (employee.deleted_at != null || employee.status === "terminated") &&
      !entries.length &&
      !corrections.length &&
      (!employee.end_date || employee.end_date < from)
    )
      continue;
    let minutes = 0;
    let gross = 0;
    const rates = new Set<string>();
    let lastRate = rateOn(employee.id, from);
    for (
      let day = new Date(start);
      day.getTime() < end;
      day.setDate(day.getDate() + 1)
    ) {
      const key = dateKey(day);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const rate = rateOn(employee.id, key);
      if (!rate) continue;
      lastRate = rate;
      rates.add(`${rate.pay_type}:${rate.rate_cents}`);
      if (rate.pay_type === "salary") {
        if (
          (!employee.hire_date || employee.hire_date <= key) &&
          (!employee.end_date || employee.end_date >= key)
        ) {
          const year = day.getFullYear();
          const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
          gross += rate.rate_cents / (leap ? 366 : 365);
        }
      }
      for (const entry of entries) {
        const overlap = Math.max(
          0,
          Math.min(entry.ended_at, next.getTime()) -
            Math.max(entry.started_at, day.getTime()),
        );
        const portion =
          entry.ended_at > entry.started_at
            ? overlap / (entry.ended_at - entry.started_at)
            : 0;
        const mins = Number(entry.duration_min || 0) * portion;
        minutes += mins;
        if (rate.pay_type === "hourly") gross += (mins / 60) * rate.rate_cents;
      }
    }
    for (const correction of corrections) {
      minutes += correction.minutes_delta;
      gross += (correction.minutes_delta / 60) * correction.rate_cents;
    }
    if (!lastRate) continue;
    rows.push({
      employeeId: employee.id,
      name: `${employee.first_name} ${employee.last_name}`.trim(),
      payType: lastRate.pay_type,
      payRateCents: lastRate.rate_cents,
      multipleRates: rates.size > 1,
      hours: Math.round((minutes / 60) * 100) / 100,
      grossCents: Math.round(gross),
      linkedLogin: employee.user_id != null,
    });
  }
  return rows;
}
