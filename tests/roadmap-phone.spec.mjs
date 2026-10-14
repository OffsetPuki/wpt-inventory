import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {testApp} from '../scripts/test-app.mjs';
let app,job,client,quote;
const routes=[...new Set(['/today',...Array.from(fs.readFileSync(new URL('../client/src/components/AppShell.tsx',import.meta.url),'utf8').matchAll(/\bto:\s*["']([^"']+)["']/g),m=>m[1])])];
test.beforeAll(async()=>{
 app=await testApp({serve:true});app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
 const call=async(url,body)=>{const r=await app.api(url,'POST',body,app.owner);expect(r.status,JSON.stringify(r.data)).toBeLessThan(300);return r.data;};
 client=await call('/api/crm/clients',{name:'Roadmap phone customer',email:'synthetic@example.test'});
 job=await call('/api/projects',{name:'Roadmap phone job',jobNumber:'PHONE-01',clientId:client.id});
 quote=await call('/api/quotes',{type:'custom',customerName:client.name,totalCents:120000,payload:{type:'custom',customer:{clientId:client.id,name:client.name}}});
 app.sqlite.prepare("UPDATE quotes SET status='sent' WHERE id=?").run(quote.id);
 app.sqlite.prepare('UPDATE projects SET quote_id=? WHERE id=?').run(quote.id,job.id);
 await call('/api/pm/tasks',{title:'Review phone checklist',projectId:job.id});
});
test.afterAll(async()=>app.close());

