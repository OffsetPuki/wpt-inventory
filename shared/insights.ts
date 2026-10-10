export const INSIGHT_AREAS = ['today','finance','invoices','sales','jobs','schedule','time','inventory','purchasing','expenses','payroll'] as const;
export type InsightArea = typeof INSIGHT_AREAS[number];
export type InsightUnit = 'money' | 'hours' | 'count' | 'quantity';
export interface InsightRow { key:string; label:string; value:number; count:number; unit:string; previous:number|null }
export interface InsightChart { id:string; title:string; description:string; unit:InsightUnit; snapshot:boolean; rows:InsightRow[]; total:number; totalLabel?:string; groups:number; previousTotal:number|null }
export interface InsightReport { from:string; to:string; previousFrom:string; previousTo:string; asOf:string; site:string; charts:InsightChart[]; notes:string[] }
export interface InsightRecord { id:string; label:string; date:string|null; value:number; unit:string; href:string }
export interface InsightDetail { rows:InsightRecord[]; total:number; page:number; limit:number; title:string; unit:InsightUnit }
