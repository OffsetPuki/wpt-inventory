import { sqlite } from "./storage";
import { dateKey, rateOn } from "./payroll";

// Job labor is attributed to the day worked. Salary allocations are estimates
// (annual / 2080); payroll itself retains its calendar-day salary calculation.
export function projectLabor(projectId: number, unbilledOnly = false) {
  const entries = sqlite
    .prepare(
      `SELECT t.*,u.name AS user_name,e.id AS employee_id,(SELECT count(*) FROM hr_employees all_employees WHERE all_employees.user_id=t.user_id) AS employee_matches
    FROM pm_time_entries t JOIN users u ON u.id=t.user_id
    LEFT JOIN hr_employees e ON e.id=(SELECT e2.id FROM hr_employees e2 WHERE e2.user_id=t.user_id ORDER BY e2.deleted_at IS NULL DESC,e2.id DESC LIMIT 1)
    WHERE t.project_id=? AND t.ended_at IS NOT NULL
    ${unbilledOnly ? "AND t.billable=1 AND t.invoice_id IS NULL" : ""}`,
    )
    .all(projectId) as any[];
  const groups = new Map<string, any>();
  let missingRateMinutes = 0;
  function add(
    row: any,
    minutes: number,
    rate: number | null,
    payType: string,
    correctionId?: number,
  ) {
    if (rate == null) missingRateMinutes += Math.abs(minutes);
    const key = `${row.user_id}:${rate}:${payType}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        userId: row.user_id,
        userName: row.user_name,
        minutes: 0,
        entryIds: [],
        correctionIds: [],
        payRateCents: rate ?? 0,
        payType,
        costCents: 0,
        missingRate: rate == null,
      };
      groups.set(key, g);
    }
    g.minutes += minutes;
    g.costCents += (minutes / 60) * (rate ?? 0);
    if (correctionId) g.correctionIds.push(correctionId);
    else if (!g.entryIds.includes(row.id)) g.entryIds.push(row.id);
  }
  for (const row of entries) {
    const end = Number(row.ended_at),
      start = Number(row.started_at);
    if (end <= start) {
      if (row.duration_min) add(row, row.duration_min, null, "unknown");
      continue;
    }
    let day = new Date(start);
    day.setHours(0, 0, 0, 0);
    while (day.getTime() < end) {
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const minutes =
        (row.duration_min *
          Math.max(
            0,
            Math.min(end, next.getTime()) - Math.max(start, day.getTime()),
          )) /
        (end - start);
      const rate =
        row.employee_id == null || row.employee_matches !== 1
          ? undefined
          : rateOn(row.employee_id, dateKey(day));
      if (minutes)
        add(
          row,
          minutes,
          rate
            ? rate.pay_type === "salary"
              ? rate.rate_cents / 2080
              : rate.rate_cents
            : null,
          rate?.pay_type ?? "unknown",
        );
      day = next;
    }
  }
  const corrections = sqlite
    .prepare(
      `SELECT c.*,t.id AS entry_id,u.name AS user_name
    FROM hr_time_corrections c JOIN pm_time_entries t ON t.id=c.time_entry_id JOIN users u ON u.id=c.user_id
    WHERE t.project_id=? ${unbilledOnly ? "AND t.billable=1 AND c.invoice_id IS NULL" : ""}`,
    )
    .all(projectId) as any[];
  for (const c of corrections)
    add(c, c.minutes_delta, c.rate_cents, "correction", c.id);
  const rows = [...groups.values()].map((g) => ({
    ...g,
    costCents: Math.round(g.costCents),
  }));
  return {
    groups: rows,
    minutes: rows.reduce((s, g) => s + g.minutes, 0),
    costCents: rows.reduce((s, g) => s + g.costCents, 0),
    missingRateMinutes,
    salaryEstimated: rows.some((g) => g.payType === "salary"),
  };
}
