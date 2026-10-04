import type {Express} from 'express';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {payrollDate} from './payroll';
import {todayLocal} from './http-util';
import {BUSINESSES} from '../shared/business.js';

export function registerBusinessReport(app:Express){
 app.get('/api/business-report',requireElevated,(req,res)=>{
  const today=todayLocal(),from=String(req.query.from||today.slice(0,7)+'-01'),to=String(req.query.to||today),site=String(req.query.site||'all');
  try{payrollDate(from);payrollDate(to);if(from>to||!['all','unassigned',...Object.keys(BUSINESSES)].includes(site))throw new Error();}catch{return res.status(400).json({message:'Choose a valid business and date range.'});}
  // Unknown ownership stays visible as Unassigned; it is never guessed from a vendor.
  const invoiceSite="coalesce(p.site,l.site,CASE WHEN json_valid(q.payload) THEN coalesce(json_extract(q.payload,'$.business'),CASE q.type WHEN 'concrete' THEN 'concrete' WHEN 'insulation' THEN 'insulation' ELSE 'metals' END) END,'unassigned')";
  const joins='LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN crm_leads l ON l.id=i.lead_id LEFT JOIN quotes q ON q.id=i.quote_id';
  const paymentDate="coalesce(nullif(t.paid_at,''),date(t.created_at/1000,'unixepoch','localtime'))";
  const kind=String(req.query.kind||'all'),search=String(req.query.q||'').slice(0,100),page=Math.max(0,Math.min(100000,Math.trunc(Number(req.query.page)||0))),limit=25;
  if(!['all','paid','expense','cash','outstanding'].includes(kind))return res.status(400).json({message:'Choose a valid report filter.'});
  const cte=`WITH records AS (
    SELECT 'paid' kind,t.id,${paymentDate} date,i.number label,t.amount_cents amountCents,${invoiceSite} site,'/finance/invoices?invoice='||i.id href FROM fin_invoice_payments t JOIN fin_invoices i ON i.id=t.invoice_id ${joins} WHERE i.status!='void' AND ${paymentDate} BETWEEN @from AND @to
    UNION ALL SELECT 'expense',e.id,e.date,coalesce(e.vendor,'Expense'),e.amount_cents,coalesce(p.site,'unassigned'),'/finance/expenses?expense='||e.id FROM fin_expenses e LEFT JOIN projects p ON p.id=e.project_id WHERE e.deleted_at IS NULL AND e.date BETWEEN @from AND @to
    UNION ALL SELECT 'outstanding',i.id,i.due_date,i.number,max(0,i.total_cents-coalesce(i.retainage_cents,0)-i.paid_cents),${invoiceSite},'/finance/invoices?invoice='||i.id FROM fin_invoices i ${joins} WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue')
  ), scoped AS (SELECT * FROM records WHERE @site='all' OR site=@site)`;
  const params={from,to,site};
  const sums=sqlite.prepare(cte+" SELECT coalesce(sum(CASE WHEN kind='paid' THEN amountCents ELSE 0 END),0) paidCents,coalesce(sum(CASE WHEN kind='expense' THEN amountCents ELSE 0 END),0) expensesCents,coalesce(sum(CASE WHEN kind='outstanding' THEN amountCents ELSE 0 END),0) outstandingCents FROM scoped").get(params) as any;
  const filtered=" FROM scoped WHERE (@kind='all' OR kind=@kind OR (@kind='cash' AND kind!='outstanding')) AND instr(lower(label),lower(@search))>0";
  const filterParams={...params,kind,search};
  const total=(sqlite.prepare(cte+' SELECT count(*) total'+filtered).get(filterParams) as any).total;
  const rows=sqlite.prepare(cte+' SELECT *'+filtered+" ORDER BY coalesce(date,'') DESC,id DESC,kind LIMIT @limit OFFSET @offset").all({...filterParams,limit,offset:page*limit});
  res.json({from,to,site,...sums,cashDifferenceCents:sums.paidCents-sums.expensesCents,rows,total,page,limit});
 });
}
