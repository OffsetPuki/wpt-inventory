import {customerAccountIds} from './customer-accounts';
import type {Express} from 'express';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {z} from 'zod';
const kind=z.enum(['customer','lead','quote','job','invoice']);
type Kind=z.infer<typeof kind>;
const tables:Record<Kind,string>={customer:'crm_clients',lead:'crm_leads',quote:'quotes',job:'projects',invoice:'fin_invoices'};

// IDs stay in SQLite. A busy customer's history no longer becomes unbounded
// JSON arrays passed back into later queries or thousands of rendered links.
export function recordConnections(type:Kind,id:number,paging?:{page:number;size:number}){
 const row=sqlite.prepare(`SELECT * FROM ${tables[type]} WHERE id=? AND deleted_at IS NULL`).get(id) as any;
 if(!row)throw Object.assign(new Error('This record is no longer available.'),{status:404});
 const leadId=type==='lead'?id:row.lead_id||null;
 const lead=leadId?sqlite.prepare('SELECT id,client_id FROM crm_leads WHERE id=? AND deleted_at IS NULL').get(leadId) as any:null;
 let clientId=type==='customer'?id:row.client_id||lead?.client_id||null;
 if(type==='quote'&&!clientId){try{clientId=Number(JSON.parse(row.payload)?.customer?.clientId)||null;}catch{}}
 const params={accounts:JSON.stringify(type==='customer'?customerAccountIds(id):[]),customer:type==='customer'?1:0,
  lead:leadId,client:clientId,job:type==='job'?id:row.project_id||null,quote:type==='quote'?id:row.quote_id||null,invoice:type==='invoice'?id:null};
 const jobs=`SELECT id,name,quote_id,client_id,lead_id,created_at FROM projects WHERE deleted_at IS NULL AND
  ((@customer=1 AND client_id IN (SELECT value FROM json_each(@accounts))) OR
   (@customer=0 AND (id=@job OR quote_id=@quote OR lead_id=@lead)))`;
 if(!params.client){
  const possible=sqlite.prepare(`SELECT count(DISTINCT client_id) n,min(client_id) id FROM (${jobs}) WHERE client_id IS NOT NULL`).get(params) as any;
  if(possible.n===1)params.client=possible.id;
 }
 const cte=`WITH linked_jobs AS (${jobs}), linked_quotes AS (
  SELECT q.id,q.number,q.status,q.created_at FROM quotes q LEFT JOIN crm_leads l ON l.id=q.lead_id WHERE q.deleted_at IS NULL AND
   (q.id=@quote OR q.id IN (SELECT quote_id FROM linked_jobs) OR q.lead_id=@lead OR
   (@customer=1 AND (l.client_id IN (SELECT value FROM json_each(@accounts)) OR
     (CASE WHEN json_valid(q.payload) THEN CAST(json_extract(q.payload,'$.customer.clientId') AS INTEGER) END) IN (SELECT value FROM json_each(@accounts)))))
 ), linked_invoices AS (
  SELECT id,number,status,created_at FROM fin_invoices WHERE deleted_at IS NULL AND
   (id=@invoice OR project_id IN (SELECT id FROM linked_jobs) OR quote_id IN (SELECT id FROM linked_quotes) OR
    (@customer=1 AND client_id IN (SELECT value FROM json_each(@accounts))))
 ), records AS (
  SELECT 'Customer' type,0 position,id,CASE WHEN coalesce(company,'')!='' THEN name||' · '||company ELSE name END label,NULL status,created_at FROM crm_clients WHERE id=@client AND deleted_at IS NULL
  UNION ALL SELECT 'Quote',1,id,number,status,created_at FROM linked_quotes
  UNION ALL SELECT 'Job',2,id,name,NULL,created_at FROM linked_jobs
  UNION ALL SELECT 'Invoice',3,id,number,status,created_at FROM linked_invoices
 ) `;
 const counts=sqlite.prepare(cte+"SELECT count(*) total,coalesce(sum(type='Job'),0) jobs,coalesce(sum(type='Customer'),0) clients FROM records").get(params) as any;
 const size=paging?.size||counts.total||1,page=paging?Math.min(paging.page,Math.max(0,Math.ceil(counts.total/size)-1)):0;
 const rows=sqlite.prepare(cte+'SELECT type,id,label,status FROM records ORDER BY position,created_at DESC,id DESC LIMIT @size OFFSET @offset').all({...params,size,offset:page*size}) as any[];
 const href=(type:string,id:number)=>type==='Customer'?`/crm/clients?client=${id}`:type==='Quote'?`/crm/quotes?quote=${id}`:type==='Job'?`/project/${id}`:`/finance/invoices?invoice=${id}`;
 return {records:rows.map(r=>({...r,href:href(r.type,r.id)})),jobs:rows.filter(r=>r.type==='Job').map(r=>({id:r.id,name:r.label,filesHref:`/project/${r.id}?tab=files`,activityHref:`/project/${r.id}?tab=activity`})),
  total:counts.total,page,pageSize:size,missing:[...(!counts.clients?['Choose a customer to connect this record.']:[]),...(!counts.jobs?['No job is linked yet. A quote can remain separate until work is approved.']:[])],generatedAt:Date.now()};
}
export function registerRecordConnections(app:Express){
 app.get('/api/suite/connections/:kind/:id',requireElevated,(req,res)=>{try{
  const page=z.coerce.number().int().min(0).max(100000).parse(req.query.page||0),size=z.coerce.number().int().min(1).max(25).parse(req.query.size||5);
  res.json(recordConnections(kind.parse(req.params.kind),z.coerce.number().int().positive().parse(req.params.id),{page,size}));
 }catch(e:any){res.status(e instanceof z.ZodError?400:e.status||500).json({message:e.message});}});
}
