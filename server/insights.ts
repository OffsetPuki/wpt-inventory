import type {Express, Request} from 'express';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {todayLocal} from './http-util';
import {payrollDate, payrollRange} from './payroll';
import {BUSINESSES} from '../shared/business.js';
import {INSIGHT_AREAS, type InsightArea, type InsightChart, type InsightUnit, type InsightRow} from '../shared/insights';

type Spec = {id:string; title:string; description:string; unit:InsightUnit; sql:string; snapshot?:boolean; chronological?:boolean};
type Params = {from:string; to:string; today:string; site:string; start:number; end:number};
const scope=(expression:string)=>`(@site='all' OR coalesce(${expression},'unassigned')=@site)`;
export const quoteSite="coalesce((SELECT site FROM crm_leads WHERE id=q.lead_id),CASE WHEN json_valid(q.payload) THEN json_extract(q.payload,'$.business') END,CASE q.type WHEN 'concrete' THEN 'concrete' WHEN 'insulation' THEN 'insulation' ELSE 'metals' END)";
const invJoins='LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN crm_leads l ON l.id=i.lead_id LEFT JOIN quotes q ON q.id=i.quote_id';
const invSite=`coalesce(p.site,l.site,CASE WHEN q.id IS NOT NULL THEN ${quoteSite} END)`;
const localDate=(column:string)=>`date(${column}/1000,'unixepoch','localtime')`;
const selected=(date:string)=>`${date} BETWEEN @from AND @to`;
const invoiceDue="max(0,i.total_cents-coalesce(i.retainage_cents,0)-i.paid_cents)";
const age="CAST(julianday(@today)-julianday(i.due_date) AS INTEGER)";
const aging=`CASE WHEN nullif(i.due_date,'') IS NULL THEN 'No due date' WHEN i.due_date>=@today THEN 'Current' WHEN ${age}<=30 THEN '1–30 days overdue' WHEN ${age}<=60 THEN '31–60 days overdue' ELSE '61+ days overdue' END`;
const outstanding=`SELECT CAST(i.id AS TEXT) id,i.number label,i.due_date date,${invoiceDue} value,'USD' unit,'/finance/invoices?invoice='||i.id href,${aging} groupKey,${aging} groupLabel FROM fin_invoices i ${invJoins} WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial','overdue') AND ${invoiceDue}>0 AND ${scope(invSite)}`;
const payDate=`coalesce(nullif(t.paid_at,''),${localDate('t.created_at')})`;
const payments=`SELECT CAST(t.id AS TEXT) id,i.number label,${payDate} date,t.amount_cents value,'USD' unit,'/finance/invoices?invoice='||i.id href FROM fin_invoice_payments t JOIN fin_invoices i ON i.id=t.invoice_id ${invJoins} WHERE i.status!='void' AND ${selected(payDate)} AND ${scope(invSite)}`;
const expenses=`SELECT CAST(e.id AS TEXT) id,coalesce(nullif(e.vendor,''),'Expense') label,e.date date,e.amount_cents value,'USD' unit,'/finance/expenses?expense='||e.id href,e.category category FROM fin_expenses e LEFT JOIN projects p ON p.id=e.project_id WHERE e.deleted_at IS NULL AND ${selected('e.date')} AND ${scope('p.site')}`;
// Relative week keys align equal-length comparison periods, including across year boundaries.
const weekKey="CAST((julianday(date)-julianday(@from))/7 AS INTEGER)";
const trend=(base:string,kind:string)=>`SELECT id,label,date,value,unit,href, '${kind}:'||${weekKey} groupKey,'${kind} · '||date(@from,'+'||(${weekKey}*7)||' days') groupLabel FROM (${base})`;
const cash:Spec={id:'cash',title:'Cash received & recorded expenses',description:'Weekly totals within the selected dates. Cash received includes tax. Expenses are recorded costs; the difference is not profit.',unit:'money',sql:trend(payments,'Received')+' UNION ALL '+trend(expenses,'Expenses'),chronological:true};
const receivables:Spec={id:'aging',title:'Money to collect',description:'Current unpaid balances, excluding drafts and held retainage. Click an age group to see its invoices.',unit:'money',snapshot:true,sql:outstanding};
const spending:Spec={id:'categories',title:'Where spending goes',description:'Recorded expenses by category. Compare with the preceding period to see what changed.',unit:'money',sql:`SELECT *,category groupKey,replace(category,'_',' ') groupLabel FROM (${expenses})`};

