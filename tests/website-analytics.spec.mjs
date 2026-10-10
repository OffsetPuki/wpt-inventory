import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
import {seedWebsiteAnalytics} from '../scripts/fixtures/website-analytics.mjs';
import fs from 'node:fs/promises';
let app;
test.beforeAll(async()=>{
  app=await testApp({serve:true});
  app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='SYNTHETIC-ONLY' WHERE role='owner'").run();
  const range=(await app.api('/api/marketing/growth/analytics','GET',undefined,app.owner)).data;
  seedWebsiteAnalytics(app.sqlite,range.current,range.previous);
});
test.afterAll(async()=>app.close());
test.beforeEach(async({page})=>{await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);});

test('All websites analytics: detailed reports, comparisons, filtering, export and mobile layout',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.base+'/#/marketing');
  await expect(page.getByRole('heading',{name:'The full picture of your websites'})).toBeVisible();
  await expect(page.getByLabel('Analytics website')).toHaveValue('all');
  const comparison=page.getByRole('region',{name:'Every website at a glance'});
  await expect(comparison.getByRole('row')).toHaveCount(5);
  await expect(page.locator('p').filter({hasText:/^Website sessions$/}).locator('..')).toContainText('800');
  await expect(page.locator('p').filter({hasText:/^Website sessions$/}).locator('..')).toContainText('+100.0%');
  await expect(page.getByRole('button',{name:'Refresh all websites'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('analytics-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:info.outputPath('analytics-desktop.png'),fullPage:true});
  await page.getByRole('navigation',{name:'Analytics reports'}).getByRole('button',{name:'Searches',exact:true}).click();
  const queries=page.getByRole('region',{name:'Google search terms',exact:true});
  await expect(queries.getByText('1–15 of 88 rows',{exact:false})).toBeVisible();
  await queries.getByRole('button',{name:'Next',exact:true}).click();
  await expect(queries.getByText('16–30 of 88 rows',{exact:false})).toBeVisible();
  await page.getByLabel('Filter Google search terms',{exact:true}).fill('custom gates el paso');
  await expect(queries.getByRole('row')).toHaveCount(5);
  const downloadPromise=page.waitForEvent('download');await queries.getByRole('button',{name:'Export CSV'}).click();
  const download=await downloadPromise,content=await fs.readFile(await download.path(),'utf8');
  expect(content).toContain('Previous clicks');expect(content.split('\r\n')).toHaveLength(5);expect(content).toContain('CJM Trades');
  await page.screenshot({path:info.outputPath('analytics-searches.png'),fullPage:true});
  await page.getByLabel('Analytics website').selectOption('concrete');
  await expect(queries.getByText('1–15 of 22 rows',{exact:false})).toBeVisible();
  await page.getByLabel('Filter Google search terms',{exact:true}).fill('custom gates el paso');
  await expect(queries.getByRole('row')).toHaveCount(2);
  await expect(queries.getByRole('cell',{name:'CJM Concrete',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel('Analytics website')).toHaveValue('concrete');
  const nav=page.getByRole('navigation',{name:'Analytics reports'});
  await nav.getByRole('button',{name:'Traffic sources',exact:true}).click();
  await expect(page.getByRole('region',{name:'AI referrals'}).getByRole('cell',{name:'ChatGPT',exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'Pages',exact:true}).click();
  await expect(page.getByRole('region',{name:'Landing pages'}).getByRole('link',{name:'/services/custom-gates'})).toHaveAttribute('href','https://www.cjm-concrete.com/services/custom-gates');
  await nav.getByRole('button',{name:'Audience',exact:true}).click();
  await expect(page.getByRole('region',{name:'Visitor locations'}).getByRole('cell',{name:'El Paso'})).toBeVisible();
  await nav.getByRole('button',{name:'Inquiries & sales',exact:true}).click();
  await expect(page.getByRole('region',{name:'Business results by website'})).toBeVisible();
  await nav.getByRole('button',{name:'Data & connections',exact:true}).click();
  await expect(page.getByRole('heading',{name:'How to read these reports'})).toBeVisible();
  await page.getByRole('button',{name:'Last 90 days',exact:true}).click();
  await nav.getByRole('button',{name:'Summary',exact:true}).click();
  await expect(page.locator('p').filter({hasText:/^Website sessions$/}).locator('..')).toContainText('—');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});

test('Refresh all continues after a provider failure, and failed loading can recover',async({page})=>{
  await page.route('**/api/marketing/growth/analytics?**',async route=>{const data=await(await route.fetch()).json();for(const site of data.sites)site.connections.googleConfigured=true;await route.fulfill({json:data});});
  const refreshed=[];
  await page.route('**/api/marketing/growth/refresh',route=>{const {site}=route.request().postDataJSON();refreshed.push(site);return route.fulfill({json:{current:{'analytics:summary':site==='metals'?'Synthetic provider failure':'updated'},previous:{'analytics:summary':'updated'}}});});
  await page.goto(app.base+'/#/marketing?tab=analytics&analyticsSite=all');
  await page.getByRole('button',{name:'Refresh all websites'}).click();
  await expect(page.getByRole('status').filter({hasText:'Refresh finished with gaps'})).toContainText('Synthetic provider failure');
  expect(refreshed).toEqual(['metals','concrete','insulation','trades']);
  await expect(page.locator('p').filter({hasText:/^Website sessions$/}).locator('..')).toContainText('800');
  await page.unroute('**/api/marketing/growth/analytics?**');
  await page.route('**/api/marketing/growth/analytics?**',route=>route.fulfill({status:503,json:{message:'Synthetic report failure'}}));
  await page.reload();await expect(page.getByRole('alert')).toContainText('Synthetic report failure');
  await page.unroute('**/api/marketing/growth/analytics?**');
  await page.reload();
  await expect(page.getByRole('region',{name:'Every website at a glance'})).toBeVisible();
});

test('Visual comparisons explain page quality, select pages and remain usable on mobile',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/marketing/growth/analytics?**',async route=>{
    const data=await(await route.fetch()).json();
    for(const site of data.sites){
      site.current.reports.landing.rows.push({landingPagePlusQueryString:'/services/engaging-page',sessions:30,engagedSessions:24,keyEvents:2});
      site.current.reports.pages.rows.push({pagePath:'/gallery/views-only',screenPageViews:650,userEngagementDuration:90});
      site.current.search.rows.push({page:'/gallery/views-only',clicks:60,impressions:700,ctr:60/700,position:4});
    }
    await route.fulfill({json:data});
  });
  await page.goto(app.base+'/#/marketing?tab=analytics&analyticsSite=metals');
  await expect(page.getByRole('region',{name:'Compare your websites'})).toContainText('CJM Metals');
  await page.getByLabel('Website comparison metric').selectOption('clicks');
  await expect(page.getByRole('region',{name:'Compare your websites'})).toContainText('64');
  await page.getByRole('button',{name:'Compare pages',exact:true}).click();
  const highlights=page.getByRole('region',{name:'Page highlights'});
  await expect(highlights).toContainText('80.0% engaged');
  await highlights.getByRole('button').filter({hasText:'Strongest engagement'}).click();
  const detail=page.getByRole('region',{name:'Selected page analysis'});
  await expect(detail.getByRole('heading',{name:'/services/engaging-page',exact:true})).toBeVisible();
  await expect(detail).toContainText('A useful page to learn from');
  await page.getByLabel('Page ranking metric').selectOption('views');
  await page.getByRole('region',{name:'Page performance explorer'}).getByRole('button',{name:'Inspect /gallery/views-only · CJM Metals',exact:true}).click();
  await expect(detail.getByRole('heading',{name:'/gallery/views-only',exact:true})).toBeVisible();
  await expect(detail).toContainText('Comparison unavailable');
  await expect(detail.getByRole('link',{name:'Open page',exact:true})).toHaveAttribute('href','https://www.cjmmetals.com/gallery/views-only');
  await page.getByLabel('Page ranking metric').selectOption('sessions');
  await page.getByLabel('Find a page to compare').fill('custom-gates');
  await expect(detail.getByRole('heading',{name:'/services/custom-gates',exact:true})).toBeVisible();
  await expect(detail).toContainText('Visible in search, few clicks');
  await expect(detail).toContainText('Help arriving visitors take the next step');
  await expect(detail).toContainText('custom gates el paso');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('page-explorer-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('Find a page to compare').fill('');
  await page.screenshot({path:info.outputPath('page-explorer-desktop.png'),fullPage:true});
  const nav=page.getByRole('navigation',{name:'Analytics reports'});
  for(const [tab,title] of [['Searches','Searches bringing visitors'],['Traffic sources','Where visits come from'],['Audience','Screens your visitors use'],['Inquiries & sales','From inquiry to recorded results']]){
    await nav.getByRole('button',{name:tab,exact:true}).click();
    await expect(page.getByRole('region',{name:title,exact:true})).toBeVisible();
  }
  await nav.getByRole('button',{name:'Pages',exact:true}).click();
  await page.getByLabel('Find a page to compare').fill('page-does-not-exist');
  await expect(detail).toContainText('No measured values');
  expect(errors).toEqual([]);
});
