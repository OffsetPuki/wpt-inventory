import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4451/#/marketing');
  await page.getByRole('region',{name:'Search connections and visibility'}).waitFor();
  const panel=page.getByRole('region',{name:'Search connections and visibility'});
  for(const [site,domain] of [['metals','www.cjmmetals.com'],['concrete','www.cjm-concrete.com'],['insulation','www.cjminsulation.com'],['trades','www.cjmtrades.com']]){
    await page.getByLabel(/^Website/).selectOption(site);
    await page.getByRole('link',{name:'Open Bing',exact:false}).filter({hasText:'Open Bing'}).waitFor();
    await page.waitForFunction(domain=>document.querySelector(`a[href*="bing.com/webmasters/searchperf"][href*="${domain}"]`),domain);
    assert.equal(await panel.getByText('Connected',{exact:true}).count(),1);
    assert.ok((await panel.innerText()).includes('Waiting for Bing activity data'));
    const details=panel.locator('details').filter({has:page.locator('summary',{hasText:'Indexing, sitemaps and search tools'})});
    if((await details.getAttribute('open'))===null)await details.locator('summary').click();
    await panel.getByText('Success · last crawled',{exact:false}).waitFor();
    assert.ok((await panel.innerText()).includes(domain+'/sitemap.xml'));
  }
  await page.getByLabel(/^Website/).selectOption('metals');
  await page.waitForFunction(()=>document.querySelector('a[href*="bing.com/webmasters/searchperf"][href*="www.cjmmetals.com"]'));
  await panel.screenshot({path:path.resolve('../_audit/2026-09-12-search-ai/suite-marketing-connected.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await panel.screenshot({path:path.resolve('../_audit/2026-09-12-search-ai/suite-marketing-connected-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('Live local preview checked: four connected Bing sites, correct sitemap links and successful reports, mobile layout, no client errors.');
}finally{await browser.close();}
