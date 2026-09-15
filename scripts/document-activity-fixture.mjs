import crypto from 'node:crypto';
export async function documentFixture(app){
 const {api,owner,sqlite}=app;
 const q=(await api('/api/quotes','POST',{type:'custom',customerName:'Activity sample',totalCents:10000,payload:{type:'custom',customer:{name:'Activity sample'},depositPct:50}},owner)).data;
 const quoteToken=crypto.randomBytes(24).toString('hex'),invoiceToken=crypto.randomBytes(24).toString('hex');
 sqlite.prepare("UPDATE quotes SET status='sent',share_token=?,sent_at=?,view_count=7 WHERE id=?").run(quoteToken,Date.now(),q.id);
 const inv=sqlite.prepare("INSERT INTO fin_invoices(number,client_name,status,items,total_cents,subtotal_cents,share_token,sent_at,created_at) VALUES('INV-ACTIVITY','Activity sample','sent',?,10000,10000,?,?,?)").run(JSON.stringify([{description:'Sample gate',qty:1,unitPriceCents:10000}]),invoiceToken,Date.now(),Date.now());
 const invoiceId=Number(inv.lastInsertRowid);
 const quote=(await api('/api/public/quote/'+quoteToken)).data.quote;
 const invoice=(await api('/api/public/invoice/'+invoiceToken)).data.invoice;
 const docs=[{kind:'quote',id:q.id,token:quoteToken,revision:quote.activityRevision},{kind:'invoice',id:invoiceId,token:invoiceToken,revision:invoice.activityRevision}];
 const key={'X-Activity-Client-IP':'8.8.8.8','X-Lead-Key':'test-intake-key','X-Document-User-Agent':'Mozilla/5.0 (iPhone) Mobile Safari/604.1'};
 const body=d=>({visitId:crypto.randomUUID(),revision:d.revision,seq:1,activeMs:12000,scrollPct:90,loadMs:350,assetErrors:1,actionErrors:1,actions:{print:1,attachment:1,accept:d.kind==='quote'?1:0,decline:0,pay:d.kind==='invoice'?1:0,compare:0,phone:0,email:0,main:1,other:0}});
 return {docs,key,body};
}
