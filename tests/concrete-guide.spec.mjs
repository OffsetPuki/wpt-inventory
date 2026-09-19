import { test, expect } from '@playwright/test';
import { testApp } from '../scripts/test-app.mjs';
let app,token;
test.beforeAll(async()=>{
  app=await testApp({serve:true});
  token=(await app.api('/api/security/password','POST',{currentPassword:'1234',password:'Concrete fixture 2026'},app.owner)).data.token;
});
test.afterAll(async()=>app.close());
test('Concrete guide saves service selections and repair units',async({page})=>{
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),token);
  await page.goto(app.base+'/#/crm/quotes');
  await page.getByLabel('Customer name',{exact:true}).fill('Concrete guide fixture');
  await page.locator('.type-card').filter({has:page.getByRole('heading',{name:'Concrete',exact:true})}).click();
  const guide=page.getByRole('region',{name:'CJM pricing guide'});
  await expect(guide).toContainText('Selected base: $8.75');
  await page.getByText('Brick wall / fence repair',{exact:true}).click();
  await page.locator('.seg-opt').filter({hasText:'Column rebuild'}).click();
  await page.locator('[name="repairQty"]').fill('2');
  await page.locator('[name="repairQty"]').blur();
  await expect(guide).toContainText('2 column');
  await expect(guide).toContainText('Selected base: $1250.00');
  await expect(page.locator('.draft-status')).toContainText('Saved');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cjm.session.v2.user.1')));
  expect(saved.state).toMatchObject({project:'brick',repairType:'column',pricingMode:'guide'});
  expect(Number(saved.state.repairQty)).toBe(2);
  await page.screenshot({path:'test-results/concrete-guide-mobile.png',fullPage:true});
});
