import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import {initializePayrollRuns, payrollPeriodLocked} from '../server/payroll-schema.ts';
import {testApp} from './test-app.mjs';

const legacyDDL=`CREATE TABLE hr_payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,period_start TEXT NOT NULL,period_end TEXT NOT NULL,
  pay_date TEXT,status TEXT NOT NULL DEFAULT 'draft',notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);`;
const empty=new Database(':memory:');
empty.exec(legacyDDL);
initializePayrollRuns(empty);
assert.deepEqual(empty.prepare('SELECT * FROM hr_legacy_payroll_runs').all(),[]);
empty.prepare('INSERT INTO hr_payroll_runs(from_date,to_date,snapshot,total_cents,closed_by,closed_at) VALUES(?,?,?,?,?,?)').run('2026-01-01','2026-01-07','[]',0,1,123);
initializePayrollRuns(empty);
assert.equal(empty.prepare('SELECT count(*) n FROM hr_payroll_runs').get().n,1);
empty.close();

let original;
const app=await testApp({prepareDatabase(dir){
  const db=new Database(path.join(dir,'inventory.db'));
  db.pragma('foreign_keys=ON');
  db.exec(legacyDDL);
  db.prepare('INSERT INTO hr_payroll_runs(id,period_start,period_end,pay_date,status,notes,created_at) VALUES(?,?,?,?,?,?,?)').run(7,'2025-01-01','2025-01-07','2025-01-10','draft','Preserve original payroll notes',12345);
  original=db.prepare('SELECT * FROM hr_payroll_runs').all();
  db.exec('CREATE TABLE legacy_payroll_fixture(id INTEGER PRIMARY KEY,run_id INTEGER REFERENCES hr_payroll_runs(id)); INSERT INTO legacy_payroll_fixture VALUES(1,7);');
  db.close();
}});
const {sqlite,api,owner}=app;
const call=async(url,method='GET',body,status=200)=>{
  const r=await api(url,method,body,owner);
  assert.equal(r.status,status,`${url}: ${JSON.stringify(r.data)}`);return r.data;
};
try {
  assert.deepEqual(sqlite.prepare('SELECT * FROM hr_legacy_payroll_runs').all(),original);
  assert.deepEqual(sqlite.pragma('foreign_key_check'),[]);
  assert.equal(sqlite.pragma('foreign_key_list(legacy_payroll_fixture)')[0].table,'hr_legacy_payroll_runs');
  assert.equal(payrollPeriodLocked(sqlite,'2025-01-04','2025-01-09'),true);
  assert.equal(payrollPeriodLocked(sqlite,'2026-01-01','2026-01-07'),false);
  const runs=await call('/api/hr/payroll/runs');
  assert.equal(runs[0].legacy_status,'draft');assert.equal(runs[0].total_cents,null);
  assert.match((await call('/api/hr/payroll/summary?from=2025-01-01&to=2025-01-07','GET',undefined,400)).message,/older payroll/);
  await call('/api/hr/labor-policy','POST',{effectiveDate:'2024-12-30',weeklyHours:40,multiplier:1.5,burdenPct:0,reviewed:true},409);
  const user=await call('/api/users','POST',{name:'Legacy migration fixture',pin:'6789',role:'worker'},201);
  await call('/api/hr/employees','POST',{userId:user.id,firstName:'Migration',lastName:'Fixture',payType:'hourly',payRateCents:2500},201);
  const start=+new Date('2026-01-05T09:00:00');
  sqlite.prepare('INSERT INTO pm_time_entries(user_id,started_at,ended_at,duration_min) VALUES(?,?,?,60)').run(user.id,start,start+3600000);
  const summary=await call('/api/hr/payroll/summary?from=2026-01-05&to=2026-01-05');
  assert.equal(summary[0].grossCents,2500);
  await call('/api/hr/payroll/record-expense','POST',{from:'2026-01-05',to:'2026-01-05',amountCents:2500},201);
  assert.deepEqual(await call('/api/hr/payroll/summary?from=2026-01-05&to=2026-01-05'),summary);
  assert.equal((await call('/api/hr/payroll/runs')).length,2);
  assert.equal(payrollPeriodLocked(sqlite,'2026-01-05','2026-01-05'),true);
  const snapshot=sqlite.prepare('SELECT snapshot FROM hr_payroll_runs').get().snapshot;
  initializePayrollRuns(sqlite);
  assert.deepEqual(sqlite.prepare('SELECT * FROM hr_legacy_payroll_runs').all(),original);
  assert.equal(sqlite.prepare('SELECT snapshot FROM hr_payroll_runs').get().snapshot,snapshot);
  assert.deepEqual(sqlite.pragma('foreign_key_check'),[]);
  assert.equal(sqlite.pragma('integrity_check',{simple:true}),'ok');
  console.log('Legacy payroll migration passed: empty/populated tables, preserved records and references, repeat startup, period locks, summary and new payroll close.');
} finally {await app.close();}
