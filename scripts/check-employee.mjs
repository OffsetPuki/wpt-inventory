import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { testApp } from './test-app.mjs';

const app=await testApp(),{sqlite,api,owner}=app;
const originalNow=Date.now; let now=originalNow(); Date.now=()=>now;
const key=()=>crypto.randomUUID();
const call=async(url,method='GET',body,token=owner,expected=200,requestKey=key())=>{
  const result=await api(url,method,body,token,{'Idempotency-Key':requestKey});
  assert.equal(result.status,expected,`${method} ${url}: ${JSON.stringify(result.data)}`);return result.data;
};
const {createSession}=await import('../server/auth.ts');
try {
  const worker=await call('/api/users','POST',{name:'Employee clock fixture',pin:'5678',role:'worker'},owner,201);
  const second=await call('/api/users','POST',{name:'Second employee fixture',pin:'5678',role:'worker'},owner,201);
  const token=createSession(worker.id,'worker',worker.name),other=createSession(second.id,'worker',second.name);
  const employee=await call('/api/hr/employees','POST',{userId:worker.id,firstName:'Clock',lastName:'Fixture',payType:'hourly',payRateCents:2400},owner,201);
  await call('/api/hr/employees','POST',{userId:worker.id,firstName:'Duplicate',lastName:'Fixture'},owner,409);
  await call(`/api/hr/employees/${employee.id}`,'PATCH',{userId:worker.id,phone:'555-0100'});
  const a=await call('/api/projects','POST',{jobNumber:'EMP-A',name:'Assigned job A'},owner,201);
  const b=await call('/api/projects','POST',{jobNumber:'EMP-B',name:'Assigned job B'},owner,201);
  const hidden=await call('/api/projects','POST',{jobNumber:'EMP-HIDDEN',name:'Unassigned confidential job'},owner,201);
  await call('/api/employee/assignments','POST',{userId:worker.id,projectId:a.id,active:true});
  await call('/api/employee/assignments','POST',{userId:worker.id,projectId:b.id,active:true});
  const task=await call('/api/pm/tasks','POST',{projectId:a.id,title:'Install assigned panels',assigneeId:worker.id},owner,201);
  const otherTask=await call('/api/pm/tasks','POST',{projectId:a.id,title:'Other crew task',assigneeId:second.id},owner,201);
  for(const url of ['/api/projects','/API/PROJECTS/','/api/crm/clients','/api/crm/reports','/api/quotes','/api/search?q=fixture','/api/hr/payroll/summary','/api/suite/jobs/'+hidden.id]) await call(url,'GET',undefined,token,403);
  await call('/api/employee/review','GET',undefined,token,403);
  await call('/api/employee/jobs/'+hidden.id,'GET',undefined,token,403);
  await call('/api/employee/jobs/'+a.id,'GET',undefined,other); // task assignment grants job access
  await call(`/api/employee/tasks/${otherTask.id}`,'PATCH',{status:'done',previousStatus:'todo'},token,403);
  await call(`/api/employee/tasks/${task.id}`,'PATCH',{status:'in_progress',previousStatus:'todo'},token);
  await call(`/api/employee/tasks/${task.id}`,'PATCH',{status:'done',previousStatus:'todo'},token,409);
  const job=await call(`/api/employee/jobs/${a.id}`,'GET',undefined,token);
  assert.equal(job.job.id,a.id);assert.equal(job.job.billing_mode,undefined);
  sqlite.prepare('INSERT INTO suite_files(project_id,title,url,user_id) VALUES(?,?,?,?)').run(a.id,'Assigned drawing','/uploads/employee-test.png',worker.id);
  fs.writeFileSync(path.join(app.uploadsDir,'employee-test.png'),Buffer.from('fixture image'));
  assert.equal((await api('/uploads/employee-test.png','GET',undefined,token)).status,200);
  await call('/api/employee/assignments','POST',{userId:second.id,projectId:a.id,active:false});
  assert.equal((await api('/uploads/employee-test.png','GET',undefined,other)).status,403);
  await call(`/api/employee/jobs/${a.id}`,'GET',undefined,other,403);
  const commentKey=key();await call(`/api/employee/jobs/${a.id}/comments`,'POST',{body:'Employee test progress'},token,200,commentKey);await call(`/api/employee/jobs/${a.id}/comments`,'POST',{body:'Employee test progress'},token,200,commentKey);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM suite_comments WHERE body='Employee test progress'").get().n,1);

  const initial=now,clockKey=key(),inBody={action:'in',version:0,projectId:a.id};
  const first=await call('/api/employee/clock','POST',inBody,token,200,clockKey);
  assert.deepEqual(await call('/api/employee/clock','POST',inBody,token,200,clockKey),first);
  await call('/api/employee/clock','POST',inBody,token,409);
  await call('/api/pm/time/stop','POST',{},token,403);
  const act=async(action,projectId=null)=>{const home=await call('/api/employee/home','GET',undefined,token);return call('/api/employee/clock','POST',{action,version:home.current.version,projectId},token);};
  now+=60*60000;await act('break');
  await call('/api/employee/clock','POST',{action:'out',version:1},token,409);
  now+=15*60000;await act('resume',b.id);
  now+=120*60000;await act('meal');
  now+=30*60000;await act('resume');
  now+=30*60000;
  const beforeOut=(await call('/api/employee/home','GET',undefined,token)).current;
  const outBody={action:'out',version:beforeOut.version},outKey=key();
  await call('/api/employee/clock','POST',outBody,token,200,outKey);await call('/api/employee/clock','POST',outBody,token,200,outKey);
  const history=await call('/api/employee/time','GET',undefined,token),shift=history.shifts[0];
  assert.equal(shift.status,'pending');assert.equal(shift.entries.length,5);assert.equal(shift.entries.reduce((n,e)=>n+e.duration_min,0),225);
  assert.equal(shift.entries.find(e=>e.work_kind==='unpaid_meal').duration_min,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM employee_shifts WHERE user_id=?').get(worker.id).n,1);
  const {dayKey,employeePayrollIssues}=await import('../server/employee-data.ts');
  const from=dayKey(initial),to=dayKey(now);
  const summary=()=>call(`/api/hr/payroll/summary?from=${from}&to=${to}`);
  assert.equal((await summary()).find(r=>r.employeeId===employee.id).hours,0,'Unapproved hours are not payable worksheet hours');
  await call('/api/hr/payroll/record-expense','POST',{from,to,amountCents:9000},owner,400);
  const e=shift.entries[0],correction={entryId:e.id,startedAt:e.started_at,endedAt:e.ended_at-5*60000,reason:'Actual arrival was recorded incorrectly'};
  await call('/api/employee/time-requests','POST',correction,other,404);
  await call('/api/employee/time-requests','POST',{...correction,endedAt:e.ended_at+10*60000},token,409);
  const request=await call('/api/employee/time-requests','POST',correction,token);
  await call('/api/employee/review/'+shift.id,'POST',{version:shift.version,action:'approve',note:''},owner,409);
  await call('/api/employee/time-requests/'+request.id+'/decision','POST',{action:'approve',note:'Confirmed actual work time with employee'});
  assert.equal(sqlite.prepare('SELECT started_at FROM pm_time_entries WHERE id=?').get(e.id).started_at,e.started_at);
  const afterCorrection=(await call('/api/employee/time','GET',undefined,token)).shifts[0];
  assert.equal(afterCorrection.entries.reduce((n,e)=>n+e.duration_min,0),220);
  await call('/api/employee/review/'+shift.id,'POST',{version:shift.version,action:'approve',note:''},owner,409);
  await call('/api/employee/review/'+shift.id,'POST',{version:afterCorrection.version,action:'approve',note:'Reviewed job and break times'});
  assert.equal((await summary()).find(r=>r.employeeId===employee.id).hours,3.67);
  await call(`/api/pm/time/${e.id}`,'PATCH',{durationMin:900},owner,409);
  await call(`/api/pm/time/${e.id}`,'DELETE',undefined,owner,409);
  const {projectLabor}=await import('../server/labor-cost.ts');assert.equal(projectLabor(a.id).groups[0].minutes,55);
  await call('/api/employee/manual-time','POST',{startedAt:initial+1000,endedAt:initial+60000,projectId:a.id,reason:'Overlapping request'},token,409);

  // Missing HR links never prevent punching; they prevent silently closing payroll.
  now+=60000;await call('/api/employee/clock','POST',{action:'in',version:0,projectId:null},other);now+=30*60000;
  const secondHome=await call('/api/employee/home','GET',undefined,other);assert(secondHome.setup.length);
  await call('/api/employee/clock','POST',{action:'out',version:secondHome.current.version},other);
  const secondShift=(await call('/api/employee/time','GET',undefined,other)).shifts[0];
  await call('/api/employee/review/'+secondShift.id,'POST',{version:secondShift.version,action:'approve',note:''},owner,409);
  const secondProfile=await call('/api/hr/employees','POST',{userId:second.id,firstName:'Second',lastName:'Fixture',payType:'hourly',payRateCents:2000},owner,201);
  await call('/api/employee/review/'+secondShift.id,'POST',{version:secondShift.version,action:'approve',note:''});
  assert.equal((await summary()).find(r=>r.employeeId===secondProfile.id).hours,0.5);
  const check=await call(`/api/employee/payroll-check?from=${from}&to=${dayKey(now)}`);assert.deepEqual(check.issues,[]);
  const total=(await call(`/api/hr/payroll/summary?from=${from}&to=${dayKey(now)}`)).reduce((n,r)=>n+r.grossCents,0);
  await call('/api/hr/payroll/record-expense','POST',{from,to:dayKey(now),amountCents:total},owner,201);
  await call('/api/employee/time-requests','POST',correction,token,409);
  const snapshot=sqlite.prepare('SELECT snapshot FROM hr_payroll_runs').get().snapshot;
  assert.equal(JSON.parse(snapshot).find(r=>r.employeeId===employee.id).grossCents,8800);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM audit_log WHERE action LIKE ?').get('employee.%').n>10,true);
  assert.equal(employeePayrollIssues(initial,now).length,0);

  const leave=await call('/api/hr/leave','POST',{employeeId:employee.id,type:'vacation',startDate:'2027-01-04',endDate:'2027-01-04',days:1},token,201);
  assert.equal(leave.status,'pending');
  await call(`/api/employee/leave/${leave.id}/decision`,'POST',{action:'approved'},token,403);
  await call(`/api/employee/leave/${leave.id}/decision`,'POST',{action:'approved'});
  await call(`/api/hr/leave/${leave.id}`,'DELETE',undefined,token,409);
  assert((await call('/api/employee/messages','GET',undefined,token)).some(n=>n.title.includes('approved')));
  assert.equal(sqlite.prepare('SELECT snapshot FROM hr_payroll_runs').get().snapshot,snapshot,'Closed payroll is immutable');
  // Completed requests in an earlier open period exercise return/deny and billing locks.
  const past=new Date(initial);past.setDate(past.getDate()-4);past.setHours(8,0,0,0);
  const manual=await call('/api/employee/manual-time','POST',{startedAt:+past,endedAt:+past+3600000,projectId:a.id,reason:'Phone was unavailable at arrival'},token);
  let m=(await call('/api/employee/time','GET',undefined,token)).shifts.find(s=>s.id===manual.id);
  await call('/api/employee/review/'+m.id,'POST',{version:m.version,action:'return',note:'Please verify the arrival time'});
  m=(await call('/api/employee/time','GET',undefined,token)).shifts.find(s=>s.id===manual.id);
  assert.equal(m.status,'changes_requested');
  await call('/api/employee/review/'+m.id,'POST',{version:m.version,action:'approve',note:'Original time confirmed'});
  const priorCost=projectLabor(a.id).costCents;
  const denied=await call('/api/employee/time-requests','POST',{entryId:m.entries[0].id,startedAt:+past,endedAt:+past+3500000,reason:'Please double-check this time'},token);
  assert.equal(projectLabor(a.id).costCents,priorCost-2400,'Pending correction withdraws approved hours from billing');
  await call('/api/employee/time-requests/'+denied.id+'/decision','POST',{action:'deny',note:'Original finish time was correct'});
  m=(await call('/api/employee/time','GET',undefined,token)).shifts.find(s=>s.id===manual.id);
  assert.equal(m.status,'pending');assert.equal(m.entries[0].duration_min,60);
  await call('/api/employee/review/'+m.id,'POST',{version:m.version,action:'approve',note:'Original record reviewed again'});
  const bill=await call('/api/finance/invoices','POST',{projectId:a.id,items:'[]'},owner,201);
  sqlite.prepare('UPDATE pm_time_entries SET invoice_id=? WHERE shift_id=?').run(bill.id,m.id);
  await call('/api/employee/time-requests','POST',{entryId:m.entries[0].id,startedAt:+past,endedAt:+past+3500000,reason:'Cannot rewrite billed work'},token,409);

  // A carried-over running timer becomes a reviewable shift, never a duplicate ledger.
  const legacyStart=new Date(initial);legacyStart.setDate(legacyStart.getDate()-2);legacyStart.setHours(8,0,0,0);
  const old=sqlite.prepare('INSERT INTO pm_time_entries(user_id,started_at) VALUES(?,?) RETURNING id').get(worker.id,+legacyStart);
  const beforeLegacy=sqlite.prepare('SELECT count(*) n FROM pm_time_entries WHERE user_id=?').get(worker.id).n;
  await call('/api/employee/clock','POST',{action:'in',version:0,projectId:null},token,409);
  const currentNow=now;now=+legacyStart+30*60000;
  await call('/api/employee/clock','POST',{action:'stop_legacy',version:old.id},token);now=currentNow;
  assert.equal(sqlite.prepare('SELECT count(*) n FROM pm_time_entries WHERE user_id=?').get(worker.id).n,beforeLegacy);
  assert.equal(sqlite.prepare('SELECT approval_status FROM pm_time_entries WHERE id=?').get(old.id).approval_status,'pending');

  // Owner records a missed finish, with an explicit note and fresh review afterward.
  // Seed a still-running shift in an earlier open period (today is already closed).
  const missedStart=new Date(initial);missedStart.setDate(missedStart.getDate()-6);missedStart.setHours(6,0,0,0);
  const missed=sqlite.prepare('INSERT INTO employee_shifts(user_id,started_at) VALUES(?,?) RETURNING *').get(second.id,+missedStart);
  sqlite.prepare("INSERT INTO pm_time_entries(user_id,shift_id,started_at,work_kind,approval_status) VALUES(?,?,?,'shop','pending')").run(second.id,missed.id,+missedStart);
  await call('/api/employee/shifts/'+missed.id+'/close','POST',{version:missed.version,endedAt:+missedStart+13*3600000,reason:'Confirmed actual finish with employee'});
  const closedShift=(await call('/api/employee/time','GET',undefined,other)).shifts.find(s=>s.id===missed.id);
  assert.equal(closedShift.long,true);assert.equal(closedShift.entries[0].duration_min,780);
  await call('/api/employee/review/'+missed.id,'POST',{version:closedShift.version,action:'approve',note:''},owner,409);
  await call('/api/employee/review/'+missed.id,'POST',{version:closedShift.version,action:'approve',note:'Confirmed long shift with crew lead'});
  const {initializeEmployeeTime}=await import('../server/employee-data.ts');initializeEmployeeTime();
  assert.equal(sqlite.prepare('SELECT count(*) n FROM employee_shifts WHERE id=?').get(missed.id).n,1,'Migration can repeat without losing shifts');
  assert.equal(sqlite.prepare('SELECT snapshot FROM hr_payroll_runs').get().snapshot,snapshot);
  console.log('Employee workflow passed: assignment privacy, idempotent clock, paid/unpaid breaks, job switches, corrections, approvals, payroll links, payroll close and time off.');
} finally { Date.now=originalNow;await app.close(); }
