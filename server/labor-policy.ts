import {sqlite} from './storage';
import type {Express} from 'express';
import {requireElevated} from './auth';
import {z} from 'zod';
import {audit} from './audit';
sqlite.exec(`CREATE TABLE IF NOT EXISTS hr_labor_policies(effective_date TEXT PRIMARY KEY,weekly_hours REAL NOT NULL,multiplier REAL NOT NULL,burden_pct REAL NOT NULL,created_by INTEGER NOT NULL,created_at INTEGER NOT NULL)`);
export function laborPolicy(date:string):any{return sqlite.prepare('SELECT * FROM hr_labor_policies WHERE effective_date<=? ORDER BY effective_date DESC LIMIT 1').get(date);}
const dayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
// Weekly premiums use the weighted straight-time rate; allocate premiums to
// hours above the selected threshold, in chronological order, across all jobs.
export function laborPremiums(userId:number,from:number,to:number){
 const start=new Date(from);start.setHours(0,0,0,0);start.setDate(start.getDate()-(start.getDay()+6)%7);
 const end=new Date(to);end.setHours(0,0,0,0);end.setDate(end.getDate()+7-(end.getDay()+6)%7);
 const employee=sqlite.prepare('SELECT id FROM hr_employees WHERE user_id=?').all(userId) as any[];
 if(employee.length!==1)return [];
 const rates=sqlite.prepare('SELECT * FROM hr_pay_rates WHERE employee_id=? ORDER BY effective_date DESC').all(employee[0].id) as any[];
 const entries=sqlite.prepare('SELECT * FROM pm_time_entries WHERE user_id=? AND ended_at IS NOT NULL AND started_at<? AND ended_at>? ORDER BY started_at,id').all(userId,end.getTime(),start.getTime()) as any[];
 const result:any[]=[];
 for(let week=new Date(start);week<end;week.setDate(week.getDate()+7)){
  const next=new Date(week);next.setDate(next.getDate()+7);const policy=laborPolicy(dayKey(week));if(!policy)continue;
  const parts:any[]=[];
  for(const e of entries){
   for(let day=new Date(week);day<next;day.setDate(day.getDate()+1)){
    const dayEnd=new Date(day);dayEnd.setDate(dayEnd.getDate()+1);
    const overlap=Math.max(0,Math.min(e.ended_at,dayEnd.getTime())-Math.max(e.started_at,day.getTime()));
    const rate=rates.find(r=>r.effective_date<=dayKey(day));
    if(!overlap||!rate||rate.pay_type!=='hourly'||e.ended_at<=e.started_at)continue;
    parts.push({entryId:e.id,projectId:e.project_id,day:day.getTime(),order:e.started_at,minutes:e.duration_min*overlap/(e.ended_at-e.started_at),rate:rate.rate_cents});
   }
  }
  const corrections=sqlite.prepare('SELECT c.*,t.project_id FROM hr_time_corrections c JOIN pm_time_entries t ON t.id=c.time_entry_id WHERE c.user_id=? AND c.effective_date>=? AND c.effective_date<?').all(userId,dayKey(week),dayKey(next)) as any[];
  for(const c of corrections)parts.push({entryId:c.time_entry_id,projectId:c.project_id,day:new Date(c.effective_date+'T00:00:00').getTime(),minutes:c.minutes_delta,rate:c.rate_cents,correction:true});
  parts.sort((a,b)=>a.day-b.day||(a.order??Infinity)-(b.order??Infinity)||a.entryId-b.entryId);
  const mins=parts.reduce((s,p)=>s+p.minutes,0),wages=parts.reduce((s,p)=>s+p.minutes/60*p.rate,0),weighted=mins>0?wages/(mins/60):0;
  let worked=0;
  for(const p of parts){const overtime=Math.max(0,worked+p.minutes-policy.weekly_hours*60)-Math.max(0,worked-policy.weekly_hours*60);worked+=p.minutes;
   if(p.day>=from&&p.day<to)result.push({...p,overtimeMinutes:overtime,premiumCents:overtime/60*weighted*(policy.multiplier-1),burdenPct:policy.burden_pct});
  }
 }
 return result;
}
export function registerLaborPolicy(app:Express){
 app.get('/api/hr/labor-policy',requireElevated,(_req,res)=>res.json(sqlite.prepare('SELECT * FROM hr_labor_policies ORDER BY effective_date DESC').all()));
 app.post('/api/hr/labor-policy',requireElevated,(req,res)=>{
  const schema=z.object({effectiveDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),weeklyHours:z.number().min(1).max(168),multiplier:z.number().min(1).max(3),burdenPct:z.number().min(0).max(100),reviewed:z.literal(true)});
  const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Review the weekly hours, multiplier, burden and effective date.'});
  const b=parsed.data,d=new Date(b.effectiveDate+'T00:00:00');
  if(!Number.isFinite(d.getTime())||dayKey(d)!==b.effectiveDate||d.getDay()!==1)return res.status(400).json({message:'Choose a Monday so the rule starts with a complete workweek.'});
  if(sqlite.prepare('SELECT 1 FROM hr_payroll_runs WHERE to_date>=? LIMIT 1').get(b.effectiveDate))return res.status(409).json({message:'Choose a date after closed payroll. Historical pay remains unchanged.'});
  try{sqlite.prepare('INSERT INTO hr_labor_policies VALUES(?,?,?,?,?,?)').run(b.effectiveDate,b.weeklyHours,b.multiplier,b.burdenPct,req.user!.userId,Date.now());audit(req,'payroll.policy_added',{details:b});res.status(201).json({ok:true});}
  catch{res.status(409).json({message:'A rule already starts on this date. Choose a later workweek.'});}
 });
}
