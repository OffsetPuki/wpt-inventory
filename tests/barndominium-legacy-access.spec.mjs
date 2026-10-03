import {test,expect} from '@playwright/test';
import {testApp} from '../scripts/test-app.mjs';
import {fresh,validate} from '../client/src/quote/lib/barndominium/model.js';
test('Older doorway conflicts keep their dimensions and show a repair warning',async({page})=>{
 const app=await testApp({serve:true});
 try {
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const login=await app.api('/api/security/password','POST',{currentPassword:'1234',password:'Legacy geometry fixture 2026'},app.owner);
  expect(login.status).toBe(200);
  const state=fresh();state.depth=64;state.porches=[{id:'old-porch',wall:'front',x:0,width:16,depth:8,height:11,pitch:2}];
  expect(validate(state).some(e=>e.code==='porch-access')).toBe(true);
  expect((await app.api('/api/public/leads','POST',{site:'metals',name:'Older design fixture',email:'legacy@example.test',designRef:'CJM-BLEGACY',designSource:'configurator-barndominium',designState:JSON.stringify({type:'barndominium',state})},undefined,{'X-Lead-Key':'test-intake-key'})).status).toBe(201);
  await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),login.data.token);
  await page.goto(app.base+'/#/crm/quotes');
  await page.getByRole('button',{name:'Find design',exact:true}).click();
  await page.getByRole('button',{name:/Start barndominium quote from this design/}).click();
  const editor=page.locator('.barndo');
  await expect(editor.locator('[data-key="depth"]')).toHaveValue('64');
  await expect(editor).toContainText('would obstruct a doorway');
  await expect(editor).not.toContainText('Showing the starter layout');
 }finally{await page.close();await app.close();}
});
