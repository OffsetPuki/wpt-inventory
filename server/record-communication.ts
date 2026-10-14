import type {Express} from 'express';
import crypto from 'node:crypto';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {recordConnections} from './record-connections';
import {customerAccountIds} from './customer-accounts';
import {z} from 'zod';
const kinds=z.enum(['customer','lead','quote','job','invoice']);
export function registerRecordCommunication(app:Express){
 app.get('/api/suite/communication/:kind/:id',requireElevated,(req,res)=>{try{
  const kind=kinds.parse(req.params.kind),id=z.coerce.number().int().positive().parse(req.params.id),connected=recordConnections(kind,id);
  const ids=(type:string)=>connected.records.filter(r=>r.type===type).map(r=>r.id);
  const customers=kind==='customer'?customerAccountIds(id):[];
  const params={quotes:JSON.stringify(ids('Quote')),invoices:JSON.stringify(ids('Invoice')),jobs:JSON.stringify(ids('Job')),customers:JSON.stringify(customers)};
  // Frozen explicit IDs and historical queue IDs only. Matching an email address
  // could incorrectly combine separate jobs or unrelated shared mailboxes.
  const source=`FROM suite_mail m LEFT JOIN suite_outbox o ON o.event_key='delivery:'||m.key LEFT JOIN suite_outbox p ON p.event_key=m.key WHERE json_valid(m.payload) AND (
   json_extract(m.payload,'$.msg.context.quoteId') IN (SELECT value FROM json_each(@quotes)) OR
   json_extract(m.payload,'$.msg.context.invoiceId') IN (SELECT value FROM json_each(@invoices)) OR
   json_extract(m.payload,'$.msg.context.jobId') IN (SELECT value FROM json_each(@jobs)) OR
   json_extract(m.payload,'$.msg.context.customerId') IN (SELECT value FROM json_each(@customers)) OR
   (json_extract(m.payload,'$.msg.condition.kind')='quote-pending' AND json_extract(m.payload,'$.msg.condition.id') IN (SELECT value FROM json_each(@quotes))) OR
   (json_extract(m.payload,'$.msg.condition.kind')='invoice-overdue' AND json_extract(m.payload,'$.msg.condition.id') IN (SELECT value FROM json_each(@invoices))) OR
   (CASE WHEN json_valid(p.payload) THEN json_extract(p.payload,'$.quoteId') END) IN (SELECT value FROM json_each(@quotes)) OR
   (CASE WHEN json_valid(p.payload) THEN json_extract(p.payload,'$.inv.id') END) IN (SELECT value FROM json_each(@invoices)))`;
  const total=(sqlite.prepare('SELECT count(*) n '+source).get(params) as any).n,page=Math.min(Math.max(0,Math.floor(Number(req.query.page)||0)),Math.max(0,Math.ceil(total/25)-1));
  const rows=(sqlite.prepare('SELECT m.payload,m.first_attempt_at,m.accepted_at,o.created_at,o.status,o.attempts '+source+' ORDER BY coalesce(o.created_at,m.first_attempt_at,m.accepted_at) DESC,m.key DESC LIMIT 25 OFFSET @offset').all({...params,offset:page*25}) as any[]).map(row=>{const msg=JSON.parse(row.payload).msg;return {reference:crypto.createHash('sha256').update(row.payload).digest('hex').slice(0,12),to:msg.to,subject:msg.subject,replyTo:msg.replyTo||null,version:msg.context?.version??null,attachments:(msg.attachments||[]).map((a:any)=>a.filename),createdAt:row.created_at||row.first_attempt_at,acceptedAt:row.accepted_at,status:row.accepted_at?'Provider accepted':({pending:'Waiting to send',processing:'Sending',failed:'Failed — needs review',review:'Held for review',stopped:'Stopped'} as Record<string,string>)[row.status]||'Outcome unknown',attempts:row.attempts||0};});
  res.json({rows,total,page,pageSize:25});
 }catch(e:any){res.status(e.status||400).json({message:e.message});}});
}
