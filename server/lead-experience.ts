import type { Express, Request } from 'express';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { sqlite, uploadsDir } from './storage';
import { saveLeadPhoto } from './media';
import { requireElevated } from './auth';
import { audit } from './audit';
import { queueOwnerMail, mailEnabled } from './mailer';
import { LEAD_SITES } from '../shared/crm-schema';

sqlite.exec(`
 CREATE TABLE IF NOT EXISTS crm_lead_intake (lead_id INTEGER PRIMARY KEY, context TEXT NOT NULL DEFAULT '{}', first_contact_at INTEGER, qualified_at INTEGER, survey_at INTEGER, updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS web_lead_access (token_hash TEXT PRIMARY KEY, lead_id INTEGER NOT NULL, site TEXT NOT NULL, expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_web_lead_access_lead ON web_lead_access(lead_id);
 CREATE TABLE IF NOT EXISTS web_lead_supplements (submission_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
`);
export const qualificationSchema = z.object({
 projectKind: z.string().max(100).optional(), removal: z.string().max(40).optional(),
 dimensions: z.string().max(300).optional(), budget: z.string().max(120).optional(),
 facilityCompany: z.string().max(200).optional(), deadline: z.string().max(40).optional(),
});
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function saveLeadIntake(leadId: number, site: string, body: { contact?: string; bestTime?: string; page?: string; consent?: string; qualification?: z.infer<typeof qualificationSchema>; receiptToken?: string; utm?: unknown }) {
 const context = JSON.stringify({ contact: body.contact || '', bestTime: body.bestTime || '', page: body.page || '', consent: body.consent || '', qualification: body.qualification || {}, utm: body.utm || {} });
 sqlite.prepare(`INSERT INTO crm_lead_intake (lead_id,context,updated_at) VALUES (?,?,?) ON CONFLICT(lead_id) DO UPDATE SET context=excluded.context,updated_at=excluded.updated_at`).run(leadId, context, Date.now());
 if (body.receiptToken) {
   // Conflict never rebinds an existing capability to another customer/request.
   sqlite.prepare('INSERT OR IGNORE INTO web_lead_access (token_hash,lead_id,site,expires_at) VALUES (?,?,?,?)').run(hash(body.receiptToken), leadId, site, Date.now() + 7 * 86400000);
 }
}
export function hasLeadReceipt(leadId: number, site: string, token?: string) {
 return !!token && !!sqlite.prepare('SELECT 1 FROM web_lead_access WHERE token_hash=? AND lead_id=? AND site=? AND expires_at>?').get(hash(token),leadId,site,Date.now());
}
export function recordHumanContact(leadId: number) {
 const now = Date.now();
 sqlite.prepare(`INSERT INTO crm_lead_intake (lead_id,first_contact_at,updated_at) VALUES (?,?,?) ON CONFLICT(lead_id) DO UPDATE SET first_contact_at=COALESCE(first_contact_at,excluded.first_contact_at)`).run(leadId, now, now);
 sqlite.prepare("UPDATE pm_tasks SET status='done' WHERE deleted_at IS NULL AND status!='done' AND (auto_key=? OR auto_key=? OR auto_key LIKE ?)").run(`auto:lead-follow-up:${leadId}`,`auto:lead-quote-chase:${leadId}`,`auto:stale-lead:${leadId}:%`);
}
export function registerLeadExperience(app: Express, hasLeadKey: (req: Request) => boolean) {
 app.post('/api/public/lead-details', (req,res) => {
   res.setHeader('Cache-Control','no-store');
   if (!hasLeadKey(req)) return res.status(401).json({message:'Unauthorized'});
   const parsed = z.object({token: tokenSchema, site:z.enum(LEAD_SITES), submissionId:z.string().uuid(), details:z.string().trim().max(4000).default(''), photos:z.array(z.string().max(1_400_000)).max(3).default([])}).safeParse(req.body);
   if (!parsed.success) return res.status(400).json({message:'Invalid details or photos.'});
   const body=parsed.data, tokenHash=hash(body.token), payloadHash=hash(JSON.stringify({details:body.details,photos:body.photos}));
   const access=sqlite.prepare(`SELECT a.lead_id,l.photos,l.notes FROM web_lead_access a JOIN crm_leads l ON l.id=a.lead_id WHERE a.token_hash=? AND a.site=? AND a.expires_at>? AND l.site=a.site AND l.deleted_at IS NULL`).get(tokenHash,body.site,Date.now()) as {lead_id:number;photos:string|null;notes:string|null}|undefined;
   if (!access) return res.status(404).json({message:'This receipt has expired or is unavailable. Please contact us.'});
   const prior=sqlite.prepare('SELECT token_hash,payload_hash FROM web_lead_supplements WHERE submission_id=?').get(body.submissionId) as {token_hash:string;payload_hash:string}|undefined;
   if (prior) return prior.token_hash===tokenHash && prior.payload_hash===payloadHash ? res.json({ok:true,deduped:true}) : res.status(409).json({message:'Request changed. Please retry with a new submission.'});
   if (!body.details && !body.photos.length) return res.status(400).json({message:'Add details or at least one photo.'});
   const count=sqlite.prepare('SELECT COUNT(*) AS n FROM web_lead_supplements WHERE token_hash=?').get(tokenHash) as {n:number};
   if (count.n>=3 || (access.notes?.length||0)>20000) return res.status(429).json({message:'Please contact us directly for more updates.'});
   let urls:string[]=[];
   try {
     for (const photo of body.photos) urls.push(saveLeadPhoto(photo));
     sqlite.transaction(()=>{
       const existing=JSON.parse(access.photos || '[]');
       if (!Array.isArray(existing) || existing.length+urls.length>12) throw new Error('Too many photos; please contact us.');
       sqlite.prepare('UPDATE crm_leads SET photos=?,notes=? WHERE id=?').run(JSON.stringify([...existing,...urls]),`${access.notes||''}\n\nCustomer update (${new Date().toISOString()}):\n${body.details}${urls.length ? `\n${urls.length} additional photo(s)` : ''}`,access.lead_id);
       sqlite.prepare('INSERT INTO web_lead_supplements VALUES (?,?,?,?)').run(body.submissionId,tokenHash,payloadHash,Date.now());
       sqlite.prepare('UPDATE crm_lead_intake SET updated_at=? WHERE lead_id=?').run(Date.now(),access.lead_id);
       sqlite.prepare("INSERT OR IGNORE INTO suite_notifications(user_id,event_key,title,href) SELECT id,?,?,? FROM users WHERE role='owner' AND disabled_at IS NULL").run(`lead-details:${body.submissionId}`,'Customer added photos or project details',`/crm/leads?lead=${access.lead_id}`);
       if(mailEnabled() && process.env.OWNER_EMAIL) queueOwnerMail({deliveryKey:`lead-details:${body.submissionId}`,subject:'[CJM Suite] Customer added project details',text:`Lead #${access.lead_id} has an update. Open the lead in FLIPNOB to review the notes and photos.`});
     })();
     return res.json({ok:true});
   } catch (error) {
     for (const url of urls) { try { fs.unlinkSync(path.join(uploadsDir,path.basename(url))); } catch {} }
     return res.status(400).json({message:error instanceof Error ? error.message : 'Unable to save details.'});
   }
 });
 app.get('/api/crm/leads/:id/intake',requireElevated,(req,res)=>{
   const lead=sqlite.prepare('SELECT id FROM crm_leads WHERE id=? AND deleted_at IS NULL').get(Number(req.params.id));
   if (!lead) return res.status(404).json({message:'Lead not found'});
   const row=sqlite.prepare('SELECT * FROM crm_lead_intake WHERE lead_id=?').get(Number(req.params.id)) as any;
   return res.json(row ? {...row,context:JSON.parse(row.context)} : {context:{}});
 });
 app.patch('/api/crm/leads/:id/intake',requireElevated,(req,res)=>{
   const parsed=z.object({qualified:z.boolean().optional(),surveyAt:z.number().int().min(0).nullable().optional()}).strict().safeParse(req.body);
   if(!parsed.success)return res.status(400).json({message:'Invalid lead outcome'});
   const id=Number(req.params.id);if(!sqlite.prepare('SELECT 1 FROM crm_leads WHERE id=? AND deleted_at IS NULL').get(id))return res.status(404).json({message:'Lead not found'});
   sqlite.prepare("INSERT OR IGNORE INTO crm_lead_intake (lead_id,updated_at) VALUES (?,?)").run(id,Date.now());
   if(parsed.data.qualified!==undefined)sqlite.prepare('UPDATE crm_lead_intake SET qualified_at=? WHERE lead_id=?').run(parsed.data.qualified?Date.now():null,id);
   if(parsed.data.surveyAt!==undefined)sqlite.prepare('UPDATE crm_lead_intake SET survey_at=? WHERE lead_id=?').run(parsed.data.surveyAt,id);
   audit(req,'crm.lead_outcome',{targetType:'lead',targetId:id,details:parsed.data});
   return res.json({ok:true});
 });
 app.get('/api/crm/lead-funnel',requireElevated,(_req,res)=>{
   // Human activity only. An automatic acknowledgement or an internal note is not a response.
   const rows=sqlite.prepare(`WITH human AS (SELECT entity_id,MIN(created_at) first_at FROM crm_activities WHERE entity_type='lead' AND user_id IS NOT NULL AND kind IN ('call','email','meeting') GROUP BY entity_id)
     SELECT l.id,l.name,l.site,l.source,l.utm_source,l.utm_campaign,l.created_at,l.service_requested,l.assigned_to,l.stage,l.revenue_closed_cents,i.qualified_at,i.survey_at,COALESCE(h.first_at,i.first_contact_at) first_response_at FROM crm_leads l LEFT JOIN crm_lead_intake i ON i.lead_id=l.id LEFT JOIN human h ON h.entity_id=l.id WHERE l.deleted_at IS NULL AND (l.created_at>=? OR l.stage='new') ORDER BY l.created_at`).all(Date.now()-90*86400000) as any[];
   const report=LEAD_SITES.map(site=>{
     const items=rows.filter(r=>r.site===site && r.created_at>=Date.now()-90*86400000),responded=items.filter(r=>r.first_response_at);
     return {site,leads:items.length,qualified:items.filter(r=>r.qualified_at).length,surveys:items.filter(r=>r.survey_at).length,quoted:items.filter(r=>['quote_sent','follow_up','won'].includes(r.stage)).length,won:items.filter(r=>r.stage==='won').length,wonValueCents:items.filter(r=>r.stage==='won').reduce((n,r)=>n+r.revenue_closed_cents,0),responseSample:responded.length,averageResponseMinutes:responded.length?Math.round(responded.reduce((n,r)=>n+Math.max(0,r.first_response_at-r.created_at)/60000,0)/responded.length):null};
   });
   const queue=rows.filter(r=>r.stage==='new'&&!r.first_response_at).map(r=>({id:r.id,name:r.name,site:r.site,createdAt:r.created_at,service:r.service_requested,assignedTo:r.assigned_to}));
   const groups=new Map<string,typeof rows>();
   for(const row of rows.filter(r=>r.created_at>=Date.now()-90*86400000)){
     const key=JSON.stringify([row.site,row.utm_source||row.source,row.utm_campaign||'']);
     groups.set(key,[...(groups.get(key)||[]),row]);
   }
   const bySource=Array.from(groups,([key,items])=>{
     const [site,source,campaign]=JSON.parse(key),responded=items.filter(r=>r.first_response_at);
     return {site,source,campaign,leads:items.length,qualified:items.filter(r=>r.qualified_at).length,quotes:items.filter(r=>['quote_sent','follow_up','won'].includes(r.stage)).length,won:items.filter(r=>r.stage==='won').length,averageResponseMinutes:responded.length?Math.round(responded.reduce((n,r)=>n+Math.max(0,r.first_response_at-r.created_at)/60000,0)/responded.length):null};
   }).sort((a,b)=>b.leads-a.leads).slice(0,30);
   res.json({days:90,report,queue,bySource});
 });
}