function specs(area:InsightArea):Spec[]{
 const leads=`FROM crm_leads l WHERE l.deleted_at IS NULL AND ${scope('l.site')}`;
 const qAge=`CASE WHEN q.sent_at IS NULL THEN 'Send date missing' WHEN julianday(@today)-julianday(${localDate('q.sent_at')})<=7 THEN '0–7 days' WHEN julianday(@today)-julianday(${localDate('q.sent_at')})<=14 THEN '8–14 days' ELSE '15+ days' END`;
 const waiting:Spec={id:'waiting',title:'Quotes waiting for a reply',description:'Currently sent quotes, aged from their send date. Pending quotes are not lost sales.',unit:'count',snapshot:true,sql:`SELECT CAST(q.id AS TEXT) id,q.number||' · '||coalesce(q.customer_name,'Customer') label,${localDate('q.sent_at')} date,1 value,'quotes' unit,'/crm/quotes?quote='||q.id href,${qAge} groupKey,${qAge} groupLabel FROM quotes q WHERE q.deleted_at IS NULL AND q.status='sent' AND ${scope(quoteSite)}`};
 const stages:Spec={id:'stages',title:'Leads by current stage',description:'Current lead counts, not a conversion funnel. Click a stage to work through its leads.',unit:'count',snapshot:true,sql:`SELECT CAST(l.id AS TEXT) id,l.name label,${localDate('l.created_at')} date,1 value,'leads' unit,'/crm/leads?lead='||l.id href,l.stage groupKey,replace(l.stage,'_',' ') groupLabel ${leads}`};
 const taskScope=scope('coalesce(p.site,l.site)');
 const taskFrom=`FROM pm_tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN crm_leads l ON l.id=t.lead_id LEFT JOIN users u ON u.id=t.assignee_id WHERE t.deleted_at IS NULL AND ${taskScope}`;
 const timeScope=scope("coalesce(p.site,(SELECT site FROM crm_leads WHERE id=k.lead_id))");
 const timeFrom=`FROM pm_time_entries t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN pm_tasks k ON k.id=t.task_id LEFT JOIN users u ON u.id=t.user_id WHERE t.ended_at IS NOT NULL AND t.started_at<@end AND t.ended_at>@start AND ${timeScope}`;
 const hours='(t.duration_min/60.0)*max(0,min(t.ended_at,@end)-max(t.started_at,@start))/max(1,t.ended_at-t.started_at)';
 const timeBase=`SELECT CAST(t.id AS TEXT) id,coalesce(u.name,'Unassigned')||' · '||coalesce(p.name,t.description,'Time entry') label,${localDate('t.started_at')} date,${hours} value,'hours' unit,'/pm/time?projectId='||coalesce(t.project_id,'')||'&userId='||t.user_id||'&from='||${localDate('t.started_at')}||'&to='||${localDate('t.ended_at')} href,coalesce(p.name,'Unassigned job') job,coalesce(p.id,0) jobId,coalesce(u.name,'Unassigned') person,t.user_id personId,t.billable,t.invoice_id ${timeFrom}`;
 if(area==='today')return[cash,{id:'attention',title:'Needs your attention',description:'Current overdue invoices, overdue unfinished tasks and leads waiting for follow-up. Each bar opens its complete list.',unit:'count',snapshot:true,sql:`SELECT id,label,date,1 value,'invoices' unit,href,'invoices' groupKey,'Overdue invoices' groupLabel FROM (${outstanding}) WHERE date<@today UNION ALL SELECT CAST(t.id AS TEXT),t.title,t.due_date,1,'tasks','/pm/board?task='||t.id,'tasks','Overdue tasks' ${taskFrom} AND t.status!='done' AND t.due_date<@today UNION ALL SELECT CAST(l.id AS TEXT),l.name,${localDate('l.created_at')},1,'leads','/crm/leads?lead='||l.id,'leads','Leads in follow-up' ${leads} AND l.stage='follow_up'`}];
 if(area==='finance')return[cash,receivables,spending];
 if(area==='invoices')return[receivables,{id:'upcoming',title:'Invoices due in the next 30 days',description:'Expected due amounts, not guaranteed future cash. Current unpaid balances only.',unit:'money',snapshot:true,sql:`SELECT id,label,date,value,unit,href,date groupKey,date groupLabel FROM (${outstanding}) WHERE date BETWEEN @today AND date(@today,'+30 days')`,chronological:true}];
 if(area==='expenses')return[spending,{...cash,id:'trend',title:'Spending over time',description:'Weekly recorded expenses, with an optional preceding-period comparison.',sql:trend(expenses,'Expenses')},{id:'vendors',title:'Spending by supplier',description:'Recorded expenses grouped by vendor. Unnamed vendors remain visible.',unit:'money',sql:`SELECT *,lower(label) groupKey,label groupLabel FROM (${expenses})`}];
 if(area==='sales')return[waiting,stages,{id:'accepted',title:'Accepted quote value',description:'Value of quotes accepted during the selected dates. This is contract value, not money received.',unit:'money',chronological:true,sql:trend(`SELECT CAST(q.id AS TEXT) id,q.number||' · '||coalesce(q.customer_name,'Customer') label,${localDate('q.accepted_at')} date,q.total_cents value,'USD' unit,'/crm/quotes?quote='||q.id href FROM quotes q WHERE q.deleted_at IS NULL AND q.status='accepted' AND ${selected(localDate('q.accepted_at'))} AND ${scope(quoteSite)}`,'Accepted')},{id:'sources',title:'Where new leads come from',description:'Leads created in the selected dates, grouped by source.',unit:'count',sql:`SELECT CAST(l.id AS TEXT) id,l.name label,${localDate('l.created_at')} date,1 value,'leads' unit,'/crm/leads?lead='||l.id href,l.source groupKey,replace(l.source,'_',' ') groupLabel ${leads} AND ${selected(localDate('l.created_at'))}`}];
 if(area==='jobs')return[{id:'status',title:'Jobs by status',description:'Current job counts. Open a job to inspect its readiness, costs and billing.',unit:'count',snapshot:true,sql:`SELECT CAST(p.id AS TEXT) id,p.job_number||' · '||p.name label,p.due_date date,1 value,'jobs' unit,'/project/'||p.id href,p.status groupKey,p.status groupLabel FROM projects p WHERE p.deleted_at IS NULL AND ${scope('p.site')}`},{id:'tasks',title:'Work remaining by job',description:'Current unfinished tasks. Expand a job’s bar to inspect each task.',unit:'count',snapshot:true,sql:`SELECT CAST(t.id AS TEXT) id,t.title label,t.due_date date,1 value,'tasks' unit,'/pm/board?task='||t.id href,CAST(coalesce(p.id,0) AS TEXT) groupKey,coalesce(p.name,'Unassigned job') groupLabel ${taskFrom} AND t.status!='done'`}];
 if(area==='schedule'||area==='time')return[{id:'planned',title:'Planned hours by job',description:'Estimates for tasks due in this period. Tasks without estimates appear separately; these are not daily capacity forecasts.',unit:'hours',sql:`SELECT CAST(t.id AS TEXT) id,t.title label,t.due_date date,coalesce(t.estimate_hours,0) value,'hours' unit,'/pm/board?task='||t.id href,CAST(coalesce(p.id,0) AS TEXT) groupKey,coalesce(p.name,'Unassigned job') groupLabel ${taskFrom} AND ${selected('t.due_date')}`},{id:'logged',title:'Logged hours by job',description:'Completed time entries overlapping this period, prorated at its boundaries. Running timers are excluded.',unit:'hours',sql:`SELECT *,CAST(jobId AS TEXT) groupKey,job groupLabel FROM (${timeBase})`},{id:'crew',title:'Logged hours by person',description:'Recorded time for planning and cost review. Hours alone do not measure performance or available capacity.',unit:'hours',sql:`SELECT *,CAST(personId AS TEXT) groupKey,person groupLabel FROM (${timeBase})`},{id:'billable',title:'Hours awaiting billing',description:'Billable versus non-billable time in this period. Assigned to an invoice includes draft invoices.',unit:'hours',sql:`SELECT *,CASE WHEN billable=0 THEN 'Non-billable' WHEN invoice_id IS NULL THEN 'Billable · not invoiced' ELSE 'Assigned to invoice' END groupKey,CASE WHEN billable=0 THEN 'Non-billable' WHEN invoice_id IS NULL THEN 'Billable · not invoiced' ELSE 'Assigned to invoice' END groupLabel FROM (${timeBase})`},{id:'missing',title:'Tasks missing planning details',description:'Current unfinished tasks without dates or hour estimates. Add these details before relying on workload totals.',unit:'count',snapshot:true,sql:`SELECT CAST(t.id AS TEXT) id,t.title label,t.due_date date,1 value,'tasks' unit,'/pm/board?task='||t.id href,CASE WHEN t.due_date IS NULL THEN 'Missing due date' ELSE 'Missing hour estimate' END groupKey,CASE WHEN t.due_date IS NULL THEN 'Missing due date' ELSE 'Missing hour estimate' END groupLabel ${taskFrom} AND t.status!='done' AND (t.due_date IS NULL OR t.estimate_hours IS NULL)`}];
 if(area==='inventory'){
  // Stock is shared across businesses; scoped views only include items linked to that business's jobs.
  const itemScope=`(@site='all' OR EXISTS(SELECT 1 FROM project_checklist c JOIN projects p ON p.id=c.project_id WHERE c.item_id=i.id AND p.deleted_at IS NULL AND ${scope('p.site')}) OR EXISTS(SELECT 1 FROM transactions t JOIN projects p ON p.id=t.project_id WHERE t.item_id=i.id AND ${scope('p.site')}))`;
  const base=`FROM items i WHERE i.deleted_at IS NULL AND ${itemScope}`;
  const stock=(metric:string,value:string,where='')=>`SELECT CAST(i.id AS TEXT) id,i.name label,NULL date,${value} value,i.unit unit,'/item/'||i.id href,CAST(i.id AS TEXT)||':${metric}' groupKey,i.name||' · ${metric}' groupLabel ${base} ${where}`;
  return[{id:'stock',title:'Available & reserved stock',description:'Shared stock for relevant items. Quantities use each item’s own unit; bars compare only matching units.',unit:'quantity',snapshot:true,sql:stock('available','max(0,i.quantity-i.quantity_reserved)')+' UNION ALL '+stock('reserved','i.quantity_reserved')},{id:'shortage',title:'Stock needing replenishment',description:'Amount needed to cover reservations and restore available stock to the reorder target or low-stock threshold. Units stay separate.',unit:'quantity',snapshot:true,sql:stock('needed','max(i.reorder_target,i.low_stock_threshold)+i.quantity_reserved-i.quantity', 'AND i.quantity<max(i.reorder_target,i.low_stock_threshold)+i.quantity_reserved')},{id:'usage',title:'Materials used on jobs',description:'Recorded use during the selected period, grouped by item and unit. Returns are shown separately in the item history.',unit:'quantity',sql:`SELECT CAST(t.id AS TEXT) id,i.name||' · '||coalesce(p.name,'Unassigned job') label,${localDate('t.created_at')} date,t.quantity value,i.unit unit,'/item/'||i.id href,CAST(i.id AS TEXT) groupKey,i.name groupLabel FROM transactions t JOIN items i ON i.id=t.item_id LEFT JOIN projects p ON p.id=t.project_id WHERE t.type='check_out' AND NOT (i.item_type='tool' OR (i.item_type='stock' AND i.category='tools')) AND ${selected(localDate('t.created_at'))} AND ${scope('p.site')}`}];
 }
 if(area==='purchasing'){
  const poSite="coalesce(p.site,CASE WHEN json_valid(o.details) THEN json_extract(o.details,'$.business') END)";
  const orders=`FROM fin_purchase_orders o LEFT JOIN projects p ON p.id=o.project_id WHERE o.deleted_at IS NULL AND o.order_type='supplier' AND o.status NOT IN ('draft','review','cancelled') AND ${scope(poSite)}`;
  const lines=`SELECT o.id,o.number,o.vendor,${localDate('o.created_at')} date,o.expected_date,json_extract(j.value,'$.qty') ordered,CASE WHEN o.status IN ('received','closed') THEN json_extract(j.value,'$.qty') ELSE coalesce((SELECT sum(r.quantity) FROM inventory_receipts r WHERE r.po_id=o.id AND r.line_index=j.key),0) END received,coalesce(nullif(trim(json_extract(j.value,'$.unit')),''),'unit not recorded · '||o.number||' line '||(CAST(j.key AS INTEGER)+1)) unit FROM fin_purchase_orders o LEFT JOIN projects p ON p.id=o.project_id JOIN json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j WHERE o.deleted_at IS NULL AND o.order_type='supplier' AND o.status NOT IN ('draft','review','cancelled') AND ${scope(poSite)} AND ${selected(localDate('o.created_at'))}`;
  const lineSeries=(key:string,value:string)=>`SELECT CAST(id AS TEXT) id,number||' · '||vendor label,date,${value} value,unit,'/finance/purchase-orders?po='||id href,'${key}:'||unit groupKey,'${key}' groupLabel FROM (${lines})`;
  return[{id:'receiving',title:'Supplier orders & receipts',description:'Quantities from supplier orders created in this period, with receipts as of today. Units are separate; lines without a recorded unit stay separate. Customer POs are excluded.',unit:'quantity',snapshot:true,sql:lineSeries('Ordered','ordered')+' UNION ALL '+lineSeries('Received','min(ordered,received)')+' UNION ALL '+lineSeries('Still needed','max(0,ordered-received)')},{id:'late',title:'Deliveries needing attention',description:'Open supplier orders grouped by expected date. Orders with no delivery date remain visible.',unit:'count',snapshot:true,sql:`SELECT CAST(o.id AS TEXT) id,o.number||' · '||o.vendor label,o.expected_date date,1 value,'orders' unit,'/finance/purchase-orders?po='||o.id href,CASE WHEN nullif(o.expected_date,'') IS NULL THEN 'No expected date' WHEN o.expected_date<@today THEN 'Overdue' ELSE 'Upcoming' END groupKey,CASE WHEN nullif(o.expected_date,'') IS NULL THEN 'No expected date' WHEN o.expected_date<@today THEN 'Overdue' ELSE 'Upcoming' END groupLabel ${orders} AND o.status NOT IN ('received','closed')`}];
 }
 // Closed snapshots preserve the exact posted payroll values. Premium is the additional overtime
 // amount, not the entire pay for overtime hours. Payroll has no reliable business allocation.
 const runs=`SELECT r.id,r.from_date,r.to_date,r.total_cents,coalesce((SELECT sum(json_extract(j.value,'$.overtimeCents')) FROM json_each(CASE WHEN json_valid(r.snapshot) THEN r.snapshot ELSE '[]' END) j),0) premium FROM hr_payroll_runs r WHERE ${selected('r.to_date')}`;
 const runSeries=(name:string,value:string)=>`SELECT CAST(id AS TEXT) id,from_date||' to '||to_date label,to_date date,${value} value,'USD' unit,'/hr/payroll?from='||from_date||'&to='||to_date href,'${name}:'||to_date||':'||id groupKey,from_date||' to '||to_date||' · ${name}' groupLabel FROM (${runs})`;
 return[{id:'payroll',title:'Closed payroll costs',description:'Company-wide closed payroll, included by period end date. Base pay includes ordinary pay for overtime hours; premium is the extra overtime amount.',unit:'money',snapshot:true,chronological:true,sql:runSeries('Base pay','total_cents-premium')+' UNION ALL '+runSeries('Overtime premium','premium')}];
}

