import type {Express} from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import {eq} from 'drizzle-orm';
import {sqlite,db} from './storage';
import {quotes} from '../shared/quote-schema';
import {leads} from '../shared/crm-schema';
import {requireAuth} from './auth';
import {audit} from './audit';
import {quoteDocument} from './public-portal';
import {communicationContext,localizedLink} from './communication';
import {sendMail,mailEnabled} from './mailer';
import {onQuoteEvent,logEmailActivity} from './crm';
import {buildLineState} from '../client/src/quote/lib/estimate.js';
import {computeTotals} from '../client/src/quote/lib/quote.js';
import {deepMerge} from '../client/src/quote/lib/store.js';
import {DEFAULT_PRICE_BOOK} from '../client/src/quote/data/priceBook.js';
import {compareBarndo,scopeIssues,customerBarndoSpecs} from '../client/src/quote/lib/barndoQuote.js';
import {renderDrawing} from '../client/src/quote/lib/barndominium/drawing.js';
import {normalize,validate,esc} from '../client/src/quote/lib/barndominium/model.js';

const suiteURL=()=>process.env.PUBLIC_APP_URL||'https://flipnob.com';
const websiteURL=()=>process.env.PUBLIC_SITE_URL||'https://www.cjmmetals.com';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const drawing=(state:any,lang='en')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 540" role="img" aria-label="${lang==='es'?'Diseño del edificio':'Building design'}">${renderDrawing(state,{lang})}</svg>`;
function rowsFor(setId:number){return sqlite.prepare('SELECT m.*,q.status FROM quote_option_members m JOIN quotes q ON q.id=m.quote_id WHERE m.set_id=? ORDER BY m.position').all(setId) as any[];}
export function quoteOptionLink(id:number){
 const row=sqlite.prepare('SELECT m.*,s.token,s.recommended_id FROM quote_option_members m JOIN quote_option_sets s ON s.id=m.set_id WHERE m.quote_id=?').get(id) as any;
 return row?{url:`${suiteURL()}/quote-options/${row.token}`,position:row.position,title:row.title,recommended:row.recommended_id===id,explanation:row.explanation}:null;
}
function loadQuote(id:number){const q=db.select().from(quotes).where(eq(quotes.id,id)).get();if(!q||q.deletedAt||q.type!=='barndominium')throw new Error('Choose two available barndominium quotes.');return q;}
function comparison(input:any){
 if(!Array.isArray(input.options)||input.options.length!==2)throw new Error('Choose exactly two quotes.');
 const ids=input.options.map((o:any)=>o.id);
 if(ids.some((id:any)=>!Number.isSafeInteger(id))||ids[0]===ids[1])throw new Error('Choose two different quotes.');
 if(!ids.includes(input.recommendedId))throw new Error('Choose your recommended option.');
 const found=ids.map(loadQuote),sessions=found.map((q:any)=>JSON.parse(q.payload));
 const [a,b]=sessions.map((s:any)=>s.customer||{});
 const same=(x:any,y:any)=>String(x||'').trim().toLowerCase()===String(y||'').trim().toLowerCase();
 if(!a.name?.trim()||!b.name?.trim()||!same(a.name,b.name)||!same(a.location,b.location)||
    (a.clientId&&b.clientId?a.clientId!==b.clientId:!a.email||!b.email||!same(a.email,b.email))||!same(a.email,b.email))
   throw new Error('Both options must have the same customer and project address. Use the same customer record or matching name and email.');
 if(found[0].leadId&&found[1].leadId&&found[0].leadId!==found[1].leadId)throw new Error('These quotes belong to different jobs.');
 const issues:string[]=[];
 const options=found.map((quote:any,i:number)=>{
  if(!['draft','sent'].includes(quote.status))throw new Error(`${quote.number} is no longer available. Choose an active quote.`);
  if(input.options[i].version!==quote.version)throw new Error(`${quote.number} changed. Refresh the comparison before sending.`);
  if(sqlite.prepare('SELECT 1 FROM quote_option_members WHERE quote_id=?').get(quote.id))throw new Error(`${quote.number} already belongs to a sent option set. Open its existing options link.`);
  const s=sessions[i],state=normalize(s.state);if(validate(state).length)throw new Error('Review the building design before sending.');
  const title=String(input.options[i].title||'').trim().slice(0,100),explanation=String(input.options[i].explanation||'').trim().slice(0,600);
  if(!title||!explanation)throw new Error('Name each option and explain the material or scope differences.');
  const book=deepMerge(DEFAULT_PRICE_BOOK,s.priceBookSnapshot||JSON.parse((sqlite.prepare('SELECT price_book FROM quote_settings WHERE id=1').get() as any)?.price_book||'{}'));
  const lines:any=buildLineState('barndominium',state,book,s.overrides),totals:any=computeTotals(lines,{...s,minJobCharge:book.minJobCharge});
  for(const issue of scopeIssues(s,totals))issues.push(`Option ${i+1}: ${issue}`);
  const missing=lines.items.filter((it:any)=>it.unpriced||!(Number(it.rate)>0));
  if(missing.length)issues.push(`Option ${i+1}: price or explicitly remove ${missing.length} unpriced lines.`);
  const doc=quoteDocument(quote);
  if(!doc||quote.totalCents<=0)issues.push(`Option ${i+1}: save and review the current quote price.`);
  return {id:quote.id,version:quote.version,number:quote.number,position:i+1,title,explanation,totalCents:quote.totalCents,recommended:quote.id===input.recommendedId,status:quote.status,svg:drawing(state),specs:doc?.specs||[],url:quote.shareToken?localizedLink(`${websiteURL()}/quote/${quote.shareToken}`,communicationContext({quoteNumber:quote.number}).lang):null};
 });
 return {found,sessions,public:{options,issues,differences:compareBarndo(sessions[0],sessions[1]),deltaCents:found[1].totalCents-found[0].totalCents,customerName:a.name,email:a.email||'',lang:['en','es'].includes(a.preferredLanguage)?a.preferredLanguage:communicationContext({quoteNumber:found[0].number}).lang}};
}
function publicSet(set:any){
 const members=rowsFor(set.id),found=members.map(m=>loadQuote(m.quote_id)),sessions=found.map(q=>JSON.parse(q.payload));
 return {options:members.map((m,i)=>{const q=found[i],s=sessions[i],lang=set.language;return {number:q.number,position:m.position,title:m.title,explanation:m.explanation,totalCents:q.totalCents,recommended:set.recommended_id===q.id,status:q.status,svg:drawing(normalize(s.state),lang),specs:quoteDocument(q)?.specs||customerBarndoSpecs(s.overrides,lang),url:localizedLink(`${websiteURL()}/quote/${q.shareToken}`,lang)};}),differences:compareBarndo(sessions[0],sessions[1],set.language),deltaCents:found[1].totalCents-found[0].totalCents,lang:set.language};
}
function html(data:any){
 const es=data.lang==='es',title=es?'Opciones para su proyecto':'Options for your project';
 return `<!doctype html><html lang="${es?'es':'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${title} — CJM Metals</title><style>body{margin:0;background:#f5f2eb;color:#151515;font:17px/1.5 system-ui}main{max-width:1200px;margin:auto;padding:24px}h1{font-size:32px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{background:white;border:1px solid #bbb;padding:22px;overflow-wrap:anywhere}article.recommended{border:3px solid #254447}svg{width:100%;height:auto}.badge{font-weight:bold;color:#254447}.button{display:inline-block;background:#172e31;color:white;padding:14px;text-decoration:none}.price{font-size:26px;font-weight:bold}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #ccc;padding:10px;vertical-align:top;overflow-wrap:anywhere}tr.changed{background:#e7eeea}a{color:#254447}.muted{color:#555}@media(max-width:700px){.cards{grid-template-columns:1fr}main{padding:16px}td,th{padding:6px;font-size:14px}}@media print{.button{display:none}article{break-inside:avoid}}</style></head><body><main><p>CJM Metals</p><h1>${title}</h1><p>${es?'Compare las dos opciones. Los precios son alternativas y no se suman. Abra la cotización completa para revisar el alcance y aceptar una sola opción.':'Compare both options. These are alternative prices, not amounts to add together. Open the full quote to review its scope and accept one option.'}</p><div class="cards">${data.options.map((o:any)=>`<article class="${o.recommended?'recommended':''}"><p class="badge">${es?'Opción':'Option'} ${o.position}${o.recommended?(es?' · Recomendada':' · Recommended'):''}</p><h2>${esc(o.title)}</h2><p>${esc(o.explanation)}</p>${o.svg}<p class="price">${money(o.totalCents)}</p><p>${esc(o.number)} · ${esc(({sent:es?'Disponible':'Available',accepted:es?'Aceptada':'Accepted',declined:es?'Cerrada':'Closed'} as any)[o.status]||o.status)}</p><a class="button" href="${esc(o.url)}">${es?'Ver cotización completa':'View full quote'} — ${es?'Opción':'Option'} ${o.position}</a><details><summary>${es?'Dimensiones, materiales y alcance':'Dimensions, materials and scope'}</summary>${o.specs.map((sp:any)=>`<p><strong>${esc(sp.label)}:</strong> ${esc(sp.value)}</p>`).join('')}</details></article>`).join('')}</div><h2>${es?'Diferencias entre opciones':'Differences between options'}</h2><p>${es?'Diferencia de precio (opción 2 menos opción 1)':'Price difference (Option 2 minus Option 1)'}: <strong>${money(data.deltaCents)}</strong></p><table><thead><tr><th>${es?'Detalle':'Detail'}</th><th>${es?'Opción':'Option'} 1</th><th>${es?'Opción':'Option'} 2</th></tr></thead><tbody>${data.differences.filter((r:any)=>r.changed).map((r:any)=>`<tr class="changed"><th>${esc(r.label)}</th><td>${esc(r.a)}</td><td>${esc(r.b)}</td></tr>`).join('')||`<tr><td colspan="3">${es?'Revise las descripciones y las cotizaciones completas para las diferencias de precio.':'Review the option descriptions and full quotes for pricing differences.'}</td></tr>`}</tbody></table><p class="muted">${es?'La vista es conceptual. Las secciones y espesores propuestos deben cumplir los planos aprobados y los requisitos del proyecto.':'The view is conceptual. Proposed sections and thicknesses must meet the approved plans and project requirements.'}</p></main></body></html>`;
}

