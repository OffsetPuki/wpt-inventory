import type { Express, Request } from 'express';
import { z } from 'zod';
import { sqlite } from './storage';
import { getSession, requireAuth, requireElevated } from './auth';
import { inventoryOnce } from './inventory-core';
import { audit } from './audit';
import { closedPeriod, lockedTime, payrollRange } from './payroll';
import { assignedJobSql, dayKey, employeeHasJob, employeePayrollIssues, intervalProblem, recalculateShift, setupIssues, shiftEntries } from './employee-data';

const id = z.coerce.number().int().positive();
const reason = z.string().trim().min(3).max(1000);
const activeShift = (uid: number) => sqlite.prepare('SELECT * FROM employee_shifts WHERE user_id=? AND ended_at IS NULL').get(uid) as any;
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const entryLocked = (e: any) => lockedTime({ invoiceId: e.invoice_id, startedAt: e.started_at, endedAt: e.ended_at });
const notify = (uid: number, key: string, title: string, href: string) => sqlite.prepare(`INSERT INTO suite_notifications(user_id,event_key,title,href) VALUES(?,?,?,?) ON CONFLICT(user_id,event_key) DO UPDATE SET title=excluded.title,href=excluded.href,read_at=NULL,resolved_at=NULL,snoozed_until=NULL`).run(uid,key,title,href);
function notifyOwners(key: string, title: string, href = '/employee-approvals') { for (const u of sqlite.prepare("SELECT id FROM users WHERE role IN ('owner','manager') AND disabled_at IS NULL").all() as any[]) notify(u.id,key,title,href); }
const displayShift = (s: any) => ({ ...s, entries: shiftEntries(s.id), long: (s.ended_at ?? Date.now())-s.started_at > 12*3600000 });
function jobs(uid: number) {
  return sqlite.prepare(`SELECT p.id,p.name,p.job_number,p.site,p.site_address,p.start_date,p.due_date,p.status,p.schedule_state FROM projects p WHERE p.deleted_at IS NULL AND ${assignedJobSql()} ORDER BY p.status='done',p.start_date IS NULL,p.start_date,p.id DESC`).all({uid});
}
function jobFor(uid: number, projectId: number, clock = false) {
  if (!employeeHasJob(uid,projectId)) fail('This job is not assigned to you.',403);
  const job = sqlite.prepare('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL').get(projectId) as any;
  if (clock && ['done','on_hold'].includes(job.status)) fail('This job is completed or on hold. Choose another job or shop work.');
  return job;
}
function segment(uid: number, shift: number, time: number, kind: string, projectId: number | null) {
  return sqlite.prepare(`INSERT INTO pm_time_entries(user_id,shift_id,project_id,description,started_at,duration_min,billable,work_kind,approval_status) VALUES(?,?,?,?,?,0,?,?,'pending') RETURNING *`).get(uid,shift,projectId,kind.replaceAll('_',' '),time,kind==='work' && projectId ? 1:0,kind) as any;
}
function once(req: Request, body: any, fn: () => any) {
  const key = z.string().min(8).max(100).parse(req.headers['idempotency-key']);
  return inventoryOnce(sqlite,req.user!.userId,key,{path:req.path,body},fn);
}

// Employee accounts use a deliberately small server-side surface. Guessing an
// old CRM, quote, job or time URL cannot bypass the employee navigation.
export function registerEmployeeBoundary(app: Express) {
  app.use((req,res,next) => {
    const apiPath=req.path.toLowerCase().replace(/\/+$/,'');
    if (!apiPath.startsWith('/api/')) return next();
    const session = typeof req.headers['x-auth']==='string' ? getSession(req.headers['x-auth']) : null;
    if (!session || ['owner','manager'].includes(session.role)) return next();
    const safe = /^\/api\/(auth\/(login|logout|me)|security\/(password|revoke-sessions))$/.test(apiPath)
      || apiPath.startsWith('/api/employee/')
      || (req.method==='GET' && ['/api/settings','/api/hr/me','/api/hr/leave','/api/suite/events'].includes(apiPath))
      || (['POST','DELETE'].includes(req.method) && /^\/api\/hr\/leave(?:\/\d+)?$/.test(apiPath));
    if (safe || apiPath.startsWith('/api/public/')) return next();
    return res.status(403).json({message:'Use your employee workspace for assigned jobs, time and messages.'});
  });
}

