import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
import {websiteTestNetwork} from '../scripts/website-test-network.mjs';
let app,network;
test.beforeAll(async()=>{app=await testApp({serve:true});network=websiteTestNetwork(app);app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();});
test.afterAll(async()=>{network.restore();await app.close();});
test.beforeEach(async({page})=>{await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);});
test('Mobile website controls show confirmed status, preserve exclusions and record changes',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(app.base+'/#/settings');await page.getByRole('link',{name:'Manage websites',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Websites',exact:true})).toBeVisible();
 const card=page.getByRole('article',{name:'CJM Insulation',exact:true}),toggle=card.getByRole('switch');
 await expect(toggle).not.toBeChecked();await expect(card.getByText('Always excluded',{exact:false})).toBeVisible();
 await card.getByRole('button',{name:'Check live status',exact:true}).click();await expect(card.getByText('Confirmed offline',{exact:true})).toBeVisible();
 await toggle.click();await expect(toggle).toBeChecked();await expect(card.getByText('Confirmed online',{exact:true})).toBeVisible();
 await page.reload();await expect(toggle).toBeChecked();await toggle.click();await expect(toggle).not.toBeChecked();
 await card.getByText('Change history',{exact:true}).click();await expect(card.getByText(/Activated website/)).toBeVisible();await expect(card.getByText(/Deactivated website/)).toBeVisible();
 const concrete=page.getByRole('article',{name:'CJM Concrete',exact:true});
 await concrete.getByRole('checkbox').click();await expect(concrete.getByRole('checkbox')).not.toBeChecked();await expect(concrete.getByRole('checkbox')).toBeEnabled();await concrete.getByRole('checkbox').click();await expect(concrete.getByRole('checkbox')).toBeChecked();
 await expect(page.getByRole('heading',{name:'Insulation search cleanup'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
test('Broken preview cannot reopen an inactive website',async({page})=>{
 network.setBrokenPreview(true);await page.goto(app.base+'/#/websites');
 const card=page.getByRole('article',{name:'CJM Insulation',exact:true});
 await card.getByRole('switch').click();await expect(card.getByRole('alert')).toContainText('private preview checks');await expect(card.getByRole('switch')).not.toBeChecked();network.setBrokenPreview(false);
});

