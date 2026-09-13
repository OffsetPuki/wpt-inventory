import {testApp} from './test-app.mjs';
import {chromium} from '@playwright/test';
import path from 'node:path';
const app=await testApp({serve:true});
let browser;
try{
 app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='SYNTHETIC-ONLY' WHERE role='owner'").run();
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.goto(app.base+'/#/marketing');
 const section=page.getByRole('region',{name:'AI referral results'});
 await section.screenshot({path:path.resolve('../_audit/2026-09-12-search-ai/ai-report.png')});
 console.log('Captured local AI-report preview with isolated test data.');
}finally{await browser?.close();await app.close();}
