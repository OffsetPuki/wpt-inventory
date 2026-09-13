import assert from 'node:assert/strict';
import { testApp } from './test-app.mjs';
const t = await testApp();
const {api,owner,sqlite}=t;
try {
 const {normalizeQuoteTerms,isQuoteExpired,preserveLegacyQuoteTerms}=await import('../server/quote-policy.ts');
 for (const old of ['Quote valid for 10 days.','Quote valid for 1 month.','Quote valid for 30 days.','Cotización válida por 10 días.']) {
   const terms=normalizeQuoteTerms(old+'\nWarranty: 12 months. Delivery: 10 days.');
   assert.equal(terms[0],'Quote valid for 5 days from the issue date and time shown.');
   assert.deepEqual(terms.slice(1),['Warranty: 12 months. Delivery: 10 days.']);
 }
 sqlite.prepare('INSERT INTO quote_settings(id,shop) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET shop=excluded.shop').run(JSON.stringify({name:'Policy test',terms:'Quote valid for 10 days.\nScope to be confirmed.'}));
 const make=async()=>{
   const r=await api('/api/quotes','POST',{type:'custom',customerName:'Policy test',totalCents:10000,payload:{type:'custom',customer:{name:'Policy test',email:'policy@example.test'},depositPct:50}},owner);
   assert.equal(r.status,201,JSON.stringify(r.data));return r.data;
 };
 const legacy=await make();
 sqlite.prepare("UPDATE quotes SET status='sent',share_token=?,sent_at=? WHERE id=?").run('a'.repeat(48),Date.now()-86400000,legacy.id);
 preserveLegacyQuoteTerms();
 const frozen=sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(legacy.id).payload;
 preserveLegacyQuoteTerms();assert.equal(sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(legacy.id).payload,frozen);
 for (const invalid of ['null','[]','{broken']) {
   const bad=await make();
   sqlite.prepare("UPDATE quotes SET status='sent',payload=? WHERE id=?").run(invalid,bad.id);
   preserveLegacyQuoteTerms();
   assert.equal(sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(bad.id).payload,invalid,'Malformed history must remain untouched');
 }
 const q=await make();
 const shared=await api(`/api/quotes/${q.id}/share`,'POST',{version:q.version},owner);
 assert.equal(shared.status,200);
 const read=async()=> (await api(`/api/public/quote/${shared.data.token}`)).data.quote;
 const doc=await read();
 assert.equal(doc.expiresAt-doc.issuedAt,5*86400000);
 assert.ok(doc.shop.terms[0].startsWith('Quote valid for 5 days'));
 assert.ok(!doc.shop.terms.join(' ').includes('10 days'));
 sqlite.prepare('UPDATE quote_settings SET shop=? WHERE id=1').run(JSON.stringify({name:'Changed shop',terms:'Quote valid for 1 month.'}));
 await api(`/api/quotes/${q.id}/share`,'POST',{},owner);
 assert.deepEqual(await read(),doc,'Re-sharing/settings edits preserve issued content and deadline');
 const old=(await api('/api/public/quote/'+'a'.repeat(48))).data.quote;
 assert.equal(old.shop.terms[0],'Quote valid for 10 days.');assert.equal(old.expiresAt,null);
 const row=sqlite.prepare('SELECT * FROM quotes WHERE id=?').get(q.id);
 assert.equal(isQuoteExpired(row,doc.expiresAt-1),false);
 assert.equal(isQuoteExpired(row,doc.expiresAt),true);
 assert.equal(isQuoteExpired({...row,status:'accepted'},doc.expiresAt+1),false);
 const payload=JSON.parse(row.payload);payload.quotePolicy.issuedAt=Date.now()-6*86400000;payload.quotePolicy.expiresAt=Date.now()-86400000;
 sqlite.prepare('UPDATE quotes SET payload=? WHERE id=?').run(JSON.stringify(payload),q.id);
 assert.equal((await read()).expired,true);
 assert.equal((await api(`/api/public/quote/${shared.data.token}/accept`,'POST',{})).status,409);
 assert.equal((await api(`/api/quotes/${q.id}/accept`,'POST',{},owner)).status,409);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM fin_invoices WHERE quote_id=?').get(q.id).n,0);
 const revision=await api(`/api/quotes/${q.id}/revision`,'POST',{},owner);assert.equal(revision.status,201);
 const revisedShare=await api(`/api/quotes/${revision.data.id}/share`,'POST',{},owner);assert.equal(revisedShare.status,200);
 const revised=(await api(`/api/public/quote/${revisedShare.data.token}`)).data.quote;
 assert.equal(revised.expiresAt-revised.issuedAt,5*86400000);assert.ok(revised.expiresAt>doc.expiresAt-10000);
 const accepted=await api(`/api/public/quote/${revisedShare.data.token}/accept`,'POST',{});assert.equal(accepted.status,200);
 assert.equal((await api(`/api/public/quote/${revisedShare.data.token}/accept`,'POST',{})).status,200);
 console.log('PASS: five-day issue/deadline, normalization, immutable terms, expiry boundary, legacy preservation, revision and acceptance retry');
} finally {await t.close();}