export function registerQuoteOptionRoutes(app:Express){
 app.post('/api/quote-options/preview',requireAuth,(req,res)=>{try{res.json(comparison(req.body).public);}catch(e:any){res.status(400).json({message:e.message});}});
 app.get('/api/quotes/:id/options',requireAuth,(req,res)=>res.json(quoteOptionLink(Number(req.params.id))));
 app.post('/api/quote-options/share',requireAuth,async(req,res)=>{
  try{
   const key=String(req.body.requestKey||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw new Error('A send request key is required.');
   const requestKey=`${req.user!.userId}:${key}`;
   let first=false;
   const set=sqlite.transaction(()=>{
    const existing=sqlite.prepare('SELECT * FROM quote_option_sets WHERE request_key=?').get(requestKey) as any;
    if(existing){const actual=rowsFor(existing.id).map(m=>m.quote_id);if(JSON.stringify(actual)!==JSON.stringify(req.body.options?.map((o:any)=>o.id)))throw new Error('This send request belongs to other quotes. Refresh before sending.');return existing;}
    if(req.body.materialReviewed!==true)throw new Error('Review the proposed material specifications and differences before sending.');
    const result=comparison(req.body);if(result.public.issues.length)throw new Error(result.public.issues.join(' '));
    if(req.body.sendEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.public.email))throw new Error('Add a valid matching customer email to both quotes.');
    const now=Date.now(),row=sqlite.prepare('INSERT INTO quote_option_sets(token,request_key,recommended_id,created_at,language) VALUES(?,?,?,?,?) RETURNING *').get(crypto.randomBytes(24).toString('hex'),requestKey,req.body.recommendedId,now,result.public.lang) as any;
    let leadId=result.found.find((q:any)=>q.leadId)?.leadId;
    if(leadId&&!sqlite.prepare('SELECT 1 FROM crm_leads WHERE id=? AND deleted_at IS NULL').get(leadId))throw new Error('Restore the linked job before sending options.');
    if(!leadId){const customer=result.sessions[0].customer;leadId=db.insert(leads).values({name:customer.name,email:customer.email||null,phone:customer.phone||null,clientId:customer.clientId||null,preferredLanguage:result.public.lang,site:'metals',source:'other',stage:'quote_sent',serviceRequested:'Barndominium',estimatedValueCents:result.found.find((q:any)=>q.id===req.body.recommendedId)!.totalCents,notes:`Alternative quotes ${result.found.map((q:any)=>q.number).join(' / ')}`}).returning().get().id;}
    result.found.forEach((q:any,i:number)=>{const o=result.public.options[i];sqlite.prepare('INSERT INTO quote_option_members(quote_id,set_id,position,title,explanation) VALUES(?,?,?,?,?)').run(q.id,row.id,i+1,o.title,o.explanation);db.update(quotes).set({leadId,status:'sent',shareToken:q.shareToken||crypto.randomBytes(24).toString('hex'),sentAt:q.sentAt||now}).where(eq(quotes.id,q.id)).run();});first=true;return row;
   })();
   const members=rowsFor(set.id),firstQuote=loadQuote(members[0].quote_id),customer=JSON.parse(firstQuote.payload).customer||{},lang=set.language,es=lang==='es';
   const url=`${suiteURL()}/quote-options/${set.token}`;
   if(first){onQuoteEvent('sent',{quoteNumber:firstQuote.number,name:firstQuote.customerName,email:customer.email,phone:customer.phone,designRef:firstQuote.designRef});audit(req,'quote.options_share',{targetType:'quote',targetId:firstQuote.id,targetName:firstQuote.number,details:{setId:set.id,quoteIds:members.map(m=>m.quote_id),materialReviewed:true}});}
   let emailed=false;
   if(req.body.sendEmail&&mailEnabled()){
    const data=publicSet(set),subject=es?'CJM Metals — Opción 1 y Opción 2':'CJM Metals — Option 1 and Option 2';
    const text=`${es?'Compare las dos cotizaciones y elija una opción. Los importes no se suman.':'Compare both quotes and choose one option. The amounts are not added together.'}\n\n${data.options.map(o=>`${es?'Opción':'Option'} ${o.position}: ${o.title}${o.recommended?(es?' (Recomendada)':' (Recommended)'):''}\n${o.number}: ${money(o.totalCents)}\n${o.explanation}`).join('\n\n')}\n\n${url}`;
    emailed=await sendMail({to:customer.email,subject,text},{deliveryKey:`quote-options:${set.id}`});
    if(emailed&&first)logEmailActivity({email:customer.email,subject});
   }
   res.json({url,emailed,quoteIds:members.map(m=>m.quote_id)});
  }catch(e:any){res.status(400).json({message:e.message});}
 });
 app.get('/quote-options/:token',rateLimit({windowMs:60000,limit:90,standardHeaders:true,legacyHeaders:false}),(req,res)=>{
  res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'});
  if(!/^[a-f0-9]{48}$/.test(String(req.params.token)))return res.status(404).send('Options not found');
  const set=sqlite.prepare('SELECT * FROM quote_option_sets WHERE token=?').get(req.params.token) as any;
  if(!set)return res.status(404).send('Options not found');
  try{res.type('html').send(html(publicSet(set)));}catch{res.status(404).send('Options unavailable');}
 });
}