function dateOffset(date:string,days:number){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function insightRange(query:Request['query']){
 const today=todayLocal(),from=String(query.from||today.slice(0,7)+'-01'),to=String(query.to||today),site=String(query.site||'all');
 payrollDate(from);payrollDate(to);
 const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 if(days<1||days>366||!['all','unassigned',...Object.keys(BUSINESSES)].includes(site))throw new Error('Choose a valid business and a date range of up to one year.');
 return {from,to,site,today,previousFrom:dateOffset(from,-days),previousTo:dateOffset(from,-1)};
}
function params(from:string,to:string,site:string,today:string):Params {return {from,to,site,today,...payrollRange(from,to)};}
function grouped(spec:Spec,p:Params){return sqlite.prepare(`SELECT groupKey key,groupLabel label,sum(value) value,count(*) count,unit FROM (${spec.sql}) GROUP BY groupKey,unit ORDER BY ${spec.chronological?'min(date),groupKey':'sum(value) DESC,groupKey'},unit`).all(p) as Omit<InsightRow,'previous'>[];}

export function registerInsightRoutes(app:Express){
 app.get('/api/insights/:area',requireElevated,(req,res)=>{
  const area=String(req.params.area) as InsightArea;
  if(!INSIGHT_AREAS.includes(area))return res.status(404).json({message:'Report not found.'});
  let range:ReturnType<typeof insightRange>;
  try{range=insightRange(req.query);}catch{return res.status(400).json({message:'Choose valid dates (up to one year) and a business.'});}
  const {from,to,site,today,previousFrom,previousTo}=range;
  if(area==='payroll'&&site!=='all')return res.status(400).json({message:'Payroll is company-wide. Select All businesses to view closed payroll costs.'});
  const definitions=specs(area),p=params(from,to,site,today);
  if(area==='sales')[definitions[1],definitions[2]]=[definitions[2],definitions[1]];
  const detail=String(req.query.chart||'');
  if(detail){
   const spec=definitions.find(s=>s.id===detail);if(!spec)return res.status(400).json({message:'Choose a valid chart.'});
   const group=String(req.query.group??''),unit=String(req.query.unit??'');
   const page=Math.max(0,Math.min(100000,Math.trunc(Number(req.query.page)||0))),limit=25;
   const where=group?' WHERE groupKey=@group AND unit=@unit':'';
   if(req.query.format==='csv'){
    const args={...p,group,unit};
    const total=(sqlite.prepare(`SELECT count(*) n FROM (${spec.sql})${where}`).get(args) as {n:number}).n;
    if(total>50000)return res.status(422).json({message:'This export exceeds 50,000 records. Choose a smaller date range or a single group.'});
    const cell=(v:unknown)=>'"'+String(v??'').replace(/^\s*[=+@-]/,"'$&").replaceAll('"','""')+'"';
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${area}-${spec.id}-${from}-${to}.csv"`);
    res.write('\uFEFF'+['Record','Date','Value','Unit','Business filter','From','To','As of','Link'].map(cell).join(',')+'\r\n');
    for(const row of sqlite.prepare(`SELECT id,label,date,value,unit,href FROM (${spec.sql})${where} ORDER BY date DESC,label,id`).iterate(args) as Iterable<{label:string;date:string;value:number;unit:string;href:string}>){
     res.write([row.label,row.date,spec.unit==='money'?row.value/100:row.value,row.unit,site,from,to,today,row.href].map(cell).join(',')+'\r\n');
    }
    return res.end();
   }
   const result=sqlite.transaction(()=>{
    const args={...p,group,unit};
    const total=(sqlite.prepare(`SELECT count(*) n FROM (${spec.sql})${where}`).get(args) as {n:number}).n;
    const rows=sqlite.prepare(`SELECT id,label,date,value,unit,href FROM (${spec.sql})${where} ORDER BY date DESC,label,id LIMIT @limit OFFSET @offset`).all({...args,limit,offset:page*limit});
    return {rows,total,page,limit,title:spec.title,unit:spec.unit};
   })();return res.json(result);
  }
  const compare=req.query.compare==='1';
  const charts=sqlite.transaction(()=>definitions.map(spec=>{
   const rows=grouped(spec,p),previous=compare&&!spec.snapshot?grouped(spec,params(previousFrom,previousTo,site,today)):null;
   const prior=new Map(previous?.map(r=>[r.key+'\0'+r.unit,r.value]));
   const currentKeys=new Set(rows.map(r=>r.key+'\0'+r.unit));
   // Retain previous-only categories so a drop to zero is visible.
   for(const old of previous||[])if(!currentKeys.has(old.key+'\0'+old.unit)){
    const match=/^(Received|Expenses|Accepted):(\d+)$/.exec(old.key);
    rows.push({...old,label:match?`${match[1]} · ${dateOffset(from,Number(match[2])*7)}`:old.label,value:0,count:0});
   }
   const result:InsightChart={id:spec.id,title:spec.title,description:spec.description,unit:spec.unit,snapshot:!!spec.snapshot,rows:rows.slice(0,24).map(r=>({...r,previous:previous?(prior.get(r.key+'\0'+r.unit)||0):null})),total:rows.reduce((n,r)=>n+r.value,0),groups:rows.length,previousTotal:previous?previous.reduce((n,r)=>n+r.value,0):null};
   if(spec.id==='cash'){
    const difference=(values:typeof rows)=>values.reduce((n,r)=>n+(r.key.startsWith('Expenses:')?-r.value:r.value),0);
    result.total=difference(rows);result.previousTotal=previous?difference(previous):null;result.totalLabel='Cash difference';
   }
   return result;
  }))();
  const notes=area==='inventory'?['Inventory is shared across businesses. A business filter limits items to its linked jobs; stock balances still represent the shared store.']:area==='payroll'?['Only closed payroll is shown here. Use the worksheet below to inspect an open period. Payroll is company-wide and is not allocated to businesses.']:[];
  res.json({from,to,site,asOf:today,previousFrom,previousTo,charts,notes});
 });
}
