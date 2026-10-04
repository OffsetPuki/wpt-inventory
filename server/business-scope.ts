import type {Request} from 'express';
import {BUSINESSES} from '../shared/business.js';
export function businessScope(req:Pick<Request,'query'>,expression:string){const site=String(req.query.site||'all');if(site==='all')return '1=1';if(site!=='unassigned'&&!Object.hasOwn(BUSINESSES,site))return '0=1';return "coalesce("+expression+",'unassigned')='"+site+"'";}
export const invoiceBusiness="(SELECT coalesce(p.site,l.site,CASE WHEN json_valid(q.payload) THEN coalesce(json_extract(q.payload,'$.business'),CASE q.type WHEN 'concrete' THEN 'concrete' WHEN 'insulation' THEN 'insulation' ELSE 'metals' END) END,'unassigned') FROM fin_invoices si LEFT JOIN projects p ON p.id=si.project_id LEFT JOIN crm_leads l ON l.id=si.lead_id LEFT JOIN quotes q ON q.id=si.quote_id WHERE si.id=fin_invoices.id)";
export const expenseBusiness="(SELECT site FROM projects WHERE id=fin_expenses.project_id)";
export const taskBusiness="coalesce((SELECT site FROM projects WHERE id=pm_tasks.project_id),(SELECT site FROM crm_leads WHERE id=pm_tasks.lead_id))";
