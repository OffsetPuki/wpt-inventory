import assert from 'node:assert/strict';
import {testApp} from './test-app.mjs';
import {TYPES,defaultState} from '../client/src/quote/data/configurators.js';
import {QUOTE_TYPES} from '../shared/quote-schema.ts';
import {parseLead} from '../client/src/quote/lib/designSpec.js';

const {buildLineState}=await import("../client/src/quote/lib/estimate.js");
const {computeTotals}=await import("../client/src/quote/lib/quote.js");
const {DEFAULT_PRICE_BOOK}=await import("../client/src/quote/data/priceBook.js");
const app=await testApp();
try {
 const {quoteDocument}=await import('../server/public-portal.ts');
 assert(!TYPES.some(t=>t.key==='barndominium'));
 assert(!QUOTE_TYPES.includes('barndominium'));
 const state=defaultState('barndominium'),payload={type:'barndominium',state,customer:{name:'Historical fixture'},overrides:{items:{["building-cee"]:{rate:5}}}};
 payload.priceBookSnapshot=DEFAULT_PRICE_BOOK;
 const historicalCents=Math.round(computeTotals(buildLineState(payload.type,state,DEFAULT_PRICE_BOOK,payload.overrides),{...payload,minJobCharge:DEFAULT_PRICE_BOOK.minJobCharge}).total*100);
 assert.equal(parseLead({designState:JSON.stringify(payload)}),null);
 for(const method of ['GET','POST'])assert.equal((await app.api('/api/quotes/barndominium-templates',method,method==='POST'?{name:'Retired',state}:undefined,app.owner)).status,410);
 for(const type of ['barndominium','custom'])assert.equal((await app.api('/api/quotes','POST',{type,payload,totalCents:10000},app.owner)).status,400,'Old payloads cannot bypass retirement');
 assert.equal((await app.api('/api/public/estimate','POST',{type:'barndominium',state})).data.ok,false);
 const id=Number(app.sqlite.prepare('INSERT INTO quotes(number,type,payload,total_cents) VALUES(?,?,?,?)').run('Q-HISTORICAL','barndominium',JSON.stringify(payload),historicalCents).lastInsertRowid);
 const original=app.sqlite.prepare('SELECT payload,total_cents FROM quotes WHERE id=?').get(id);
 assert.equal((await app.api('/api/quotes/'+id,'GET',undefined,app.owner)).status,200);
 for(const suffix of ['/alternative','/revision','/share'])assert.equal((await app.api('/api/quotes/'+id+suffix,'POST',{version:1},app.owner)).status,410,suffix+' is retired');
 assert.equal((await app.api('/api/quotes/'+id,'PATCH',{version:1,payload},app.owner)).status,410);
 assert.deepEqual(app.sqlite.prepare('SELECT payload,total_cents FROM quotes WHERE id=?').get(id),original,'Historical records are unchanged');
 const saved=(await app.api('/api/quotes/'+id,'GET',undefined,app.owner)).data;
 assert(quoteDocument(saved),'Historical quote still renders');
 const normal=await app.api('/api/quotes','POST',{type:'custom',payload:{type:'custom',state:defaultState('custom'),customer:{name:'Normal fixture'}},totalCents:10000},app.owner);
 assert.equal(normal.status,201,'Other quote types still save');
 for(const [title,slug] of [['Retired building','barndominiums-shops'],['Barndominium concept',''],['Current gate','custom-gates']])app.sqlite.prepare("INSERT INTO mk_portfolio(title,photo_url,site,published,service_slug) VALUES(?,'/uploads/fixture.webp','metals',1,?)").run(title,slug);
 const feed=await app.api('/api/public/portfolio?site=metals');
 assert.deepEqual(feed.data.items.map(p=>p.title),['Current gate'],'Retired products are excluded before pagination');
 console.log('PASS: retired creation/import/templates/estimates/revisions blocked, records preserved, other quotes save, public portfolio filtered.');
}finally{await app.close();}
