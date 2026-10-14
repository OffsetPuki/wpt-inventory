import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
let app,quote,job,client,lead,closedLead;
const call=async(path,method='GET',body)=>{const r=await app.api(path,method,body,app.owner);expect(r.status,JSON.stringify(r.data)).toBeLessThan(300);return r.data;};
test.beforeAll(async()=>{
  app=await testApp({serve:true});
  app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
  client=await call('/api/crm/clients','POST',{name:'Paul recovery fixture',company:'Fixture workshop',email:'fixture@example.test'});
  job=await call('/api/projects','POST',{jobNumber:'FIXTURE-JOB',name:'Job workflow fixture',clientId:client.id});
  quote=await call('/api/quotes','POST',{type:'custom',customerName:'Quote fixture',totalCents:340000,payload:{type:'custom',customer:{name:'Quote fixture',email:'quote@example.test'},depositPct:50}});
  lead=await call('/api/crm/leads','POST',{name:'Paul request fixture',email:'fixture@example.test',clientId:client.id,stage:'new',site:'metals',serviceRequested:'Gate installation'});
  closedLead=await call('/api/crm/leads','POST',{name:'Closed request fixture',stage:'lost',site:'metals'});
});
test.afterAll(async()=>app.close());
test.beforeEach(async({page})=>{
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
});
test('Manual quote acceptance records the owner and can be cancelled',async({page})=>{
  await page.goto(app.base+'/#/crm/quotes');
  await page.getByRole('button',{name:'Saved',exact:true}).click();
  const row=page.locator('.line').filter({hasText:quote.number});
  await row.getByRole('button',{name:'Mark accepted',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:`Mark ${quote.number} accepted?`});
  await dialog.getByRole('button',{name:'Cancel'}).click();
  expect(app.sqlite.prepare('SELECT status FROM quotes WHERE id=?').get(quote.id).status).toBe('draft');
  await row.getByRole('button',{name:'Mark accepted',exact:true}).click();
  await dialog.getByLabel('Acceptance note (optional)').fill('Approved by phone');
  await dialog.getByRole('button',{name:'Mark accepted',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator('.sq-status')).toHaveText('Accepted');
  await expect(row.getByRole('button',{name:'Mark accepted',exact:true})).toHaveCount(0);
  await row.getByRole('button',{name:'Customer activity'}).click();
  await expect(page.getByText('Manually accepted by Owner')).toBeVisible();
  await page.screenshot({path:'test-results/manual-acceptance-mobile.png',fullPage:true});
});
test('Job settings save without a quote, explain missing requirements, and upload documents',async({page})=>{
  test.setTimeout(90000);
  await page.goto(app.base+`/#/project/${job.id}`);
  await page.getByRole('button',{name:'Job settings',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Job settings'});
  await expect(dialog.getByText(client.name,{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Link accepted quote')).toHaveValue('');
  await expect(dialog.getByText('Accepted quote ID (optional)')).toHaveCount(0);
  await dialog.getByLabel('Job address',{exact:true}).fill('Fixture workshop address');
  await dialog.getByRole('combobox',{name:/^Schedule/}).selectOption('confirmed');
  await dialog.getByRole('button',{name:'Save job settings'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Set the work dates');
  await expect(dialog.getByRole('alert')).toContainText('Assign the crew');
  await page.screenshot({path:'test-results/job-settings-mobile.png',fullPage:true});
  await dialog.getByRole('button',{name:'Save as tentative'}).click();
  await expect(dialog).toHaveCount(0);
  expect(app.sqlite.prepare('SELECT quote_id,site_address,schedule_state FROM projects WHERE id=?').get(job.id)).toEqual({quote_id:null,site_address:'Fixture workshop address',schedule_state:'tentative'});
  await page.goto(app.base+`/#/project/${job.id}?tab=files`);
  await page.getByLabel('Upload job file').setInputFiles({name:'Floor plan.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFixture plan\n%%EOF')});
  await expect(page.getByLabel('File title',{exact:true})).toHaveValue('Floor plan.pdf');
  await page.getByRole('button',{name:'Save to job',exact:true}).click();
  const download=page.getByRole('button',{name:'Download Floor plan.pdf',exact:true});
  await expect(download).toBeVisible();
  await expect(page.locator('img[src$=".pdf"]')).toHaveCount(0);
  const pending=page.waitForEvent('download');await download.click();
  expect((await pending).suggestedFilename()).toBe('Floor plan.pdf');
  await page.screenshot({path:'test-results/job-files-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('Delete and restore a job from list and detail; restore a customer and lead',async({page})=>{
  test.setTimeout(90000);
  await page.goto(app.base+'/#/projects');
  await page.getByRole('button',{name:'Delete job FIXTURE-JOB',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Delete job FIXTURE-JOB?'});
  await dialog.getByRole('button',{name:'Cancel'}).click();
  await page.getByRole('button',{name:'Delete job FIXTURE-JOB',exact:true}).click();
  await dialog.getByRole('button',{name:'Move to Trash'}).click();
  await expect(page.getByRole('button',{name:'Delete job FIXTURE-JOB',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'View Trash',exact:true}).click();
  await page.locator('li').filter({hasText:'Job workflow fixture'}).getByRole('button',{name:'Restore',exact:true}).click();
  await expect(page.locator('li').filter({hasText:'Job workflow fixture'})).toHaveCount(0);
  await page.goto(app.base+`/#/project/${job.id}`);
  await page.getByRole('button',{name:'Delete job FIXTURE-JOB',exact:true}).click();
  await dialog.getByRole('button',{name:'Move to Trash'}).click();
  await expect(page).toHaveURL(/#\/projects/);
  await call(`/api/crm/clients/${client.id}`,'DELETE');
  await call(`/api/crm/leads/${lead.id}`,'DELETE');
  await page.goto(app.base+'/#/trash');
  await page.getByRole('region',{name:'Deleted customers'}).getByRole('button',{name:'Restore',exact:true}).click();
  await page.getByRole('region',{name:'Deleted leads'}).getByRole('button',{name:'Restore',exact:true}).click();
  expect((await call(`/api/crm/leads/${lead.id}`)).clientId).toBe(client.id);
});
test('Lead filters refresh immediately and both layouts fit phones and desktops',async({page})=>{
  await page.goto(app.base+'/#/crm/leads');
  await expect(page.locator('[aria-label="Lead list"]')).toBeVisible();
  await page.getByRole('combobox',{name:/^Lead stage/}).selectOption('lost');
  await expect(page.locator('[aria-label="Lead list"]')).toContainText('Closed request fixture');
  await expect(page.locator('[aria-label="Lead list"]')).not.toContainText('Paul request fixture');
  await page.getByRole('combobox',{name:/^Lead stage/}).selectOption('new');
  await expect(page.locator('[aria-label="Lead list"]')).toContainText('Paul request fixture');
  await expect(page.locator('[aria-label="Lead list"]')).not.toContainText('Closed request fixture');
  await page.getByRole('button',{name:'Clear filters'}).click();
  for(const width of [390,1440]){
    await page.setViewportSize({width,height:900});
    for(const layout of ['List','Board']){
      await page.getByRole('button',{name:layout,exact:true}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:`test-results/leads-${layout.toLowerCase()}-${width}.png`,fullPage:true});
    }
  }
});
