import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>app.close());
test('Engineering studio opens the full film-table draft and shares one stable link',async({page})=>{
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.goto(app.base+'/#/design-studio');
 await expect(page.getByRole('heading',{name:'CJM Design Studio',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open film table project'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Project title',{exact:true})).toHaveValue('Film stretching table');
 await expect(dialog.getByText('Film table · full interactive process',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Enable customer link'}).click();
 await expect(dialog.getByLabel('Customer preview link')).toHaveValue(/https:\/\//);
 const p=(await app.api('/api/customer-previews','GET',undefined,app.owner)).data.find(p=>p.title==='Film stretching table');
 expect(p.options[0].kind).toBe('html');expect(p.published).toBe(true);
});
