import crypto from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {audit} from './audit';
import {inventoryOnce} from './inventory-core';
import {validateTaskDates} from '../shared/suite-contracts';
const selection=z.array(z.number().int().positive()).min(1).max(50);
function preview(ids:number[],dueDate:string){
 validateTaskDates({dueDate});if(!dueDate)throw new Error('Choose the new due date.');
 if(new Set(ids).size!==ids.length)throw new Error('Choose each task once.');
 const rows=sqlite.prepare("SELECT * FROM pm_tasks WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL AND status!='done' ORDER BY id").all(JSON.stringify(ids)) as any[];
 if(rows.length!==ids.length)throw new Error('A selected task is completed or unavailable. Review the selection.');
 for(const row of rows)if(row.start_date&&row.start_date>dueDate)throw new Error(`${row.title}: the new due date would be before its start date.`);
 const version=crypto.createHash('sha256').update(JSON.stringify({rows,dueDate})).digest('hex');
 return {version,rows:rows.map(r=>({id:r.id,title:r.title,startDate:r.start_date,previousDueDate:r.due_date,dueDate}))};
}
export function registerTaskReschedule(app:Express){
 app.get('/api/suite/tasks/reschedule',requireElevated,(req,res)=>{try{res.json(preview(selection.parse(String(req.query.ids||'').split(',').map(Number)),String(req.query.dueDate||'')));}catch(e:any){res.status(400).json({message:e.message});}});
 app.post('/api/suite/tasks/reschedule',requireElevated,(req,res)=>{try{
  const b=z.object({ids:selection,dueDate:z.string(),version:z.string(),requestKey:z.string().uuid()}).parse(req.body);
  const result=inventoryOnce(sqlite,req.user!.userId,b.requestKey,{action:'reschedule-tasks',...b},()=>{
    const plan=preview(b.ids,b.dueDate);if(plan.version!==b.version)throw Object.assign(new Error('One of these tasks changed. Review a fresh preview.'),{status:409});
    const update=sqlite.prepare('UPDATE pm_tasks SET due_date=? WHERE id=?');for(const row of plan.rows)update.run(b.dueDate,row.id);
    audit(req,'pm.bulk_reschedule',{targetType:'pm_task',details:{changes:plan.rows}});return {count:plan.rows.length};
  });res.json(result);
 }catch(e:any){res.status(e.status||400).json({message:e.message});}});
}
