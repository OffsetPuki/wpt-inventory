import {test,expect} from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{
  app=await testApp({serve:true,prepareDatabase(dir){
    const db=new Database(path.join(dir,'inventory.db'));
    db.exec(`CREATE TABLE hr_payroll_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,period_start TEXT NOT NULL,period_end TEXT NOT NULL,pay_date TEXT,status TEXT NOT NULL DEFAULT 'draft',notes TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
      INSERT INTO hr_payroll_runs(period_start,period_end,status) VALUES('2025-01-01','2025-01-07','draft');`);
    db.close();
  }});
  app.sqlite.prepare("UPDATE users SET credential_type='password'").run();
});
test.afterAll(async()=>app?.close());
test('Older payroll loads safely and explains preserved periods without calculating unknown pay',async({page})=>{
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(t=>localStorage.setItem('wpt-auth-token',t),app.owner);
  await page.goto(app.base+'/#/hr/payroll');
  await expect(page.getByRole('heading',{name:'Payroll',exact:true})).toBeVisible();
  await expect(page.getByText('Older payroll needs review',{exact:true})).toBeVisible();
  await expect(page.getByText('2025-01-01 to 2025-01-07 · Previous status: draft',{exact:true})).toBeVisible();
  await expect(page.getByText('Closed periods could not load.',{exact:false})).toHaveCount(0);
  await expect(page.getByText('no such column',{exact:false})).toHaveCount(0);
  await page.getByLabel('From',{exact:true}).fill('2025-01-01');
  await page.getByLabel('To',{exact:true}).fill('2025-01-07');
  await expect(page.getByText('This period contains older payroll records without a saved pay breakdown.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Close period and record expense',exact:true})).toBeDisabled();
  await page.getByLabel('To',{exact:true}).fill('2026-01-07');
  await page.getByLabel('From',{exact:true}).fill('2026-01-01');
  await expect(page.getByText('This period contains older payroll records without a saved pay breakdown.',{exact:false})).toHaveCount(0);
  await expect(page.getByText('no such column',{exact:false})).toHaveCount(0);
});
