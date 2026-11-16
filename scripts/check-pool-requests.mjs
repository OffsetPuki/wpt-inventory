import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cjm-pool-intake-'));
process.env.DATA_DIR=temp;
process.env.CJM_PRIVATE_REVIEW='1';
const {createPoolRequest,preparePoolRequest}=await import('../server/pool-requests.ts');
await import('../server/automations.ts');
const {sqlite}=await import('../server/storage.ts');
const {webDesignRowToLead}=await import('../server/public-api.ts');
const {copyDefault,quote,VERSION,MODELS,PACKAGES,FINISHES,normalize}=await import('../shared/pools/catalog.mjs');
const {buildLineState}=await import('../client/src/quote/lib/estimate.js');
const {computeTotals}=await import('../client/src/quote/lib/quote.js');
const contact={name:'Pool integration test',email:'pool-review@example.invalid',phone:'',country:'US',city:'Review only',postal:'76009',timeline:'exploring',site:'residential',access:'Test request; do not contact.'};
const body=config=>({submissionId:crypto.randomUUID(),config,contact,lang:'en',consent:true,catalogVersion:VERSION,expectedTotal:quote(config).projectTotal});
try{
 let combinations=0;
 for(const model of Object.keys(MODELS)){
  const config={...copyDefault(),model},estimate=quote(config);
  assert.deepEqual(estimate.siteLines.map(l=>l.id),['freight'],'Standard site work must not be billed again');
  assert.equal(estimate.total,MODELS[model].base);
  const saved=createPoolRequest(body(config)),row=sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(saved.quoteId),payload=JSON.parse(row.payload);
  assert.equal(row.status,'draft');assert.equal(row.share_token,null);
  assert.match(payload.notes,/Standard site work is included/);
  const totals=computeTotals(buildLineState('custom',payload.state,payload.priceBookSnapshot,payload.overrides),{...payload,minJobCharge:0});
  assert.equal(Math.round(totals.total*100),Math.round(estimate.projectTotal*100),'Draft must preserve site-inclusive starting price plus delivery');
 }
 for(const model of Object.keys(MODELS))for(const [key,options] of Object.entries({finish:FINISHES,...PACKAGES}))for(const option of Object.keys(options)){
  const config=normalize({...copyDefault(),model,[key]:option}).config;
  assert.equal(preparePoolRequest(body(config)).estimate.projectTotal,quote(config).projectTotal);combinations++;
 }
 for(const model of Object.keys(MODELS))for(const depth of [4.5,5,6])for(let burial=.5;burial<=depth;burial+=.5){
  const config=normalize({...copyDefault(),model,depth,installation:'partial',burial}).config;
  assert.equal(preparePoolRequest(body(config)).estimate.projectTotal,quote(config).projectTotal);combinations++;
 }
 for(const model of Object.keys(MODELS))for(const depth of [4.5,5,6]){
  const config=normalize({...copyDefault(),model,depth,installation:'partial',burial:2,lighting:'rgb2',heating:'heatpump',decking:'side',stairs:'turn'}).config;
  const request=body(config),saved=createPoolRequest(request),row=sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(saved.quoteId),payload=JSON.parse(row.payload);
  assert.equal(row.status,'draft');assert.equal(row.share_token,null);assert.equal(row.total_cents,Math.round(request.expectedTotal*100));
  const totals=computeTotals(buildLineState('custom',payload.state,payload.priceBookSnapshot,payload.overrides),{...payload,minJobCharge:0});
  assert.equal(Math.round(totals.total*100),row.total_cents,'Reopening a draft must preserve its website total');
  assert.equal(createPoolRequest(request).quoteId,saved.quoteId,'Retry must not duplicate');
  assert.equal(webDesignRowToLead(sqlite.prepare('SELECT * FROM web_designs WHERE ref=?').get(saved.reference)).poolQuoteId,saved.quoteId,'Find design opens the existing itemized draft');
  assert.throws(()=>createPoolRequest({...request,contact:{...contact,city:'Changed'}}),/request was changed/);
 }
 const valid=body(copyDefault());
 assert.throws(()=>createPoolRequest({...valid,expectedTotal:1}),/estimate has changed/);
 assert.throws(()=>createPoolRequest({...valid,consent:false}));
 assert.throws(()=>createPoolRequest({...valid,contact:{...contact,email:'bad'}}));
 assert.throws(()=>createPoolRequest({...valid,config:{...valid.config,burial:1.75}}));
 assert.throws(()=>createPoolRequest({...valid,config:{...valid.config,installation:'inground',stairs:'access'}}),/Review your/);
 assert.throws(()=>createPoolRequest({...valid,catalogVersion:'stale'}));
 const windowConfig=normalize({...copyDefault(),windows:[{position:'front',size:'classic'}]}).config;
 createPoolRequest(body(windowConfig));
 assert.equal(sqlite.prepare('SELECT count(*) n FROM crm_clients').get().n,1,'Customer reused by email');
 const before=sqlite.prepare('SELECT count(*) n FROM crm_leads').get().n;
 sqlite.exec("CREATE TRIGGER fail_pool_receipt BEFORE INSERT ON pool_requests BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.throws(()=>createPoolRequest(body(copyDefault())));
 assert.equal(sqlite.prepare('SELECT count(*) n FROM crm_leads').get().n,before,'Transaction rolls back orphan leads');
 console.log('Pool intake passed: '+combinations+' option/depth combinations, all model drafts, idempotency, validation, windows and rollback.');
}finally{sqlite.close();}
