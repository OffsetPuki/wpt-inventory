import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app;
test.beforeAll(async()=>{
 app=await testApp({serve:true});
 app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
});
test.afterAll(async()=>app.close());
test('Carport frame view survives dimension changes without changing selected materials',async({page})=>{
 await page.route('https://www.cjmmetals.com/customize/carport?*',route=>route.fulfill({contentType:'text/html',body:`<html><body><p id="mode"></p><script>
 addEventListener('message',e=>{if(e.data.kind!=='cjm-design-preview')return;window.design=e.data.state;document.getElementById('mode').textContent=window.design.previewMode;parent.postMessage({kind:'cjm-preview-applied'},'*');});
 parent.postMessage({kind:'cjm-preview-ready'},'*');
 </script></body></html>`}));
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.goto(app.base+'/#/crm/quotes');
 await page.getByRole('button',{name:/Carport Free-standing/}).click();
 const frame=page.frameLocator('iframe[title="carport website preview"]');
 await expect(frame.locator('#mode')).toHaveText('finished');
 await page.getByRole('button',{name:'Frame only',exact:true}).click();
 await expect(frame.locator('#mode')).toHaveText('frame');
 await page.getByRole('textbox',{name:'Depth',exact:true}).fill('40');
 await page.getByRole('textbox',{name:'Depth',exact:true}).press('Tab');
 await expect.poll(()=>frame.locator('body').evaluate(()=>window.design.depth)).toBe(40);
 await expect(frame.locator('#mode')).toHaveText('frame');
 await expect(page.getByRole('button',{name:'Frame only',exact:true})).toHaveAttribute('aria-pressed','true');
 const panel=await frame.locator('body').evaluate(()=>window.design.panel);
 await page.getByRole('button',{name:'Finished',exact:true}).click();
 await expect(frame.locator('#mode')).toHaveText('finished');
 expect(await frame.locator('body').evaluate(()=>window.design.panel)).toBe(panel);
 await page.screenshot({path:'test-results/carport-view-controls.png',fullPage:true});
});