test('Phone deletion reviews linked history and restores customers and leads',async({page})=>{
 const customer=(await app.api('/api/crm/clients','POST',{name:'Recoverable phone customer'},app.owner)).data;
 const lead=(await app.api('/api/crm/leads','POST',{name:'Recoverable phone lead',clientId:customer.id,source:'other',site:'metals'},app.owner)).data;
 const linkedJob=(await app.api('/api/projects','POST',{name:'Preserved phone job',jobNumber:'TRASH-PHONE',clientId:customer.id},app.owner)).data;
 expect(customer.id).toBeGreaterThan(0);expect(lead.id).toBeGreaterThan(0);expect(linkedJob.id).toBeGreaterThan(0);
 for(const [kind,id,name] of [['customer',customer.id,customer.name],['lead',lead.id,lead.name]]){
  await page.goto(app.base+`/#/crm/${kind==='customer'?'clients?client=':'leads?lead='}${id}`);
  const record=page.getByRole('dialog',{name,exact:true});await expect(record).toBeVisible();
  if(kind==='lead'){await record.getByRole('tab',{name:'Details',exact:true}).click();await record.getByText('More actions',{exact:true}).click();}
  await record.getByRole('button',{name:kind==='lead'?'Delete lead':'Delete',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Move to Trash?'});
  await expect(confirm.getByText('Connected records kept with this history')).toBeVisible();
  await expect(confirm.getByText(/You can restore this record from Trash/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await confirm.getByRole('button',{name:'Move to Trash',exact:true}).click();await expect(record).toBeHidden();
  await page.goto(app.base+'/#/trash');
  const trash=page.getByRole('region',{name:kind==='customer'?'Deleted customers':'Deleted leads'});
  const row=trash.getByRole('listitem').filter({hasText:name});await row.getByRole('button',{name:'Restore',exact:true}).click();await expect(row).toBeHidden();
 }
 expect(app.sqlite.prepare('SELECT client_id,deleted_at FROM projects WHERE id=?').get(linkedJob.id)).toEqual({client_id:customer.id,deleted_at:null});
 expect(app.sqlite.prepare('SELECT client_id,deleted_at FROM crm_leads WHERE id=?').get(lead.id)).toEqual({client_id:customer.id,deleted_at:null});
});

test('Owner language switch preserves quote fields and keyboard access on a phone',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.base+'/#/crm/quotes');await page.getByRole('button',{name:'New quote',exact:true}).first().click();
 await page.getByLabel('Customer name',{exact:true}).fill('Literal customer — no translation');
 await page.getByLabel('Company (optional)',{exact:true}).fill('Original company');
 await page.getByLabel('Interface language / Idioma').selectOption('es');
 await expect(page.getByRole('heading',{name:'Nueva cotización',exact:true})).toBeVisible();
 await expect(page.getByLabel('Nombre del cliente',{exact:true})).toHaveValue('Literal customer — no translation');
 await page.getByLabel('Nombre del cliente',{exact:true}).focus();await page.keyboard.press('Tab');
 await expect(page.getByLabel('Empresa (opcional)',{exact:true})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByLabel('Interface language / Idioma').selectOption('en');
 await expect(page.getByLabel('Company (optional)',{exact:true})).toHaveValue('Original company');expect(errors).toEqual([]);
});

test('Job validation focuses the field and preserves the phone draft',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(crypto,'subtle',{value:undefined,configurable:true});Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});});
 await page.goto(app.base+`/#/project/${job.id}`);
 await page.getByRole('button',{name:'Job settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Job settings'}),address=dialog.getByLabel('Job address',{exact:true});
 await address.fill('A'.repeat(401));
 const response=page.waitForResponse(r=>r.url().endsWith(`/api/suite/jobs/${job.id}`)&&r.request().method()==='PATCH');
 await dialog.getByRole('button',{name:'Save job settings',exact:true}).click();
 const invalid=await response;expect(invalid.status()).toBe(400);expect((await invalid.json()).fields).toContain('siteAddress');
 await expect(address).toBeFocused();await expect(address).toHaveValue('A'.repeat(401));await expect(dialog).toBeVisible();
});
test('Phone cost plan keeps unknown costs and saves reviewed estimates',async({page})=>{
 await page.goto(app.base+`/#/project/${job.id}?tab=money`);
 const review=page.getByRole('region',{name:'Job profit review'});
 await expect(review.getByText('Unknown — review cost plan')).toBeVisible();
 await review.getByRole('button',{name:'Add cost plan'}).click();
 const form=page.getByRole('dialog',{name:'Job cost plan'});
 await form.getByLabel('Expected total revenue, excluding sales tax · USD').fill('1200');
 await form.getByLabel('All planned material costs · USD').fill('400');
 await form.getByLabel('All other planned costs · USD').fill('0');
 await form.getByLabel('Estimate source & assumptions').fill('Synthetic phone review; labor is still unknown.');
 await form.getByRole('button',{name:'Save cost plan'}).click();await expect(form).toBeHidden();
 await expect(review.getByText('Unknown — review cost plan')).toBeVisible();
 await review.getByRole('button',{name:'Review cost plan'}).click();
 await form.getByLabel('All planned labor costs · USD').fill('300');
 await form.getByRole('button',{name:'Save cost plan'}).click();await expect(form).toBeHidden();
 await expect(review.getByRole('heading',{name:'Expected final margin'}).locator('..')).toContainText('$500');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.reload();await expect(review.getByRole('heading',{name:'Expected final margin'}).locator('..')).toContainText('$500');
});
test.beforeEach(async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
});
for(const [width,height] of [[360,800],[390,844],[430,932],[844,390]])test(`Every navigation page fits ${width} × ${height}`,async({page})=>{
 test.setTimeout(240000);await page.setViewportSize({width,height});const errors=[],serverErrors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=500)serverErrors.push(r.url().split('?')[0]+' '+r.status());});
 for(const route of routes){
  await page.goto(app.base+'/#'+route);await expect(page.locator('#suite-main')).toBeVisible();
  await expect(page.locator('#suite-main').getByRole('heading').first(),route).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' fits').toBe(true);
 }
 expect(errors).toEqual([]);expect(serverErrors).toEqual([]);
});
test('Phone file retry attaches once, history links stay connected and help is accessible',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(crypto,'subtle',{value:undefined,configurable:true});Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});});
 test.setTimeout(120000);await page.goto(app.base+`/#/project/${job.id}?tab=files`);
 await page.getByLabel('Choose job files',{exact:true}).setInputFiles({name:'Phone drawing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic drawing')});
 let lost=false;
 await page.route('**/api/suite/jobs/*/attachments',async route=>{if(!lost){lost=true;await route.fetch();await route.abort();}else await route.continue();});
 await page.getByRole('button',{name:'Upload / retry remaining files'}).click();
 await expect(page.getByText('Connection interrupted. Reconnect and retry this file.')).toBeVisible();
 await page.evaluate(()=>{location.hash='/today';});await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await page.evaluate(id=>{location.hash=`/project/${id}?tab=files`;},job.id);
 await expect(page.getByText('Phone drawing.pdf',{exact:true}).first()).toBeVisible();
 // Retry preserves the original request's metadata even if the next-file type changes.
 await page.getByLabel('Upload file type',{exact:true}).selectOption('drawing');
 await page.getByRole('button',{name:'Upload / retry remaining files'}).click();
 await expect(page.getByText('Saved to job',{exact:true})).toBeVisible();
 expect(app.sqlite.prepare('SELECT count(*) n FROM suite_files WHERE project_id=?').get(job.id).n).toBe(1);
 await page.reload();await expect(page.getByRole('button',{name:'Download Phone drawing.pdf',exact:true})).toBeVisible();
 await page.goto(app.base+`/#/crm/clients?client=${client.id}`);
 const customer=page.getByRole('dialog',{name:client.name});await expect(customer.getByRole('heading',{name:'Customer history'})).toBeVisible();
 await customer.getByText(job.name,{exact:true}).filter({visible:true}).last().click();
 await customer.getByRole('link',{name:'Quote '+quote.number,exact:false}).click();
 await expect(page.getByRole('dialog',{name:quote.number}).getByText(/Issued quote/)).toBeVisible();
 await page.getByRole('dialog',{name:quote.number}).getByRole('button',{name:'Back to quotes'}).click();
 await page.getByRole('button',{name:'Help / Ayuda'}).click();
 const help=page.getByRole('dialog',{name:'Help with this page'});await help.getByLabel('Language / Idioma').selectOption('es');
 await expect(page.getByRole('dialog',{name:'Ayuda'}).getByRole('heading',{name:'Cotizaciones',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Help / Ayuda'})).toBeFocused();
});

test('Core phone pages reflow at 200 percent text size',async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:390,height:844});
 for(const route of ['/today','/projects','/crm/leads','/crm/clients','/finance/invoices','/finance/expenses','/pm/board','/settings',`/project/${job.id}?tab=money`]){
  await page.goto(app.base+'/#'+route);await expect(page.locator('#suite-main').getByRole('heading').first()).toBeVisible();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' enlarged text fits').toBe(true);
 }
 await page.screenshot({path:info.outputPath('job-money-phone-large-text.png'),fullPage:true});
});

