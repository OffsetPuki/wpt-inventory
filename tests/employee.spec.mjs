import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {testApp} from '../scripts/test-app.mjs';
let app,worker,token,job,task;
const call=async(path,body,auth=app.owner)=>{
  const r=await app.api(path,body===undefined?'GET':'POST',body,auth,{'Idempotency-Key':crypto.randomUUID()});
  assert([200,201].includes(r.status),JSON.stringify(r.data));return r.data;
};
test.beforeAll(async()=>{
  app=await testApp({serve:true});
  worker=await call('/api/users',{name:'Jamie Field',pin:'5678',role:'worker'});
  await call('/api/hr/employees',{userId:worker.id,firstName:'Jamie',lastName:'Field',payType:'hourly',payRateCents:2400,phone:'555-0100'});
  const {createSession}=await import('../server/auth.ts');token=createSession(worker.id,'worker',worker.name);
  app.sqlite.prepare("UPDATE users SET credential_type='password'").run();
  job=await call('/api/projects',{name:'West shop entrance',jobNumber:'CJM-101'});
  await call('/api/projects',{name:'Private owner project',jobNumber:'CJM-HIDDEN'});
  await call('/api/employee/assignments',{userId:worker.id,projectId:job.id,active:true});
  task=await call('/api/pm/tasks',{title:'Install entrance panels',description:'Confirm measurements before installation.',projectId:job.id,assigneeId:worker.id});
});
test.afterAll(async()=>app.close());
test('Phone clock, lost-response recovery, jobs, review and payroll',async({page,context,browser})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(t=>localStorage.setItem('wpt-auth-token',t),token);
  await page.goto(app.base+'/#/today');
  await expect(page.getByRole('heading',{name:'Hi, Jamie'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Employee navigation'})).toBeVisible();
  await expect(page.getByText('Private owner project')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Clock in',exact:true})).toBeEnabled();
  await page.screenshot({path:'test-results/employee-today-phone.png',fullPage:true});
  await page.getByLabel('Where are you working?').selectOption(String(job.id));
  let lost=true;
  await page.route('**/api/employee/clock',async route=>{
    if(lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await page.getByRole('button',{name:'Clock in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry clock action'})).toBeVisible();
  await expect(page.getByText(/Saved at/)).toHaveCount(0);
  await page.reload();
  await page.getByRole('button',{name:'Retry clock action'}).click();
  await expect(page.getByText(/Saved at/)).toBeVisible();
  assert.equal(app.sqlite.prepare('SELECT count(*) n FROM employee_shifts WHERE user_id=?').get(worker.id).n,1);
  await expect(page.getByRole('button',{name:'Clock out & submit hours'})).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText('Offline · reconnect to save',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Clock out & submit hours'})).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button',{name:'Paid break',exact:true})).toBeEnabled();
  // Simulate already worked time without waiting an hour or changing the browser clock.
  const start=Date.now()-3600000;
  app.sqlite.prepare('UPDATE employee_shifts SET started_at=? WHERE user_id=?').run(start,worker.id);
  app.sqlite.prepare('UPDATE pm_time_entries SET started_at=? WHERE user_id=?').run(start,worker.id);
  await page.getByRole('button',{name:'Paid break',exact:true}).click();
  await expect(page.getByText('Paid break',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'End break · resume work'}).click();
  await expect(page.getByRole('button',{name:'Clock out & submit hours'})).toBeEnabled();
  await page.getByRole('button',{name:'Clock out & submit hours'}).click();
  await expect(page.getByRole('button',{name:'Clock in',exact:true})).toBeEnabled();
  await page.getByRole('navigation').getByRole('link',{name:'My time',exact:true}).click();
  await expect(page.getByText('Waiting for approval',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/employee-time-phone.png',fullPage:true});
  await page.getByRole('button',{name:'Request missed time',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByText('Your request was saved and sent for review.')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link',{name:'My jobs',exact:true}).click();
  await page.getByRole('link',{name:/West shop entrance/}).click();
  await expect(page.getByRole('heading',{name:'West shop entrance',exact:true})).toBeVisible();
  await page.getByLabel('Status for Install entrance panels').selectOption('done');
  await expect.poll(()=>app.sqlite.prepare('SELECT status FROM pm_tasks WHERE id=?').get(task.id).status).toBe('done');
  await page.getByLabel('Post a job update').fill('Entrance panels completed. Ready for inspection.');
  await page.getByRole('button',{name:'Post update'}).click();
  await expect(page.getByText('Entrance panels completed. Ready for inspection.',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/employee-job-phone.png',fullPage:true});
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    for(const route of ['/employee/today','/employee/jobs','/employee/time','/employee/messages','/employee/me','/hr/leave','/security']){
      await page.goto(app.base+'/#'+route);await expect(page.locator('#employee-main h1')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' fits '+width).toBe(true);
    }
  }
  const ownerContext=await browser.newContext({viewport:{width:390,height:844}}),ownerPage=await ownerContext.newPage();
  ownerPage.on('pageerror',e=>errors.push(e.message));
  await ownerPage.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await ownerPage.addInitScript(t=>localStorage.setItem('wpt-auth-token',t),app.owner);
  await ownerPage.goto(app.base+'/#/employee-approvals');
  await expect(ownerPage.getByRole('heading',{name:'Employee approvals',exact:true})).toBeVisible();
  await ownerPage.screenshot({path:'test-results/employee-owner-review-phone.png',fullPage:true});
  expect(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await ownerPage.getByRole('button',{name:'Approve hours',exact:true}).click();
  await expect(ownerPage.getByText('All submitted hours have been reviewed.')).toBeVisible();
  const {dayKey}=await import('../server/employee-data.ts');const date=dayKey(Date.now());
  const payroll=await call(`/api/hr/payroll/summary?from=${date}&to=${date}`);
  assert.equal(payroll.find(e=>e.userId===worker.id)?.hours??payroll[0].hours,1);
  await page.goto(app.base+'/#/employee/time');
  await expect(page.getByText('Approved',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);await ownerContext.close();
});
