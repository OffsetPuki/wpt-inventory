// Shared terminology and relationship contracts used by the suite.
export const CUSTOMER_REFERENCE_TABLES = ['projects','crm_leads','pm_contracts','fin_invoices','mk_reviews','review_requests','customer_previews','fin_purchase_orders'] as const;
// This identically named column is an anonymous analytics visitor ID, not CRM identity.
export const NON_CUSTOMER_CLIENT_ID_TABLES = ['mk_lead_attribution'] as const;
export const JOB_STATUS_LABELS: Record<string,string> = {planned:'Planning',active:'Work in progress',in_progress:'Work in progress',on_hold:'On hold',done:'Completed',completed:'Completed'};
export function validateTaskDates(task:{startDate?:string|null;dueDate?:string|null}) {
  for(const date of [task.startDate,task.dueDate]) if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw new Error('Choose a valid calendar date.');
  if(task.startDate && task.dueDate && task.startDate>task.dueDate) throw new Error('The due date must be on or after the start date.');
}
export function validateTimeInterval(start:number,end:number|null|undefined,minutes:number) {
  if(!Number.isFinite(start)||Math.abs(start)>8640000000000000 || (end!=null && (!Number.isFinite(end)||Math.abs(end)>8640000000000000||end<start))) throw new Error('Choose a valid start and end time.');
  if(!Number.isSafeInteger(minutes)||minutes<0||minutes>1440 || (end!=null && end-start>86400000)) throw new Error('A time entry can cover up to 24 hours. Split longer work into daily entries.');
}
