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
  const paid=sqlite.prepare(`SELECT 'paid' kind,t.id,${paymentDate} date,i.number label,t.amount_cents amountCents,${invoiceSite} site,'/finance/invoices?invoice='||i.id href FROM fin_invoice_payments t JOIN fin_invoices i ON i.id=t.invoice_id ${joins} WHERE i.status!='void' AND ${paymentDate} BETWEEN ? AND ?`).all(from,to);
  const expenses=sqlite.prepare("SELECT 'expense' kind,e.id,e.date,coalesce(e.vendor,'Expense') label,e.amount_cents amountCents,coalesce(p.site,'unassigned') site,'/finance/expenses?expense='||e.id href FROM fin_expenses e LEFT JOIN projects p ON p.id=e.project_id WHERE e.deleted_at IS NULL AND e.date BETWEEN ? AND ?").all(from,to);
  const outstanding=sqlite.prepare(`SELECT 'outstanding' kind,i.id,i.due_date date,i.number label,max(0,i.total_cents-coalesce(i.retainage_cents,0)-i.paid_cents) amountCents,${invoiceSite} site,'/finance/invoices?invoice='||i.id href FROM fin_invoices i ${joins} WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue')`).all();
  const rows=([...paid,...expenses,...outstanding] as any[]).filter(r=>site==='all'||r.site===site).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.id-a.id);
  const sum=(kind:string)=>rows.filter(r=>r.kind===kind).reduce((v,r)=>v+r.amountCents,0);
  res.json({from,to,site,paidCents:sum('paid'),expensesCents:sum('expense'),cashDifferenceCents:sum('paid')-sum('expense'),outstandingCents:sum('outstanding'),rows});
 });
}
