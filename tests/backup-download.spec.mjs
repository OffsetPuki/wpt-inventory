import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {t as readTar} from 'tar';
import {testApp} from '../scripts/test-app.mjs';

test('Prepared backup stays available for a user click and a stopped-download retry',async({page})=>{
 const app=await testApp({serve:true});
 try{
  app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='JBSWY3DPEHPK3PXP' WHERE id=1").run();
  const token=crypto.randomBytes(32).toString('hex');
  app.sqlite.prepare("INSERT INTO sessions(token,user_id,role,name,expires_at) VALUES(?,1,'owner','Owner',?)").run(token,Date.now()+3600000);
  await page.addInitScript(t=>localStorage.setItem('wpt-auth-token',t),token);
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
  const lead=await app.api('/api/public/leads','POST',{name:'Synthetic backup photo',photos:[photo]},null,{'X-Lead-Key':'test-intake-key'});
  expect(lead.status).toBe(201);
  const photoPath=JSON.parse(app.sqlite.prepare('SELECT photos FROM crm_leads WHERE id=?').get(lead.data.id).photos)[0].slice(1);
  await page.goto(app.base+'/#/settings');
  await page.getByRole('button',{name:'Prepare backup',exact:true}).click();
  const save=page.getByRole('link',{name:'Save backup',exact:true});await expect(save).toBeVisible();
  await expect(page.getByText('Backup downloaded',{exact:true})).toHaveCount(0);
  const url=await save.getAttribute('href');expect(url).toMatch(/^blob:/);
  const pending=page.waitForEvent('download');await save.click();const first=await pending;
  expect(first.suggestedFilename()).toMatch(/^cjm-full-.*\.tar\.gz$/);
  const archive=await first.path();const entries=[];await readTar({file:archive,onReadEntry:entry=>entries.push(entry.path)});
  expect(entries).toContain(photoPath);expect(entries.some(n=>/^snapshot-.*\.db$/.test(n))).toBe(true);
  // The same link must survive a completed handoff so the customer can retry
  // without generating or requesting another complete backup.
  const again=page.waitForEvent('download');await save.click();const second=await again;
  expect(fs.readFileSync(await second.path())).toEqual(fs.readFileSync(archive));
  expect(await save.getAttribute('href')).toBe(url);
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({animations:'disabled',path:'test-results/backup-ready-mobile.png'});
 }finally{await page.close();await app.close();}
});
