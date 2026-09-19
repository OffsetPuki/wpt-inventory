import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>app.close());
test('Navigation search, mobile keyboard access, and shared pages',async({page})=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.goto(app.base+'/#/today');
 await expect(page.getByRole('region',{name:'Quick access'})).toBeVisible();
 await page.getByRole('button',{name:'Open menu'}).click();
 const menu=page.getByRole('dialog',{name:'Navigation menu'});
 await expect(menu.getByRole('button',{name:'Close menu'})).toBeFocused();
 await menu.getByLabel('Find a page').fill('previews');
 await expect(menu.getByRole('link',{name:'Customer previews',exact:true})).toBeVisible();
 await menu.getByRole('link',{name:'Customer previews',exact:true}).click();
 await expect(menu).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Customer previews',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open menu'}).click();
 await menu.getByLabel('Find a page').fill('nonesuchpage');
 await expect(menu.getByText('No matching pages. Try another name.')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Open menu'})).toBeFocused();
 for(const [route,title] of [['/crm/leads','Leads'],['/crm/clients','Clients'],['/crm/quotes','New quote'],['/projects','Jobs'],['/pm/board','Task board'],['/pm/schedule','Schedule'],['/finance/invoices','Invoices'],['/finance/expenses','Expenses'],['/finance/purchase-orders','Purchase orders'],['/home','Inventory'],['/hr/employees','Employees'],['/hr/leave','Time off'],['/settings','Settings']]){
  await page.goto(app.base+'/#'+route);
  await expect(page.locator('#suite-main').getByRole('heading',{name:title,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' fits mobile').toBe(true);
 }
 await page.goto(app.base+'/#/today');
 await expect(page.getByRole('region',{name:'Quick access'})).toBeVisible();
 await page.screenshot({path:'test-results/suite-today-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'test-results/suite-today-desktop.png',fullPage:true});
 expect(errors).toEqual([]);
});
