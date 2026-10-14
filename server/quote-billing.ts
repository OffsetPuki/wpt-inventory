import {sqlite} from './storage';

/** Explicit record relationships only. Drafts do not consume the contract. */
export function quoteBilling(quoteId:number,excludeInvoiceId=0){
 const quote=sqlite.prepare('SELECT * FROM quotes WHERE id=? AND deleted_at IS NULL').get(quoteId) as any;
 if(!quote)throw new Error('Restore or choose the linked quote before billing.');
 const jobs=sqlite.prepare('SELECT id,client_id FROM projects WHERE quote_id=? AND deleted_at IS NULL LIMIT 2').all(quoteId) as any[];
 if(jobs.length>1)throw new Error('This quote is linked to more than one job. Review the job connections before billing.');
 const job=jobs[0];
 let customerId:number|null=null;
 try{const candidate=JSON.parse(quote.payload).customer?.clientId;if(Number.isSafeInteger(candidate)&&candidate>0)customerId=candidate;}catch{}
 if(job?.client_id)customerId=job.client_id;
 if(!customerId&&quote.lead_id)customerId=(sqlite.prepare('SELECT client_id FROM crm_leads WHERE id=?').get(quote.lead_id) as any)?.client_id||null;
 const customer=customerId?sqlite.prepare('SELECT id,name,deleted_at FROM crm_clients WHERE id=?').get(customerId) as any:null;
 if(customerId&&(!customer||customer.deleted_at))throw new Error('Restore the linked customer before billing this quote.');
 const contracts=job?sqlite.prepare("SELECT count(*) n,coalesce(sum(value_cents),0) amount FROM pm_contracts WHERE project_id=? AND deleted_at IS NULL AND status IN ('active','signed')").get(job.id) as any:null;
 const changes=job?(sqlite.prepare("SELECT coalesce(sum(amount_cents),0) amount FROM pm_change_orders WHERE project_id=? AND deleted_at IS NULL AND status='approved'").get(job.id) as any).amount:0;
 const contractCents=(contracts?.n?contracts.amount:quote.total_cents)+changes;
 const sums=sqlite.prepare(`SELECT
  coalesce(sum(CASE WHEN status NOT IN ('draft','void') THEN total_cents-CASE WHEN retainage_released_at IS NOT NULL THEN coalesce(retainage_cents,0) ELSE 0 END ELSE 0 END),0) billed,
  coalesce(sum(CASE WHEN status='draft' THEN total_cents ELSE 0 END),0) drafts,
  sum(CASE WHEN status='draft' THEN 1 ELSE 0 END) draft_count
  FROM fin_invoices WHERE deleted_at IS NULL AND id<>? AND (quote_id=? OR (? IS NOT NULL AND project_id=?))`).get(excludeInvoiceId,quoteId,job?.id??null,job?.id??null) as any;
 return {quoteId,projectId:job?.id??null,clientId:customer?.id??null,clientName:customer?.name??quote.customer_name,contractCents,billedCents:sums.billed,remainingCents:Math.max(0,contractCents-sums.billed),draftCents:sums.drafts,draftCount:sums.draft_count||0};
}

export function validateQuoteBilling(inv:{id?:number;quoteId?:number|null;projectId?:number|null;kind?:string|null;totalCents:number}){
 if(!inv.quoteId||!['deposit','full','balance'].includes(inv.kind||''))return;
 const billing=quoteBilling(inv.quoteId,inv.id);
 if(billing.projectId&&inv.projectId!==billing.projectId)throw new Error('Use the job linked to this quote before issuing its invoice.');
 if(inv.totalCents>billing.remainingCents)throw new Error('This quote has less left to bill than this invoice. Reopen the invoice helper to include all issued bills, or record the approved scope change first.');
}
