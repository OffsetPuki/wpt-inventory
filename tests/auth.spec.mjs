import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { testApp } from '../scripts/test-app.mjs';
let app;
test.beforeAll(async () => {
  app = await testApp({serve:true});
  app.sqlite.prepare("UPDATE users SET pin=?,credential_type='password',totp_secret='JBSWY3DPEHPK3PXP' WHERE id=1")
    .run(await bcrypt.hash('Synthetic existing password 2026',12));
  process.env.NODE_ENV='production';
});
test.afterAll(async () => { process.env.NODE_ENV='development'; await app.close(); });

test('Existing owner signs in with a password, changes it and returns without authenticator setup', async ({page}) => {
  await page.goto(app.base);
  await expect(page.getByLabel(/authenticator|recovery code/i)).toHaveCount(0);
  await page.getByLabel('Your name',{exact:true}).fill('Owner');
  await page.getByLabel('Password or PIN',{exact:true}).fill('Synthetic existing password 2026');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
  await page.goto(app.base+'/#/security');
  await expect(page.getByRole('heading',{name:'Password and devices'})).toBeVisible();
  await page.getByLabel('Current password or PIN').fill('wrong password');
  await page.getByLabel('New password (12+ characters)').fill('Synthetic changed password 2026');
  await page.getByLabel('Confirm password').fill('Synthetic changed password 2026');
  await page.getByRole('button',{name:'Save password'}).click();
  await expect(page.getByRole('alert')).toContainText('Check your current password or PIN.');
  await page.getByLabel('Current password or PIN').fill('Synthetic existing password 2026');
  await page.getByRole('button',{name:'Save password'}).click();
  await expect(page.getByText('Password saved. Your other devices have been signed out.')).toBeVisible();
  await page.getByRole('button',{name:'Continue to the suite'}).click();
  await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
  await page.goto(app.base+'/#/security');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByLabel('Your name',{exact:true}).fill('Owner');
  await page.getByLabel('Password or PIN',{exact:true}).fill('Synthetic changed password 2026');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
  await page.goto(app.base+'/#/security');
  await expect(page.getByRole('heading',{name:'Password and devices'})).toBeVisible();
  await expect(page.getByLabel(/authenticator|recovery code/i)).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/password-only-mobile.png',animations:'disabled'});
});