test('Job designs keep their source and history on a phone',async({page})=>{
 await page.goto(app.base+`/#/project/${job.id}?tab=files`);
 await page.getByRole('button',{name:'New design',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New job design'});
 await dialog.getByLabel('Design name').fill('Phone linked plant design');
 await dialog.getByRole('button',{name:'Create design'}).click();
 await page.getByRole('link').filter({hasText:'Phone linked plant design'}).click();
 const context=page.getByRole('region',{name:'Design connections'});
 await expect(context.getByRole('link',{name:job.name})).toBeVisible();
 await page.getByRole('button',{name:'Use 2D drawing',exact:true}).click();
 await expect(page.getByRole('region',{name:'Plant layout drawing'})).toBeVisible();
 await context.getByRole('button',{name:'Review connections & revision'}).click();
 const review=page.getByRole('dialog',{name:'Review design connections'});
 await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Save review'}).click();
 await expect(context.getByText(/Layout reviewed/)).toBeVisible();
 await context.getByRole('button',{name:'Archive design',exact:true}).click();
 await expect(page.getByText(/This design is archived/)).toBeVisible();
 await context.getByRole('button',{name:'Revision history',exact:true}).click();
 await expect(context.getByText(/Archived · Revision/)).toBeVisible();
 await context.getByRole('button',{name:'Restore design',exact:true}).click();
 await expect(page.getByRole('button',{name:'Use 2D drawing',exact:true})).toBeVisible();
});

test('Useful drawings remain available without WebGL',async({page},info)=>{
 await page.setViewportSize({width:360,height:800});
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};});
 for(const [route,name] of [['film-table','Plant layout drawing'],['dallas-table','2D walnut part drawing']]){
  await page.goto(app.base+'/#/design-studio/'+route);
  await page.getByRole('button',{name:'Use 2D drawing',exact:true}).click();
  await expect(page.getByRole('region',{name,exact:true})).toBeVisible();
  await page.getByRole('region',{name,exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(route+'-drawing-phone.png')});
 }
});

test('Business and list filters follow the URL after reload and Back',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('suite-business','metals'));
 const request=page.waitForRequest(r=>r.url().includes('/api/finance/invoices?')&&new URL(r.url()).searchParams.get('site')==='insulation');
 await page.goto(app.base+'/#/finance/invoices?business=insulation&status=sent&q=Phone&page=0');await request;
 await expect(page.getByLabel('Business',{exact:true})).toHaveValue('insulation');
 const search=page.locator('#suite-main input').filter({visible:true}).first();
 await expect(search).toHaveValue('Phone');await search.fill('Changed query');
 await expect(page).toHaveURL(/q=Changed\+query/);
 await page.reload();await expect(search).toHaveValue('Changed query');
 await page.evaluate(()=>{location.hash='/today';});await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await page.goBack();await expect(search).toHaveValue('Changed query');await expect(page.getByLabel('Business',{exact:true})).toHaveValue('insulation');
});

test('Job search and time and payroll periods survive reload and Back',async({page})=>{
 await page.goto(app.base+'/#/projects?page=2');
 await page.getByPlaceholder('Search projects…').fill('Roadmap phone');
 await expect(page).toHaveURL(/q=Roadmap\+phone/);await expect(page).toHaveURL(/page=0/);
 await page.reload();await expect(page.getByPlaceholder('Search projects…')).toHaveValue('Roadmap phone');
 await page.getByRole('link',{name:new RegExp(job.name)}).first().click();await page.goBack();
 await expect(page.getByPlaceholder('Search projects…')).toHaveValue('Roadmap phone');
 await page.goto(app.base+'/#/pm/time?from=2026-10-01&to=2026-10-14&page=2');
 await page.getByLabel('From',{exact:true}).fill('2026-10-07');await expect(page).toHaveURL(/page=0/);
 await page.reload();await expect(page.getByLabel('From',{exact:true})).toHaveValue('2026-10-07');await expect(page.getByLabel('To',{exact:true})).toHaveValue('2026-10-14');
 await page.goto(app.base+'/#/hr/payroll?from=2026-10-01&to=2026-10-14');
 await page.getByLabel('From',{exact:true}).fill('2026-10-07');await page.reload();
 await expect(page.getByLabel('From',{exact:true})).toHaveValue('2026-10-07');await expect(page.getByLabel('To',{exact:true})).toHaveValue('2026-10-14');
});
