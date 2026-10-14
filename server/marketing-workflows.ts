import {safeGooglePage} from './google-reporting';
import {businessDay} from './business-clock';
import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {marketingManager,versionConflict,marketingPreference,resolveReviewSite,syncReviewTask} from './marketing-core';
import {inventoryOnce} from './inventory-core';
import {audit} from './audit';
import {GOOGLE_SITES} from './lead-measurement';
const site=z.enum(['metals','concrete','insulation','trades']);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=businessDay(),'Choose a valid date, not in the future.');
const spend=z.object({site,date,channel:z.enum(['google','meta','microsoft','other']),campaign:z.string().trim().max(100).default(''),amountCents:z.number().int().min(0).max(100000000),notes:z.string().max(1000).default('')});
const opportunityInput=z.object({site,path:z.string().min(1).max(180),hypothesis:z.string().trim().max(1500).optional(),campaign:z.string().trim().max(120).default(''),period:z.object({start:date,end:date}).refine(p=>p.start<=p.end).optional(),evidence:z.object({sessions:z.number().nonnegative().nullable(),clicks:z.number().nonnegative().nullable(),impressions:z.number().nonnegative().nullable(),engagement:z.number().min(0).max(1).nullable(),leads:z.number().int().nonnegative().nullable().optional(),qualified:z.number().int().nonnegative().nullable().optional(),won:z.number().int().nonnegative().nullable().optional()}).optional()});
export function registerMarketingWorkflows(app:Express){
 sqlite.exec('CREATE TABLE IF NOT EXISTS mk_page_improvements(task_id INTEGER PRIMARY KEY,site TEXT NOT NULL,path TEXT NOT NULL,hypothesis TEXT NOT NULL,period TEXT,evidence TEXT,created_at INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS mk_page_improvements_page ON mk_page_improvements(site,path,created_at);');
 const columns=new Set((sqlite.prepare('PRAGMA table_info(mk_page_improvements)').all() as any[]).map(c=>c.name));
 for(const [name,type] of [['campaign',"TEXT NOT NULL DEFAULT ''"],['change_date','TEXT'],['change_note','TEXT'],['version','INTEGER NOT NULL DEFAULT 1']])if(!columns.has(name))sqlite.exec(`ALTER TABLE mk_page_improvements ADD COLUMN ${name} ${type}`);
 app.get('/api/marketing/opportunities',requireElevated,(req,res)=>{
  const s=site.safeParse(req.query.site),path=String(req.query.path||'');if(!s.success||safeGooglePage(path)!==path||!path.startsWith('/'))return res.status(400).json({message:'Choose a public website page.'});
  const key='marketing:search:'+s.data+':'+path;
  res.json(sqlite.prepare('SELECT t.id,t.title,t.status,t.due_date,t.completed_at,i.hypothesis,i.period,i.evidence,i.created_at,i.campaign,i.change_date,i.change_note,i.version FROM pm_tasks t LEFT JOIN mk_page_improvements i ON i.task_id=t.id WHERE t.auto_key=? AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 25').all(key));
 });
 app.post('/api/marketing/opportunities',requireElevated,marketingManager,(req,res)=>{
  const b=opportunityInput.safeParse(req.body);if(!b.success||safeGooglePage(b.data.path)!==b.data.path||!b.data.path.startsWith('/')||['/private','/other'].includes(b.data.path))return res.status(400).json({message:'Choose a public page and a valid reporting period.'});
  const row=sqlite.transaction(()=>{
   const key='marketing:search:'+b.data.site+':'+b.data.path;
   const existing=sqlite.prepare("SELECT id FROM pm_tasks WHERE auto_key=? AND deleted_at IS NULL AND status!='done' ORDER BY id DESC LIMIT 1").get(key) as any;
   if(existing)return {...existing,existing:true};
   const hypothesis=b.data.hypothesis||'Review search intent, title, useful project evidence and internal links.';
   const description=hypothesis+'\n\nWebsite: https://'+GOOGLE_SITES[b.data.site].domain+b.data.path+'\nAfter making a change, record the change date and compare an equal reporting period. A change in results alone does not prove causation.';
   const id=Number(sqlite.prepare("INSERT INTO pm_tasks(title,kind,status,auto_created,auto_key,description) VALUES(?,'other','todo',0,?,?)").run('Improve CJM '+b.data.site+' page: '+b.data.path,key,description).lastInsertRowid);
   sqlite.prepare('INSERT INTO mk_page_improvements(task_id,site,path,hypothesis,period,evidence,created_at,campaign) VALUES(?,?,?,?,?,?,?,?)').run(id,b.data.site,b.data.path,hypothesis,b.data.period?JSON.stringify(b.data.period):null,b.data.evidence?JSON.stringify(b.data.evidence):null,Date.now(),b.data.campaign);
   audit(req,'marketing.opportunity_task',{targetId:id,details:{site:b.data.site,path:b.data.path}});
   return {id,existing:false};
  })();res.json(row);
 });
 app.post('/api/marketing/opportunities/:id/change',requireElevated,marketingManager,(req,res)=>{
  const b=z.object({version:z.number().int().positive(),date,note:z.string().trim().min(1).max(1500)}).safeParse(req.body);
  if(!b.success)return res.status(400).json({message:'Enter the actual change date, a short description and the current saved version.'});
  const before=sqlite.prepare('SELECT i.* FROM mk_page_improvements i JOIN pm_tasks t ON t.id=i.task_id WHERE i.task_id=? AND t.deleted_at IS NULL').get(Number(req.params.id)) as any;
  if(!before)return res.status(404).json({message:'Improvement task not found.'});if(versionConflict(req,res,before.version))return;
  sqlite.transaction(()=>{sqlite.prepare('UPDATE mk_page_improvements SET change_date=?,change_note=?,version=version+1 WHERE task_id=?').run(b.data.date,b.data.note,before.task_id);audit(req,'marketing.improvement_change',{targetType:'task',targetId:before.task_id,details:{before:{date:before.change_date,note:before.change_note},after:{date:b.data.date,note:b.data.note}}});})();res.json({ok:true});
 });

 app.get('/api/marketing/review-checks',requireElevated,marketingManager,(_req,res)=>{
  const rows=sqlite.prepare('SELECT r.*,rr.lead_id,rr.invoice_id,rr.site invitation_site FROM mk_reviews r LEFT JOIN review_requests rr ON rr.id=r.request_id WHERE r.archived_at IS NULL').all() as any[];
  res.json(rows.map(r=>{const expected=r.request_id?resolveReviewSite({site:r.invitation_site,lead_id:r.lead_id,invoice_id:r.invoice_id}):null;const invalid=r.rating<1||r.rating>5||(r.review_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.review_date)||Number.isNaN(Date.parse(r.review_date))));return {id:r.id,author:r.author,site:r.site,version:r.version,expected,invalid};}).filter(r=>r.invalid||(r.expected&&r.expected!==r.site)));
 });
 app.post('/api/marketing/review-checks/:id/repair',requireElevated,marketingManager,(req,res)=>{
  const r=sqlite.prepare('SELECT r.*,rr.lead_id,rr.invoice_id,rr.site invitation_site FROM mk_reviews r JOIN review_requests rr ON rr.id=r.request_id WHERE r.id=?').get(Number(req.params.id)) as any;if(!r)return res.sendStatus(404);if(versionConflict(req,res,r.version))return;const expected=resolveReviewSite({site:r.invitation_site,lead_id:r.lead_id,invoice_id:r.invoice_id});if(!expected)return res.status(409).json({message:'Business cannot be determined. Edit the review manually.'});sqlite.prepare('UPDATE mk_reviews SET site=?,published=0,version=version+1 WHERE id=?').run(expected,r.id);syncReviewTask({...r,site:expected});audit(req,'marketing.review_business_repair',{targetId:r.id,details:{before:r.site,after:expected}});res.json({ok:true});
 });
 app.post('/api/marketing/portfolio/reorder',requireElevated,marketingManager,(req,res)=>{
  const input=z.array(z.object({id:z.number().int().positive(),version:z.number().int().positive()})).min(2).max(200).safeParse(req.body.items);if(!input.success||new Set(input.data.map(r=>r.id)).size!==input.data.length)return res.status(400).json({message:'Choose distinct work items to reorder.'});
  try{sqlite.transaction(()=>{for(const item of input.data){const row=sqlite.prepare('SELECT version FROM mk_portfolio WHERE id=? AND archived_at IS NULL').get(item.id) as any;if(!row||row.version!==item.version)throw new Error('Work changed. Reload before reordering.');}const all=sqlite.prepare('SELECT id FROM mk_portfolio WHERE archived_at IS NULL ORDER BY order_index,created_at DESC,id DESC').all() as any[];const ids=new Set(input.data.map(r=>r.id));if(!all.slice(0,input.data.length).every(r=>ids.has(r.id)))throw new Error('Reload the unfiltered work list before reordering.');[...input.data,...all.filter(r=>!ids.has(r.id))].forEach((r,i)=>sqlite.prepare('UPDATE mk_portfolio SET order_index=?,version=version+1 WHERE id=?').run(i,r.id));})();audit(req,'marketing.portfolio_reorder',{details:{ids:input.data.map(r=>r.id)}});res.json({ok:true});}catch(e:any){res.status(409).json({message:e.message});}
 });

 app.get('/api/marketing/preferences/:site',requireElevated,(req,res)=>{const parsed=site.safeParse(req.params.site);if(!parsed.success)return res.sendStatus(400);const row=sqlite.prepare('SELECT version FROM mk_preferences WHERE site=?').get(parsed.data) as any;res.json({site:parsed.data,version:row?.version||0,...marketingPreference(parsed.data)});});
 app.put('/api/marketing/preferences/:site',requireElevated,marketingManager,(req,res)=>{const parsed=site.safeParse(req.params.site);if(!parsed.success)return res.sendStatus(400);const body=z.object({staleDays:z.number().int().min(1).max(90).nullable(),followUpDays:z.number().int().min(1).max(90).nullable(),googleProfileUrl:z.string().max(1000).url().refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&['maps.google.com','www.google.com','g.page','share.google'].includes(u.hostname)}catch{return false}}).or(z.literal('')),digest:z.boolean()}).safeParse(req.body);if(!body.success)return res.status(400).json({message:'Check the day counts and Google review link.'});const row=sqlite.prepare('SELECT version FROM mk_preferences WHERE site=?').get(parsed.data) as any;if(versionConflict(req,res,row?.version||0))return;sqlite.prepare('INSERT INTO mk_preferences(site,payload,version) VALUES(?,?,1) ON CONFLICT(site) DO UPDATE SET payload=excluded.payload,version=mk_preferences.version+1').run(parsed.data,JSON.stringify(body.data));audit(req,'marketing.preferences_save',{details:{site:parsed.data,...body.data}});res.json({ok:true});});

 app.get('/api/marketing/spending',requireElevated,(req,res)=>{
  const s=site.safeParse(req.query.site);if(!s.success)return res.status(400).json({message:'Choose a business.'});
  res.json(sqlite.prepare('SELECT * FROM mk_spend_entries WHERE site=? ORDER BY date DESC,id DESC LIMIT 1000').all(s.data));
 });
 app.post('/api/marketing/spending',requireElevated,marketingManager,(req,res)=>{
  const v=spend.safeParse(req.body);if(!v.success)return res.status(400).json({message:v.error.issues[0].message});
  const b=v.data,now=Date.now();
  const create=()=>{const id=Number(sqlite.prepare('INSERT INTO mk_spend_entries(site,date,channel,campaign,amount_cents,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(b.site,b.date,b.channel,b.campaign,b.amountCents,b.notes,now,now).lastInsertRowid);return sqlite.prepare('SELECT * FROM mk_spend_entries WHERE id=?').get(id);};
  try{const key=req.get('Idempotency-Key');const row=key?inventoryOnce(sqlite,req.user!.userId,key,b,create):create();audit(req,'marketing.spend_create',{details:b});res.status(201).json(row);}catch(e:any){res.status(409).json({message:e.message});}
 });
 app.patch('/api/marketing/spending/:id',requireElevated,marketingManager,(req,res)=>{
  const before=sqlite.prepare('SELECT * FROM mk_spend_entries WHERE id=?').get(Number(req.params.id)) as any;
  if(!before)return res.status(404).json({message:'Spending entry not found.'});if(versionConflict(req,res,before.version))return;
  const v=spend.safeParse(req.body);if(!v.success)return res.status(400).json({message:v.error.issues[0].message});if(v.data.site!==before.site)return res.status(400).json({message:'A spending entry cannot move between businesses.'});
  const b=v.data;sqlite.prepare('UPDATE mk_spend_entries SET date=?,channel=?,campaign=?,amount_cents=?,notes=?,version=version+1,updated_at=? WHERE id=?').run(b.date,b.channel,b.campaign,b.amountCents,b.notes,Date.now(),before.id);audit(req,'marketing.spend_edit',{targetId:before.id,details:{before,after:b}});res.json({ok:true});
 });
 app.post('/api/marketing/spending/:id/archive',requireElevated,marketingManager,(req,res)=>{
  const before=sqlite.prepare('SELECT * FROM mk_spend_entries WHERE id=?').get(Number(req.params.id)) as any;if(!before)return res.sendStatus(404);if(versionConflict(req,res,before.version))return;
  sqlite.prepare('UPDATE mk_spend_entries SET archived_at=?,version=version+1,updated_at=? WHERE id=?').run(req.body.restore===true?null:Date.now(),Date.now(),before.id);audit(req,'marketing.spend_archive',{targetId:before.id,details:{restore:req.body.restore===true}});res.json({ok:true});
 });
 app.delete('/api/marketing/growth/spend',requireElevated,marketingManager,(req,res)=>{
  const s=site.safeParse(req.body.site);if(!s.success)return res.sendStatus(400);
  sqlite.prepare('DELETE FROM mk_ad_spend WHERE site=? AND start_date=? AND end_date=?').run(s.data,String(req.body.start),String(req.body.end));audit(req,'marketing.spend_provider_restore',{details:req.body});res.json({ok:true});
 });
 app.get('/api/marketing/links',requireElevated,(req,res)=>res.json(sqlite.prepare('SELECT * FROM mk_campaign_links WHERE site=? ORDER BY id DESC LIMIT 200').all(String(req.query.site))));
 app.post('/api/marketing/links',requireElevated,(req,res)=>{
  const p=z.object({site,name:z.string().trim().min(1).max(100),url:z.string().url().max(1500)}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Enter a campaign name and website link.'});
  const b=p.data,u=new URL(b.url);if(u.protocol!=='https:'||u.host!==GOOGLE_SITES[b.site].domain||u.username||u.password||/^\/(q|p|preview|quote|review|invoice)(\/|$)/i.test(u.pathname))return res.status(400).json({message:'Choose a public page on this business website.'});
  const existing=sqlite.prepare('SELECT * FROM mk_campaign_links WHERE site=? AND url=?').get(b.site,b.url);if(existing)return res.json(existing);
  const id=Number(sqlite.prepare('INSERT INTO mk_campaign_links(site,name,url,created_at) VALUES(?,?,?,?)').run(b.site,b.name,b.url,Date.now()).lastInsertRowid);res.status(201).json({id,...b});
 });
 app.delete('/api/marketing/links/:id',requireElevated,marketingManager,(req,res)=>{sqlite.prepare('DELETE FROM mk_campaign_links WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
 app.get('/api/marketing/history',requireElevated,marketingManager,(_req,res)=>res.json(sqlite.prepare("SELECT id,user_name,action,target_type,target_id,target_name,created_at FROM audit_log WHERE action LIKE 'marketing.%' ORDER BY id DESC LIMIT 100").all()));
 app.get('/api/marketing/outcomes',requireElevated,(req,res)=>res.json(sqlite.prepare('SELECT id,lead_id,event_name,state,last_error,occurred_at,updated_at FROM mk_measurement_events WHERE site=? ORDER BY id DESC LIMIT 100').all(String(req.query.site))));
 app.post('/api/marketing/outcomes/:id/retry',requireElevated,marketingManager,(req,res)=>{
  const row=sqlite.prepare('SELECT * FROM mk_measurement_events WHERE id=?').get(Number(req.params.id)) as any;
  if(!row||row.state!=='failed'||!/^Google HTTP (429|5\d\d)$/.test(row.last_error||'')||row.occurred_at<Date.now()-72*3600000)return res.status(409).json({message:'Only confirmed temporary failures within 72 hours can be retried. Uncertain deliveries are not replayed.'});
  sqlite.prepare("UPDATE mk_measurement_events SET state='pending',updated_at=? WHERE id=? AND state='failed'").run(Date.now(),row.id);audit(req,'marketing.outcome_retry',{targetId:row.id});res.json({ok:true});
 });
}
