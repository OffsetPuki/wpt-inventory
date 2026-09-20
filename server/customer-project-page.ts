import type {Express} from 'express';
import rateLimit from 'express-rate-limit';
import {sqlite} from './storage';
import {quoteShop} from './quote-policy';
import {shortLink} from './share-links';
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function customerProjectUrl(token:string){
 const link=sqlite.prepare("SELECT slug FROM suite_share_links WHERE kind='q' AND token=? ORDER BY id DESC LIMIT 1").get(token) as any;
 return link?`${process.env.PUBLIC_APP_URL||'https://flipnob.com'}/customer-project/${link.slug}`:null;
}
export function registerCustomerProjectPage(app:Express){
 app.get('/customer-project/:slug',rateLimit({windowMs:60000,limit:90,standardHeaders:true,legacyHeaders:false}),(req,res)=>{
  res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'});
  const q=sqlite.prepare("SELECT q.* FROM suite_share_links s JOIN quotes q ON q.share_token=s.token WHERE s.kind='q' AND s.slug=? AND q.deleted_at IS NULL AND q.status!='draft'").get(req.params.slug) as any;
  if(!q)return res.status(404).send('This project link is unavailable.');
  const quote={...q,totalCents:q.total_cents,shareToken:q.share_token,customerName:q.customer_name};
  const shop=quoteShop(quote),site=process.env.PUBLIC_SITE_URL||'https://www.cjmmetals.com';
  const previews=sqlite.prepare('SELECT title,token FROM customer_previews WHERE quote_id=? AND published=1').all(q.id) as any[];
  const invoices=sqlite.prepare("SELECT number,status,total_cents,paid_cents,retainage_cents,share_token FROM fin_invoices WHERE quote_id=? AND deleted_at IS NULL AND status NOT IN ('draft','void') AND share_token IS NOT NULL").all(q.id) as any[];
  const job=sqlite.prepare('SELECT status FROM projects WHERE quote_id=? AND deleted_at IS NULL LIMIT 1').get(q.id) as any;
  const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
  const card=(title:string,detail:string,url:string)=>`<a class="card" href="${esc(url)}"><strong>${esc(title)}</strong><span>${esc(detail)}</span><span aria-hidden="true">Open →</span></a>`;
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your project — ${esc(shop.name)}</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font:17px/1.5 system-ui}main{max-width:760px;margin:auto;padding:32px 20px}h1{font-size:36px;letter-spacing:-1px}.card{display:grid;gap:8px;padding:24px;background:white;border-radius:16px;margin:16px 0;color:inherit;text-decoration:none}.card:focus-visible{outline:3px solid #0071e3}.card span{color:#515154}a{color:#0066cc}small{color:#515154}</style></head><body><main><p>${esc(shop.name)}</p><h1>Your project</h1><p>${esc(q.customer_name||'')} · ${esc(job?({completed:'Completed',in_progress:'Work in progress',planned:'Planning',active:'Work in progress'} as any)[job.status]||'Project in progress':q.status==='accepted'?'Quote accepted':'Review your quote')}</p>${card(q.number,'Quote · '+money(q.total_cents),shortLink('q',q.share_token,q.customer_name||q.number))}${previews.map(p=>card(p.title,'Customer design preview',shortLink('p',p.token,p.title))).join('')}${invoices.map(i=>card(i.number,i.status==='paid'?'Paid':'Balance due '+money(Math.max(0,i.total_cents-i.paid_cents-(i.retainage_cents||0))),site+'/invoice/'+i.share_token)).join('')}<small>Keep this link private. Only shared quotes, previews, and invoices appear here.</small></main></body></html>`);
 });
}
