import type {Express} from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {audit} from './audit';
import {parseLineItems} from '../shared/biz-common';
import {receivedOrderCost} from '../shared/purchase-orders';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const cents=z.number().int().min(0).max(100000000000).nullable();
const input=z.object({version:z.string(),sourceVersion:z.string(),revenueCents:cents,materialCents:cents,laborCents:cents,otherCents:cents,note:z.string().trim().min(1).max(1500)});
function source(projectId:number){
 const job=sqlite.prepare('SELECT id,quote_id,client_id FROM projects WHERE id=? AND deleted_at IS NULL').get(projectId) as any;
 if(!job)throw new Error('Choose an active job.');
 const quote=job.quote_id?sqlite.prepare('SELECT id,version,total_cents,status FROM quotes WHERE id=?').get(job.quote_id):null;
 const contracts=sqlite.prepare('SELECT id,value_cents,status,deleted_at FROM pm_contracts WHERE project_id=? ORDER BY id').all(projectId);
 const changes=sqlite.prepare('SELECT id,amount_cents,status,deleted_at FROM pm_change_orders WHERE project_id=? ORDER BY id').all(projectId);
 return hash({job,quote,contracts,changes});
}
export function jobForecast(projectId:number){
 const sourceVersion=source(projectId),row=sqlite.prepare('SELECT f.*,u.name reviewer FROM suite_job_forecasts f JOIN users u ON u.id=f.reviewed_by WHERE f.project_id=?').get(projectId) as any;
 const orders=sqlite.prepare("SELECT id,number,status,total_cents,revision,items FROM fin_purchase_orders WHERE project_id=? AND deleted_at IS NULL AND order_type='supplier' AND status IN ('approved','sent','open') ORDER BY id DESC").all(projectId) as any[];
 const received=sqlite.prepare('SELECT r.po_id,r.line_index,sum(r.quantity) qty FROM inventory_receipts r JOIN fin_purchase_orders p ON p.id=r.po_id WHERE p.project_id=? GROUP BY r.po_id,r.line_index').all(projectId) as any[];
 const quantities=new Map<number,Map<number,number>>();for(const r of received){if(!quantities.has(r.po_id))quantities.set(r.po_id,new Map());quantities.get(r.po_id)!.set(r.line_index,r.qty);}
 let unknownOrders=0;const commitments=orders.map(po=>{try{const items=parseLineItems(po.items);if(!items.length)throw new Error('No priced lines');const receivedCents=receivedOrderCost(po,items,quantities.get(po.id)||new Map());return {id:po.id,number:po.number,remainingCents:Math.max(0,po.total_cents-receivedCents)};}catch{unknownOrders++;return {id:po.id,number:po.number,remainingCents:null};}});
 const costs=row?[row.material_cents,row.labor_cents,row.other_cents]:[];
 const complete=!!row&&row.revenue_cents!==null&&costs.every(v=>v!==null)&&row.source_version===sourceVersion;
 return {row:row||null,version:hash(row||null),sourceVersion,sourceChanged:!!row&&row.source_version!==sourceVersion,expectedMarginCents:complete?row.revenue_cents-costs.reduce((a,b)=>a+b,0):null,commitments:commitments.slice(0,10),commitmentCount:commitments.length,committedCents:commitments.reduce((n,p)=>n+(p.remainingCents||0),0),unknownOrders};
}
export function registerJobForecast(app:Express){
 sqlite.exec(`CREATE TABLE IF NOT EXISTS suite_job_forecasts(project_id INTEGER PRIMARY KEY REFERENCES projects(id),revenue_cents INTEGER,material_cents INTEGER,labor_cents INTEGER,other_cents INTEGER,note TEXT NOT NULL,source_version TEXT NOT NULL,reviewed_by INTEGER NOT NULL REFERENCES users(id),reviewed_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS suite_job_forecast_history(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER NOT NULL REFERENCES projects(id),snapshot_json TEXT NOT NULL,created_at INTEGER NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id));
 CREATE INDEX IF NOT EXISTS suite_job_forecast_history_job ON suite_job_forecast_history(project_id,id);`);
 const id=z.coerce.number().int().positive();
 app.get('/api/finance/projects/:id/forecast',requireElevated,(req,res)=>{try{res.json(jobForecast(id.parse(req.params.id)));}catch{res.status(404).json({message:'Job forecast not available. Choose an active job.'});}});
 app.post('/api/finance/projects/:id/forecast',requireElevated,(req,res)=>{
  const parsed=input.safeParse(req.body),jobId=id.safeParse(req.params.id);if(!parsed.success||!jobId.success)return res.status(400).json({message:'Use nonnegative amounts, leave unknown costs blank, and describe the source of your estimate.'});
  try{const result=sqlite.transaction(()=>{
   const b=parsed.data,before=jobForecast(jobId.data);if(before.version!==b.version||before.sourceVersion!==b.sourceVersion)throw new Error('This job or its forecast changed. Your draft is kept. Reload and review the latest scope before saving.');
   const now=Math.max(Date.now(),(before.row?.reviewed_at||0)+1);
   sqlite.prepare('INSERT INTO suite_job_forecasts VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revenue_cents=excluded.revenue_cents,material_cents=excluded.material_cents,labor_cents=excluded.labor_cents,other_cents=excluded.other_cents,note=excluded.note,source_version=excluded.source_version,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at').run(jobId.data,b.revenueCents,b.materialCents,b.laborCents,b.otherCents,b.note,b.sourceVersion,req.user!.userId,now);
   const after=jobForecast(jobId.data);sqlite.prepare('INSERT INTO suite_job_forecast_history(project_id,snapshot_json,created_at,created_by) VALUES(?,?,?,?)').run(jobId.data,JSON.stringify({before:before.row,after:after.row}),now,req.user!.userId);audit(req,'job.forecast_review',{targetType:'project',targetId:jobId.data});return after;
  })();res.json(result);}catch(e:any){res.status(409).json({message:e.message});}
 });
 app.get('/api/finance/projects/:id/forecast/history',requireElevated,(req,res)=>{const jobId=id.safeParse(req.params.id);if(!jobId.success)return res.sendStatus(400);const page=Math.max(0,Math.min(100000,Math.floor(Number(req.query.page)||0)));res.json({rows:sqlite.prepare('SELECT h.id,h.snapshot_json,h.created_at,u.name reviewer FROM suite_job_forecast_history h JOIN users u ON u.id=h.created_by WHERE h.project_id=? ORDER BY h.id DESC LIMIT 20 OFFSET ?').all(jobId.data,page*20),total:(sqlite.prepare('SELECT count(*) n FROM suite_job_forecast_history WHERE project_id=?').get(jobId.data) as any).n,page});});
}
