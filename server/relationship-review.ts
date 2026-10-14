import type {Express} from 'express';
import {sqlite} from './storage';
import {requireElevated} from './auth';

// Only explicit record IDs establish evidence. A shared name or email is never
// sufficient to change ownership, move a financial record or merge customers.
const issues=`WITH quote_customers AS (
 SELECT q.id,COALESCE(l.client_id,CASE WHEN json_valid(q.payload) THEN CAST(json_extract(q.payload,'$.customer.clientId') AS INTEGER) END) client_id
 FROM quotes q LEFT JOIN crm_leads l ON l.id=q.lead_id WHERE q.deleted_at IS NULL
), problems AS (
 SELECT 'job-customer' kind,p.id,p.name label,'Choose a customer' title,
 'This active job has no customer link.' evidence,
 CASE WHEN c.id IS NOT NULL THEN 'Its quote points to '||c.name||'. Review that customer in Job settings before saving.' ELSE 'Choose the customer in Job settings after checking the request and quote.' END suggestion,
 '/project/'||p.id href FROM projects p LEFT JOIN quote_customers q ON q.id=p.quote_id LEFT JOIN crm_clients c ON c.id=q.client_id AND c.deleted_at IS NULL WHERE p.deleted_at IS NULL AND p.client_id IS NULL
 UNION ALL SELECT 'job-quote-customer',p.id,p.name,'Customer links differ',
 'The job and its quote point to different customer records.','Check whether these are a company and contact. Link the company records, or review the job customer and quote together in Job settings.',
 '/project/'||p.id FROM projects p JOIN quote_customers q ON q.id=p.quote_id WHERE p.deleted_at IS NULL AND p.client_id IS NOT NULL AND q.client_id IS NOT NULL AND p.client_id!=q.client_id
 AND COALESCE((SELECT account_id FROM crm_account_contacts WHERE contact_id=p.client_id),p.client_id)!=COALESCE((SELECT account_id FROM crm_account_contacts WHERE contact_id=q.client_id),q.client_id)
 UNION ALL SELECT 'job-quote',p.id,p.name,'Linked quote is unavailable','This job references a missing or deleted quote.','Review the historical quote before changing the link. Keep issued invoices and payments intact.','/project/'||p.id FROM projects p LEFT JOIN quotes q ON q.id=p.quote_id WHERE p.deleted_at IS NULL AND p.quote_id IS NOT NULL AND (q.id IS NULL OR q.deleted_at IS NOT NULL)
 UNION ALL SELECT 'job-deleted-customer',p.id,p.name,'Customer is unavailable','The customer linked to this job is deleted or missing.','Review Trash to restore the customer when appropriate. Restoration does not resend emails or restart financial actions.','/trash' FROM projects p LEFT JOIN crm_clients c ON c.id=p.client_id WHERE p.deleted_at IS NULL AND p.client_id IS NOT NULL AND (c.id IS NULL OR c.deleted_at IS NOT NULL)
 UNION ALL SELECT 'invoice-job-customer',i.id,i.number,'Invoice and job customers differ','This invoice and its linked job point to different customer records.','Review company contacts and the job settings first. An issued invoice needs its explicit correction workflow; do not silently rewrite it.','/finance/invoices?invoice='||i.id FROM fin_invoices i JOIN projects p ON p.id=i.project_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.status!='void' AND i.client_id IS NOT NULL AND p.client_id IS NOT NULL AND i.client_id!=p.client_id
 AND COALESCE((SELECT account_id FROM crm_account_contacts WHERE contact_id=i.client_id),i.client_id)!=COALESCE((SELECT account_id FROM crm_account_contacts WHERE contact_id=p.client_id),p.client_id)
 UNION ALL SELECT 'invoice-job',i.id,i.number,'Linked job is unavailable','The job associated with this invoice is deleted or missing.','Review the job in Trash. Restore valid relationships without recreating invoices or payments.','/trash' FROM fin_invoices i LEFT JOIN projects p ON p.id=i.project_id WHERE i.deleted_at IS NULL AND i.status!='void' AND i.project_id IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NOT NULL)
)`;
export function registerRelationshipReview(app:Express){
 app.get('/api/suite/relationship-review',requireElevated,(req,res)=>{
  const total=(sqlite.prepare(issues+' SELECT count(*) n FROM problems').get() as {n:number}).n;
  const page=Math.min(Math.max(0,Math.floor(Number(req.query.page)||0)),Math.max(0,Math.ceil(total/25)-1));
  const rows=sqlite.prepare(issues+' SELECT * FROM problems ORDER BY kind,id LIMIT 25 OFFSET ?').all(page*25);
  res.json({rows,total,page,pageSize:25});
 });
}