export function registerEmployeeRoutes(app: Express) {
  const endpoint = (method: 'get'|'post'|'patch', path: string, owner: boolean, fn: (req: Request) => any) => app[method](path,owner?requireElevated:requireAuth,(req,res) => {
    try { res.json(fn(req)); } catch (e: any) { res.status(e.status || 400).json({message:e instanceof z.ZodError ? 'Review the required fields and try again.' : e.message}); }
  });
  endpoint('get','/api/employee/home',false,req => {
    const uid = req.user!.userId, current = activeShift(uid);
    const start = new Date(); start.setHours(0,0,0,0); const week = new Date(start); week.setDate(week.getDate()-(week.getDay()+6)%7);
    const entries = sqlite.prepare('SELECT id,started_at,ended_at,duration_min,work_kind,approval_status FROM pm_time_entries WHERE user_id=? AND coalesce(ended_at,?)>? ORDER BY started_at').all(uid,Date.now()+1,week.getTime()) as any[];
    const minutesSince = (from: number) => entries.reduce((sum,e) => {
      if (e.work_kind.startsWith('unpaid_')) return sum;
      const end = e.ended_at ?? Date.now(), span = end-e.started_at;
      const portion = span > 0 ? Math.max(0,end-Math.max(from,e.started_at))/span : 0;
      return sum + (e.ended_at==null ? span/60000 : e.duration_min)*portion;
    },0);
    const me = sqlite.prepare('SELECT first_name,last_name,email,phone,job_title,emergency_contact FROM hr_employees WHERE user_id=? AND deleted_at IS NULL').get(uid) || null;
    const legacy = sqlite.prepare('SELECT id,started_at FROM pm_time_entries WHERE user_id=? AND ended_at IS NULL AND shift_id IS NULL').get(uid) || null;
    return {serverNow:Date.now(),current:current?displayShift(current):null,legacy,jobs:jobs(uid),profile:me,setup:setupIssues(uid),todayMinutes:minutesSince(start.getTime()),weekMinutes:minutesSince(week.getTime()),policy:sqlite.prepare('SELECT break_paid,meal_paid FROM employee_clock_policy WHERE id=1').get()};
  });
  endpoint('post','/api/employee/clock',false,req => {
    const body = z.object({action:z.enum(['in','out','switch','break','meal','resume','stop_legacy']),version:z.number().int().nonnegative(),projectId:z.number().int().positive().nullable().optional()}).parse(req.body);
    return once(req,body,() => {
      const uid=req.user!.userId, now=Date.now(), current=activeShift(uid);
      if (body.action==='stop_legacy') {
        if(current) fail('A shift is already running. Refresh your clock.');
        const old=sqlite.prepare('SELECT * FROM pm_time_entries WHERE user_id=? AND ended_at IS NULL AND shift_id IS NULL').get(uid) as any;
        if(!old || old.id!==body.version) fail('The old timer changed. Refresh your clock.');
        const s=sqlite.prepare("INSERT INTO employee_shifts(user_id,started_at,ended_at,status,origin,reason) VALUES(?,?,?,'pending','legacy','Running timer carried into employee clock') RETURNING *").get(uid,old.started_at,now) as any;
        sqlite.prepare("UPDATE pm_time_entries SET ended_at=?,shift_id=?,approval_status='pending' WHERE id=?").run(now,s.id,old.id); recalculateShift(s.id);
        audit(req,'employee.legacy_timer_closed',{targetType:'employee_shift',targetId:s.id}); notifyOwners(`shift:${s.id}`,'Carried-over employee hours need review');
        return {savedAt:now,shiftId:s.id};
      }
      if(body.action==='in') {
        if(current || body.version!==0 || sqlite.prepare('SELECT 1 FROM pm_time_entries WHERE user_id=? AND ended_at IS NULL').get(uid)) fail('You already have a running clock. Refresh to see its status.');
        if(closedPeriod(dayKey(now))) fail('Payroll for today is already closed. Contact the owner before starting a new time record.');
        if(body.projectId) jobFor(uid,body.projectId,true);
        const s=sqlite.prepare('INSERT INTO employee_shifts(user_id,started_at) VALUES(?,?) RETURNING *').get(uid,now) as any;
        segment(uid,s.id,now,body.projectId?'work':'shop',body.projectId??null);
        audit(req,'employee.clock_in',{targetType:'employee_shift',targetId:s.id,details:{projectId:body.projectId??null}});
        return {savedAt:now,shiftId:s.id};
      }
      if(!current || current.version!==body.version) fail('Your clock changed on another screen. Refresh its status before continuing.');
      const running=sqlite.prepare('SELECT * FROM pm_time_entries WHERE shift_id=? AND ended_at IS NULL').get(current.id) as any;
      if(!running) fail('The running segment needs owner review.');
      let kind='', projectId=body.projectId??null;
      if(['switch','resume'].includes(body.action)) { if(projectId)jobFor(uid,projectId,true);kind=projectId?'work':'shop'; }
      if(body.action==='resume' && ['work','shop'].includes(running.work_kind)) fail('Work has already resumed. Refresh your clock.');
      if(body.action==='switch' && !['work','shop'].includes(running.work_kind)) fail('End your break before switching jobs.');
      if(['break','meal'].includes(body.action)) {
        if(!['work','shop'].includes(running.work_kind)) fail('A break is already running.');
        const policy=sqlite.prepare('SELECT * FROM employee_clock_policy WHERE id=1').get() as any;
        kind=`${policy[body.action==='break'?'break_paid':'meal_paid']?'paid':'unpaid'}_${body.action}`; projectId=null;
      }
      sqlite.prepare('UPDATE pm_time_entries SET ended_at=? WHERE id=?').run(now,running.id);
      if(body.action!=='out') segment(uid,current.id,now,kind,projectId);
      sqlite.prepare('UPDATE employee_shifts SET version=version+1,ended_at=?,status=? WHERE id=?').run(body.action==='out'?now:null,body.action==='out'?'pending':'running',current.id);
      recalculateShift(current.id);
      audit(req,`employee.clock_${body.action}`,{targetType:'employee_shift',targetId:current.id,details:{at:now,kind,projectId}});
      if(body.action==='out') notifyOwners(`shift:${current.id}`,`${req.user!.name}'s hours are ready for review`);
      return {savedAt:now,shiftId:current.id};
    });
  });
  endpoint('get','/api/employee/time',false,req => {
    const uid=req.user!.userId,page=Math.max(0,Math.trunc(Number(req.query.page)||0));
    const shifts=sqlite.prepare('SELECT * FROM employee_shifts WHERE user_id=? ORDER BY started_at DESC,id DESC LIMIT 30 OFFSET ?').all(uid,page*30) as any[];
    const legacy=sqlite.prepare(`SELECT t.*,p.name AS project_name FROM pm_time_entries t LEFT JOIN projects p ON p.id=t.project_id WHERE t.user_id=? AND t.shift_id IS NULL ORDER BY t.started_at DESC LIMIT 30 OFFSET ?`).all(uid,page*30);
    return {shifts:shifts.map(displayShift),legacy,requests:sqlite.prepare('SELECT * FROM employee_time_requests WHERE user_id=? ORDER BY id DESC LIMIT 100').all(uid),hasMore:shifts.length===30 || legacy.length===30};
  });
  endpoint('post','/api/employee/manual-time',false,req => {
    const body=z.object({startedAt:z.number().int(),endedAt:z.number().int(),projectId:z.number().int().positive().nullable(),reason}).parse(req.body);
    return once(req,body,()=>{
      const uid=req.user!.userId,problem=intervalProblem(uid,body.startedAt,body.endedAt);if(problem)fail(problem);
      if(body.projectId)jobFor(uid,body.projectId);
      const s=sqlite.prepare("INSERT INTO employee_shifts(user_id,started_at,ended_at,status,origin,reason) VALUES(?,?,?,'pending','manual',?) RETURNING *").get(uid,body.startedAt,body.endedAt,body.reason) as any;
      const e=segment(uid,s.id,body.startedAt,body.projectId?'work':'shop',body.projectId);
      sqlite.prepare('UPDATE pm_time_entries SET ended_at=? WHERE id=?').run(body.endedAt,e.id);recalculateShift(s.id);
      audit(req,'employee.manual_time_requested',{targetType:'employee_shift',targetId:s.id,details:body});notifyOwners(`shift:${s.id}`,`${req.user!.name} submitted missed time`);
      return {id:s.id};
    });
  });
  endpoint('post','/api/employee/time-requests',false,req=>{
    const body=z.object({entryId:id,startedAt:z.number().int(),endedAt:z.number().int(),reason}).parse(req.body);
    return once(req,body,()=>{
      const e=sqlite.prepare('SELECT * FROM pm_time_entries WHERE id=? AND user_id=?').get(body.entryId,req.user!.userId) as any;
      if(!e)fail('Time entry not found.',404);
      if(e.ended_at==null || (e.shift_id && activeShift(e.user_id)?.id===e.shift_id))fail('Clock out before requesting a correction.');
      if((e.shift_id?shiftEntries(e.shift_id):[e]).some(entryLocked))fail('These hours are already billed or in closed payroll. Ask the owner to record a payroll correction.');
      const problem=intervalProblem(e.user_id,body.startedAt,body.endedAt,e.id);if(problem)fail(problem);
      if(sqlite.prepare("SELECT 1 FROM employee_time_requests WHERE entry_id=? AND status='pending'").get(e.id))fail('A correction for this entry is already waiting for review.');
      const result=sqlite.prepare('INSERT INTO employee_time_requests(entry_id,user_id,started_at,ended_at,reason,original,created_at) VALUES(?,?,?,?,?,?,?) RETURNING id').get(e.id,e.user_id,body.startedAt,body.endedAt,body.reason,JSON.stringify(e),Date.now());
      // Pending corrections withdraw the entire shift from payroll and billing.
      // Declining a shift correction still requires a fresh review of the original hours.
      if(e.shift_id) {
        sqlite.prepare("UPDATE employee_shifts SET status='pending',version=version+1 WHERE id=?").run(e.shift_id);
        sqlite.prepare("UPDATE pm_time_entries SET approval_status='pending' WHERE shift_id=?").run(e.shift_id);
      } else sqlite.prepare("UPDATE pm_time_entries SET approval_status='pending' WHERE id=?").run(e.id);
      audit(req,'employee.correction_requested',{targetType:'time_entry',targetId:e.id,details:body});notifyOwners(`time-request:${(result as any).id}`,`${req.user!.name} requested a time correction`);return result;
    });
  });
  endpoint('get','/api/employee/jobs/:id',false,req=>{
    const uid=req.user!.userId,projectId=id.parse(req.params.id),j=jobFor(uid,projectId);
    const customer=j.client_id?sqlite.prepare('SELECT name,phone FROM crm_clients WHERE id=? AND deleted_at IS NULL').get(j.client_id):null;
    return {job:(jobs(uid) as any[]).find(j=>j.id===projectId),customer,
      tasks:sqlite.prepare(`SELECT t.id,t.title,t.description,t.status,t.due_date,t.assignee_id,u.name AS assignee_name FROM pm_tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? AND t.deleted_at IS NULL ORDER BY t.status='done',t.order_index,t.id`).all(projectId),
      materials:sqlite.prepare('SELECT id,label AS name,qty,unit,status FROM project_checklist WHERE project_id=?').all(projectId),
      files:sqlite.prepare('SELECT id,title,url,kind FROM suite_files WHERE project_id=? AND NOT EXISTS(SELECT 1 FROM suite_files newer WHERE newer.replaces_id=suite_files.id) ORDER BY id DESC LIMIT 50').all(projectId),
      comments:sqlite.prepare("SELECT c.id,c.body,c.created_at,u.name FROM suite_comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.visibility='team' ORDER BY c.id DESC LIMIT 40").all(projectId)};
  });
  endpoint('patch','/api/employee/tasks/:id',false,req=>{
    const body=z.object({status:z.enum(['todo','in_progress','review','done']),previousStatus:z.string()}).parse(req.body);
    return sqlite.transaction(()=>{
      const t=sqlite.prepare('SELECT * FROM pm_tasks WHERE id=? AND deleted_at IS NULL').get(id.parse(req.params.id)) as any;
      if(!t || t.assignee_id!==req.user!.userId || !employeeHasJob(req.user!.userId,t.project_id))fail('Only your own assigned tasks can be updated.',403);
      if(t.status!==body.previousStatus)fail('This task changed. Refresh the job.');
      sqlite.prepare('UPDATE pm_tasks SET status=?,completed_at=? WHERE id=?').run(body.status,body.status==='done'?Date.now():null,t.id);
      audit(req,'employee.task_status',{targetType:'pm_task',targetId:t.id,details:{from:t.status,to:body.status}});return {ok:true};
    })();
  });
  endpoint('post','/api/employee/jobs/:id/comments',false,req=>{
    const projectId=id.parse(req.params.id),body=z.object({body:z.string().trim().min(1).max(4000)}).parse(req.body);
    jobFor(req.user!.userId,projectId);
    return once(req,body,()=>{
      const result=sqlite.prepare("INSERT INTO suite_comments(project_id,user_id,body,visibility) VALUES(?,?,?,'team') RETURNING id").get(projectId,req.user!.userId,body.body) as any;
      notifyOwners(`employee-comment:${result.id}`,`${req.user!.name} posted a job update`,`/project/${projectId}?tab=activity`);
      audit(req,'employee.job_comment',{targetType:'project',targetId:projectId});return result;
    });
  });
  endpoint('get','/api/employee/messages',false,req=>{
    const rows=sqlite.prepare('SELECT id,title,href,read_at,created_at FROM suite_notifications WHERE user_id=? AND resolved_at IS NULL AND (snoozed_until IS NULL OR snoozed_until<=?) ORDER BY id DESC LIMIT 100').all(req.user!.userId,Date.now()) as any[];
    return rows.map(n=>{
      let href='/employee/time';const task=n.href.match(/task=(\d+)/),job=n.href.match(/\/project\/(\d+)/);
      const projectId=task?(sqlite.prepare('SELECT project_id FROM pm_tasks WHERE id=?').get(Number(task[1])) as any)?.project_id:job?Number(job[1]):null;
      if(projectId && employeeHasJob(req.user!.userId,projectId))href=`/employee/jobs/${projectId}`;
      if(n.href==='/hr/leave')href='/hr/leave';return {...n,href};
    });
  });
  endpoint('patch','/api/employee/messages/:id',false,req=>{
    const result=sqlite.prepare('UPDATE suite_notifications SET read_at=coalesce(read_at,?) WHERE id=? AND user_id=?').run(Date.now(),id.parse(req.params.id),req.user!.userId);if(!result.changes)fail('Message not found.',404);return {ok:true};
  });

  endpoint('get','/api/employee/review',true,()=>({
    shifts:(sqlite.prepare("SELECT s.*,u.name FROM employee_shifts s JOIN users u ON u.id=s.user_id WHERE s.status<>'approved' ORDER BY s.ended_at IS NULL DESC,s.started_at LIMIT 150").all() as any[]).map(displayShift),
    requests:sqlite.prepare("SELECT r.*,u.name,t.shift_id,p.name AS project_name FROM employee_time_requests r JOIN users u ON u.id=r.user_id JOIN pm_time_entries t ON t.id=r.entry_id LEFT JOIN projects p ON p.id=t.project_id WHERE r.status='pending' ORDER BY r.id").all(),
    people:(sqlite.prepare("SELECT id,name FROM users WHERE role NOT IN ('owner','manager') AND disabled_at IS NULL ORDER BY name").all() as any[]).map(u=>({...u,issues:setupIssues(u.id)})),
    jobs:sqlite.prepare("SELECT id,name FROM projects WHERE deleted_at IS NULL AND status<>'done' ORDER BY name").all(),
    assignments:sqlite.prepare('SELECT * FROM employee_job_assignments').all(),
    policy:sqlite.prepare('SELECT break_paid,meal_paid FROM employee_clock_policy WHERE id=1').get()
  }));
  endpoint('post','/api/employee/shifts/:id/close',true,req=>{
    const body=z.object({version:z.number().int(),endedAt:z.number().int(),reason}).parse(req.body);
    return once(req,body,()=>{
      const s=sqlite.prepare('SELECT * FROM employee_shifts WHERE id=?').get(id.parse(req.params.id)) as any;
      if(!s || s.ended_at || s.version!==body.version)fail('The employee clock changed. Reload before recording a finish time.');
      const e=sqlite.prepare('SELECT * FROM pm_time_entries WHERE shift_id=? AND ended_at IS NULL').get(s.id) as any;
      if(!e)fail('No running segment was found.');
      const problem=intervalProblem(s.user_id,e.started_at,body.endedAt,e.id);if(problem)fail(problem);
      sqlite.prepare('UPDATE pm_time_entries SET ended_at=? WHERE id=?').run(body.endedAt,e.id);
      sqlite.prepare("UPDATE employee_shifts SET ended_at=?,status='pending',version=version+1,review_note=? WHERE id=?").run(body.endedAt,`Finish time recorded by owner: ${body.reason}`,s.id);
      recalculateShift(s.id);audit(req,'employee.owner_clock_out',{targetType:'employee_shift',targetId:s.id,details:body});notify(s.user_id,`clock-correction:${s.id}`,`Owner recorded your finish time: ${body.reason}`,'/employee/time');return {ok:true};
    });
  });
  endpoint('post','/api/employee/review/:id',true,req=>{
    const body=z.object({version:z.number().int(),action:z.enum(['approve','return']),note:z.string().trim().max(1000)}).parse(req.body);
    return once(req,body,()=>{
      const s=sqlite.prepare('SELECT * FROM employee_shifts WHERE id=?').get(id.parse(req.params.id)) as any;
      if(!s || s.version!==body.version)fail('This shift changed. Reload the review queue.');
      if(s.user_id===req.user!.userId)fail('Another owner must review your hours.',403);
      if(!s.ended_at || s.status==='approved')fail('Only completed, unapproved shifts can be reviewed.');
      const entries=shiftEntries(s.id);
      if(entries.some(entryLocked))fail('These hours are already locked. Record a payroll correction instead.');
      if(sqlite.prepare("SELECT 1 FROM employee_time_requests r JOIN pm_time_entries t ON t.id=r.entry_id WHERE t.shift_id=? AND r.status='pending'").get(s.id))fail('Decide the pending correction before approving this shift.');
      if((body.action==='return' || s.ended_at-s.started_at>12*3600000) && body.note.length<3)fail('Add a review note explaining the change or long shift.');
      if(body.action==='approve') {
        const problems=employeePayrollIssues(s.started_at,s.ended_at).filter(i=>i.userId===s.user_id && ['profile','rate','overlap'].includes(i.kind));
        if(problems.length)fail(problems[0].message);
      }
      const status=body.action==='approve'?'approved':'changes_requested';
      sqlite.prepare('UPDATE employee_shifts SET status=?,version=version+1,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?').run(status,body.note,req.user!.userId,Date.now(),s.id);
      sqlite.prepare('UPDATE pm_time_entries SET approval_status=? WHERE shift_id=?').run(status,s.id);
      audit(req,`employee.shift_${body.action}`,{targetType:'employee_shift',targetId:s.id,details:{note:body.note,entries}});
      notify(s.user_id,`shift-decision:${s.id}`,body.action==='approve'?'Your hours were approved':`Your hours need review: ${body.note}`,'/employee/time');return {ok:true};
    });
  });
  endpoint('post','/api/employee/time-requests/:id/decision',true,req=>{
    const body=z.object({action:z.enum(['approve','deny']),note:reason}).parse(req.body);
    return once(req,body,()=>{
      const r=sqlite.prepare("SELECT * FROM employee_time_requests WHERE id=? AND status='pending'").get(id.parse(req.params.id)) as any;
      if(!r)fail('This request has already been decided.');
      if(r.user_id===req.user!.userId)fail('Another owner must review your correction.',403);
      const e=sqlite.prepare('SELECT * FROM pm_time_entries WHERE id=?').get(r.entry_id) as any;
      if(body.action==='approve') {
        if((e.shift_id?shiftEntries(e.shift_id):[e]).some(entryLocked))fail('The original hours are locked. Use a payroll correction and explain the resolution here.');
        if(e.started_at!==JSON.parse(r.original).started_at || e.ended_at!==JSON.parse(r.original).ended_at)fail('The original entry changed. Ask for a new request.');
        const problem=intervalProblem(e.user_id,r.started_at,r.ended_at,e.id);if(problem)fail(problem);
        sqlite.prepare('UPDATE pm_time_entries SET started_at=?,ended_at=?,duration_min=?,approval_status=? WHERE id=?').run(r.started_at,r.ended_at,e.work_kind.startsWith('unpaid_')?0:Math.round((r.ended_at-r.started_at)/60000),e.shift_id?'pending':'approved',e.id);
        if(e.shift_id) {
          recalculateShift(e.shift_id);
          sqlite.prepare("UPDATE employee_shifts SET started_at=(SELECT min(started_at) FROM pm_time_entries WHERE shift_id=?),ended_at=(SELECT max(ended_at) FROM pm_time_entries WHERE shift_id=?),status='pending',version=version+1 WHERE id=?").run(e.shift_id,e.shift_id,e.shift_id);
          sqlite.prepare("UPDATE pm_time_entries SET approval_status='pending' WHERE shift_id=?").run(e.shift_id);
        }
      }
      if(body.action==='deny' && !e.shift_id) sqlite.prepare('UPDATE pm_time_entries SET approval_status=? WHERE id=?').run(JSON.parse(r.original).approval_status||'legacy',e.id);
      sqlite.prepare('UPDATE employee_time_requests SET status=?,decision_note=?,decided_by=?,decided_at=? WHERE id=?').run(body.action==='approve'?'approved':'denied',body.note,req.user!.userId,Date.now(),r.id);
      audit(req,'employee.correction_decided',{targetType:'time_entry',targetId:e.id,details:{request:r,decision:body}});
      notify(r.user_id,`correction-decision:${r.id}`,`Time correction ${body.action==='approve'?'accepted':'declined'}: ${body.note}`,'/employee/time');return {ok:true};
    });
  });
  endpoint('post','/api/employee/assignments',true,req=>{
    const body=z.object({userId:id,projectId:id,active:z.boolean()}).parse(req.body);
    if(!sqlite.prepare("SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL").get(body.userId)||!sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL').get(body.projectId))fail('Choose an active employee and job.');
    return once(req,body,()=>{
      sqlite.prepare('INSERT INTO employee_job_assignments VALUES(?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at').run(body.projectId,body.userId,Number(body.active),Date.now());
      audit(req,'employee.job_assignment',{targetType:'project',targetId:body.projectId,details:body});
      notify(body.userId,`crew:${body.projectId}`,body.active?'You have been assigned to a job':'Your job assignment changed',`/project/${body.projectId}`);return {ok:true};
    });
  });
  endpoint('post','/api/employee/clock-policy',true,req=>{
    const body=z.object({breakPaid:z.boolean(),mealPaid:z.boolean()}).parse(req.body);
    sqlite.prepare('UPDATE employee_clock_policy SET break_paid=?,meal_paid=? WHERE id=1').run(Number(body.breakPaid),Number(body.mealPaid));audit(req,'employee.clock_policy',{details:body});return {ok:true};
  });
  endpoint('get','/api/employee/payroll-check',true,req=>{
    const range=payrollRange(String(req.query.from||''),String(req.query.to||''));return {issues:employeePayrollIssues(range.start,range.end)};
  });
  endpoint('post','/api/employee/leave/:id/decision',true,req=>{
    const body=z.object({action:z.enum(['approved','denied'])}).parse(req.body);
    return once(req,body,()=>{
      const leave=sqlite.prepare("SELECT l.*,e.user_id FROM hr_leave_requests l JOIN hr_employees e ON e.id=l.employee_id WHERE l.id=? AND l.status='pending'").get(id.parse(req.params.id)) as any;
      if(!leave)fail('This time-off request has already been decided.');
      if(leave.user_id===req.user!.userId)fail('Another owner must review your request.',403);
      sqlite.prepare('UPDATE hr_leave_requests SET status=?,decided_by=?,decided_at=? WHERE id=?').run(body.action,req.user!.userId,Date.now(),leave.id);
      if(leave.user_id)notify(leave.user_id,`leave:${leave.id}`,`Your time off was ${body.action}`,'/hr/leave');audit(req,'employee.leave_decision',{targetType:'leave',targetId:leave.id,details:body});return {ok:true};
    });
  });
}
