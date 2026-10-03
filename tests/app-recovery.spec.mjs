import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
test('A retired entry bundle offers a user-controlled reload',async({page})=>{
 const app=await testApp({serve:true});
 try {
  let blocked=false;
  await page.route('**/assets/*.js',route=>{blocked=true;return route.fulfill({status:404,contentType:'text/plain',body:'File not found'});});
  await page.goto(app.base);
  await expect(page.getByRole('button',{name:'Reload app',exact:true})).toBeVisible();
  expect(blocked).toBe(true);
  await expect(page.getByRole('alert')).toContainText('could not finish loading');
  await page.unroute('**/assets/*.js');
  await page.getByRole('button',{name:'Reload app',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
 }finally{await page.close();await app.close();}
});
