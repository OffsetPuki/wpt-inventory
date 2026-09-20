import {sqlite} from './storage';
import type {Request,Response,NextFunction} from 'express';
export function marketingManager(req:Request,res:Response,next:NextFunction){
 if(!['owner','manager'].includes(req.user?.role||''))return res.status(403).json({message:'Only an owner or manager can publish, archive or change marketing settings.'});next();
}
export function marketingMigrations(){
 for(const [table,columns] of Object.entries({mk_reviews:{archived_at:'INTEGER',version:'INTEGER NOT NULL DEFAULT 1',external_url:'TEXT',external_id:'TEXT'},mk_portfolio:{archived_at:'INTEGER',version:'INTEGER NOT NULL DEFAULT 1',photos:"TEXT NOT NULL DEFAULT '[]'"},review_requests:{site:'TEXT'}})){
  const existing=new Set((sqlite.pragma('table_info('+table+')') as any[]).map(c=>c.name));
  for(const [name,def] of Object.entries(columns))if(!existing.has(name))sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
 }
 sqlite.exec(`CREATE TABLE IF NOT EXISTS mk_preferences(site TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS mk_campaign_links(id INTEGER PRIMARY KEY,site TEXT NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mk_spend_entries(id INTEGER PRIMARY KEY,site TEXT NOT NULL,date TEXT NOT NULL,channel TEXT NOT NULL,campaign TEXT NOT NULL DEFAULT '',amount_cents INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,archived_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS mk_spend_site_date ON mk_spend_entries(site,date);`);
}
export function resolveReviewSite(rr:any):string|null {
 if(['metals','concrete','insulation','trades'].includes(rr.site))return rr.site;
 const direct=rr.lead_id ? (sqlite.prepare('SELECT site FROM crm_leads WHERE id=?').get(rr.lead_id) as any)?.site:null;
 if(direct)return direct;
 if(rr.invoice_id){const row=sqlite.prepare(`SELECT l.site lead_site,p.site project_site,ql.site quote_site FROM fin_invoices i LEFT JOIN crm_leads l ON l.id=i.lead_id LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN quotes q ON q.id=i.quote_id LEFT JOIN crm_leads ql ON ql.id=COALESCE(q.lead_id,p.lead_id) WHERE i.id=?`).get(rr.invoice_id) as any;
 const sites=[...new Set(Object.values(row||{}).filter(Boolean))];if(sites.length===1)return String(sites[0]);}
 return null;
}
export function syncReviewTask(review:any){
 const key='auto:review:'+review.id;
 // Adopt only legacy tasks that identify this review or have a unique matching review.
 if(!sqlite.prepare('SELECT id FROM pm_tasks WHERE auto_key=?').get(key)){
  let legacy=sqlite.prepare("SELECT id FROM pm_tasks WHERE auto_created=1 AND auto_key IS NULL AND deleted_at IS NULL AND description LIKE ?").get('Review #'+review.id+' %') as any;
  const unique=sqlite.prepare('SELECT COUNT(*) n FROM mk_reviews WHERE author IS ? AND rating=?').get(review.author||null,review.rating) as any;
  if(!legacy&&unique.n===1)legacy=sqlite.prepare('SELECT id FROM pm_tasks WHERE auto_created=1 AND auto_key IS NULL AND deleted_at IS NULL AND title=?').get(`Respond to ${review.author||'Anonymous'}'s ${review.rating}-star review`) as any;
  if(legacy)sqlite.prepare('UPDATE pm_tasks SET auto_key=? WHERE id=?').run(key,legacy.id);
 }
 if(review.responded||review.archivedAt||review.rating>3){sqlite.prepare("UPDATE pm_tasks SET status='done' WHERE auto_key=? AND deleted_at IS NULL").run(key);return;}
 const title=`Respond to ${review.author||'customer'} — CJM ${review.site} review #${review.id}`;
 const old=sqlite.prepare('SELECT id,deleted_at FROM pm_tasks WHERE auto_key=?').get(key) as any;
 if(old?.deleted_at)return;
 if(old)sqlite.prepare("UPDATE pm_tasks SET title=?,status=CASE WHEN status='done' THEN 'todo' ELSE status END WHERE id=?").run(title,old.id);
 else sqlite.prepare("INSERT INTO pm_tasks(title,kind,status,auto_created,auto_key,due_date,description) VALUES(?,'follow_up','todo',1,?,date('now'),?)").run(title,key,'Review #'+review.id+' · Open Marketing → Reviews');
}
export function versionConflict(req:Request,res:Response,current:number){
 const requested=req.body?.version ?? req.get('If-Match')?.replace(/\"/g,'');
 if(requested!==undefined&&Number(requested)!==current){res.status(409).json({message:'Someone changed this record. Reload it before saving.'});return true;}return false;
}

export function marketingPreference(site:string|null):any {try{const row=sqlite.prepare('SELECT payload FROM mk_preferences WHERE site=?').get(site||'') as any;return row?JSON.parse(row.payload):{};}catch{return {};}}
