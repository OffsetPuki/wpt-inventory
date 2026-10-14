import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {CUSTOMER_REFERENCE_TABLES} from '../shared/suite-contracts';
const resources={job:{table:'projects',column:'project_id',name:'name'},customer:{table:'crm_clients',column:'client_id',name:'name'},lead:{table:'crm_leads',column:'lead_id',name:'name'},item:{table:'items',column:'item_id',name:'name'}} as const;
const labels:Record<string,string>={projects:'Jobs',crm_leads:'Leads',pm_tasks:'Tasks',pm_time_entries:'Work hours',fin_invoices:'Invoices',fin_expenses:'Expenses',fin_purchase_orders:'Purchase orders',suite_files:'Job files',suite_comments:'Job activity',pm_documents:'Documents',pm_contracts:'Contracts',pm_change_orders:'Scope changes',inventory_reservations:'Material reservations',inventory_receipts:'Stock receipts',inventory_loans:'Tool loans',transactions:'Stock history',adjustments:'Stock adjustments',customer_previews:'Customer previews',quotes:'Quotes'};
export function registerDeletionReview(app:Express){
 app.get('/api/suite/deletion-review/:kind/:id',requireElevated,(req,res)=>{
  const parsed=z.object({kind:z.enum(['job','customer','lead','item']),id:z.coerce.number().int().positive()}).safeParse(req.params);
  if(!parsed.success)return res.status(400).json({message:'Choose a valid record.'});
  const {kind,id}=parsed.data,resource=resources[kind];
  const record=sqlite.prepare(`SELECT ${resource.name} name,deleted_at FROM ${resource.table} WHERE id=?`).get(id) as any;
  if(!record)return res.status(404).json({message:'Record not found.'});
  const tables=(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).filter(t=>/^[a-z_]+$/.test(t.name));
  const rows=tables.flatMap(t=>{
   if(kind==='customer'&&!(CUSTOMER_REFERENCE_TABLES as readonly string[]).includes(t.name))return [];
   if(!(sqlite.prepare(`PRAGMA table_info(${t.name})`).all() as any[]).some(c=>c.name===resource.column))return [];
   const count=(sqlite.prepare(`SELECT count(*) n FROM ${t.name} WHERE ${resource.column}=?`).get(id) as {n:number}).n;
   return count?[{label:labels[t.name]||t.name.replace(/^(suite_|pm_|fin_|crm_|mk_)/,'').replaceAll('_',' '),count}]:[];
  });
  if(kind==='customer'){
   const count=(sqlite.prepare("SELECT count(*) n FROM quotes WHERE CASE WHEN json_valid(payload) THEN json_extract(payload,'$.customer.clientId') END=?").get(id) as {n:number}).n;
   if(count)rows.push({label:'Quotes',count});
  }
  res.json({name:record.name,deleted:record.deleted_at!=null,rows,explanation:kind==='job'?'Work history and files are retained. Reserved materials are released on deletion; restoring the job does not reserve them again.':'Linked records are retained. Restore related deleted records separately after review. Messages, canceled actions and payments are not restarted.'});
 });
}
