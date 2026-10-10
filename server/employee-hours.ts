import { sqlite } from './storage';
import { dayKey } from './employee-data';
import { lockedTime, payrollRange } from './payroll';

export function employeePeriod() {
  const policy = sqlite.prepare('SELECT period_from,period_to FROM employee_clock_policy WHERE id=1').get() as any;
  if (policy.period_from && policy.period_to) return {from:policy.period_from,to:policy.period_to,label:'Pay period'};
  const start = new Date(Date.now()); start.setHours(0,0,0,0); start.setDate(start.getDate()-(start.getDay()+6)%7);
  const end = new Date(start); end.setDate(end.getDate()+6);
  return {from:dayKey(+start),to:dayKey(+end),label:'This week'};
}

// Use the same rounded ledger minutes and boundary proration as payroll.
// Open shifts are separate from submitted hours; unpaid time is never payable.
export function employeeHours(userId: number, from: string, to: string) {
  const range = payrollRange(from,to), now = Date.now();
  const rows = sqlite.prepare(`SELECT t.*,p.name AS project_name,s.status AS shift_status,s.review_note
    FROM pm_time_entries t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN employee_shifts s ON s.id=t.shift_id
    WHERE t.user_id=? AND t.started_at<? AND coalesce(t.ended_at,?)>? ORDER BY t.started_at,t.id`).all(userId,range.end,now,range.start) as any[];
  const totals = {approved:0,pending:0,changes:0,running:0,paidBreak:0,unpaid:0,adjustments:0,legacy:0};
  const days = new Map<string,any>();
  const dayFor = (date:string) => {if (!days.has(date)) days.set(date,{date,paid:0,unpaid:0,entries:[],adjustments:[]}); return days.get(date);};
  for (const row of rows) {
    const end = row.ended_at ?? now, span = end-row.started_at;
    if (span<=0) continue;
    const status = row.shift_status==='running' || row.ended_at==null ? 'running'
      : row.approval_status==='changes_requested' ? 'changes'
      : ['legacy','approved'].includes(row.approval_status) ? 'approved' : 'pending';
    const locked = lockedTime({invoiceId:row.invoice_id,startedAt:row.started_at,endedAt:row.ended_at}) || !!(row.shift_id && sqlite.prepare('SELECT 1 FROM pm_time_entries WHERE shift_id=? AND invoice_id IS NOT NULL').get(row.shift_id));
    for (let date = new Date(Math.max(range.start,row.started_at)); +date<Math.min(range.end,end);) {
      const next = new Date(date); next.setHours(0,0,0,0); next.setDate(next.getDate()+1);
      const a = Math.max(+date,row.started_at), b = Math.min(+next,end,range.end), portion = (b-a)/span;
      const unpaid = row.work_kind.startsWith('unpaid_') ? (b-a)/60000 : 0;
      const paid = row.work_kind.startsWith('unpaid_') ? 0 : (row.ended_at==null ? span/60000 : row.duration_min)*portion;
      totals[status]+=paid; totals.unpaid+=unpaid;
      if (row.work_kind.startsWith('paid_')) totals.paidBreak+=paid;
      if (row.approval_status==='legacy') totals.legacy+=paid;
      const day = dayFor(dayKey(a)); day.paid+=paid; day.unpaid+=unpaid;
      day.entries.push({...row,status,locked,countedStart:a,countedEnd:b,paidMinutes:paid,unpaidMinutes:unpaid});
      date=next;
    }
  }
  const adjustments = sqlite.prepare('SELECT id,minutes_delta,effective_date,reason FROM hr_time_corrections WHERE user_id=? AND effective_date>=? AND effective_date<=? ORDER BY effective_date,id').all(userId,from,to) as any[];
  for (const a of adjustments) {totals.approved+=a.minutes_delta;totals.adjustments+=a.minutes_delta;const day=dayFor(a.effective_date);day.paid+=a.minutes_delta;day.adjustments.push(a);}
  return {from,to,totals,days:[...days.values()].sort((a,b)=>b.date.localeCompare(a.date))};
}
