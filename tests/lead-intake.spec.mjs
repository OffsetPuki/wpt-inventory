import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {testApp} from '../scripts/test-app.mjs';
test('Website request opens from Today beyond the list page; contact and qualification stay connected',async({page})=>{
 const app=await testApp({serve:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='JBSWY3DPEHPK3PXP' WHERE id=1").run();
  const token=crypto.randomBytes(32).toString('hex');app.sqlite.prepare("INSERT INTO sessions(token,user_id,role,name,expires_at) VALUES(?,1,'owner','Owner',?)").run(token,Date.now()+3600000);
  await page.addInitScript(t=>localStorage.setItem('wpt-auth-token',t),token);
  const input=await app.api('/api/public/leads','POST',{name:'Website project to contact',site:'insulation',email:'customer@example.test',service:'Pipe insulation',contact:'Email',bestTime:'Weekdays after 3 pm',area:'Arlington',qualification:{facilityCompany:'Synthetic facility',deadline:'2026-10-01'}},null,{'X-Lead-Key':'test-intake-key'});
  expect(input.status).toBe(201);
  for(let n=0;n<52;n++)await app.api('/api/crm/leads','POST',{name:`Later request ${n}`,site:'metals'},token);
  await page.goto(app.base+'/#/today');
  await page.getByRole('link',{name:'Website project to contact',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Weekdays after 3 pm',{exact:true})).toBeVisible();await expect(dialog.getByText('Synthetic facility',{exact:true})).toBeVisible();
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({animations:'disabled',path:'test-results/lead-context-mobile.png'});
  await dialog.getByLabel('Qualified project',{exact:true}).check();
  await expect.poll(()=>app.sqlite.prepare('SELECT qualified_at FROM crm_lead_intake WHERE lead_id=?').get(input.data.id)?.qualified_at).toBeTruthy();
  await dialog.getByRole('button',{name:'Log email',exact:true}).click();
  await expect.poll(()=>app.sqlite.prepare('SELECT first_contact_at FROM crm_lead_intake WHERE lead_id=?').get(input.data.id)?.first_contact_at).toBeTruthy();
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({animations:'disabled',path:'test-results/lead-request-mobile.png'});
  await page.keyboard.press('Escape');await page.goto(app.base+'/#/today');
  await expect(page.getByRole('link',{name:'Website project to contact',exact:true})).toHaveCount(0);
  await page.getByText('Lead results · last 90 days',{exact:true}).click();await expect(page.getByRole('table').first()).toContainText('insulation');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 }finally{await page.close();await app.close();}
});
