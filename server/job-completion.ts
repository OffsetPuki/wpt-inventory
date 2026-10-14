import type {Express} from 'express';
import crypto from 'node:crypto';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {jobRecord} from './suite-data';
import {audit} from './audit';
const item=z.enum(['handover','feedback','portfolio']);
export function completionReview(id:number){
 const job=jobRecord(id);
 const tasks=sqlite.prepare("SELECT id,title,status FROM pm_tasks WHERE project_id=? AND deleted_at IS NULL AND status!='done' ORDER BY id").all(id);
 const invoices=sqlite.prepare("SELECT id,number,status,total_cents,paid_cents FROM fin_invoices WHERE project_id=? AND deleted_at IS NULL AND status!='void' ORDER BY id").all(id);
 const checklist=sqlite.prepare('SELECT item,state,note,updated_at FROM suite_job_completion WHERE project_id=? ORDER BY item').all(id);
 const version=crypto.createHash('sha256').update(JSON.stringify({tasks,invoices,checklist,jobVersion:job.version})).digest('hex');
 return {tasks,invoices,checklist,version};
}
export function registerJobCompletion(app:Express){
 sqlite.exec("CREATE TABLE IF NOT EXISTS suite_job_completion(project_id INTEGER NOT NULL REFERENCES projects(id),item TEXT NOT NULL,state TEXT NOT NULL,note TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(project_id,item))");
 app.get('/api/suite/jobs/:id/completion',requireElevated,(req,res)=>{try{res.json(completionReview(z.coerce.number().int().positive().parse(req.params.id)));}catch(e:any){res.status(e.status||400).json({message:e.message});}});
 app.patch('/api/suite/jobs/:id/completion',requireElevated,(req,res)=>{try{
  const id=z.coerce.number().int().positive().parse(req.params.id),body=z.object({item,state:z.enum(['todo','done','not-needed']),note:z.string().trim().max(1000),version:z.string()}).parse(req.body);
  if(body.state==='not-needed'&&body.note.length<3)throw new Error('Explain why this step is not needed.');
  const result=sqlite.transaction(()=>{
   const before=completionReview(id);if(before.version!==body.version)throw Object.assign(new Error('The job changed. Reload the checklist and review it again.'),{status:409});
   sqlite.prepare('INSERT INTO suite_job_completion VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,item) DO UPDATE SET state=excluded.state,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(id,body.item,body.state,body.note,Date.now(),req.user!.userId);
   audit(req,'suite.completion_review',{targetType:'project',targetId:id,details:{item:body.item,state:body.state,previous:before.checklist}});
   return completionReview(id);
  })();res.json(result);
 }catch(e:any){res.status(e.status||400).json({message:e.message});}});
}
