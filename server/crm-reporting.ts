import type {Request} from 'express';
import {sqlite} from './storage';
import {businessScope} from './business-scope';
import {quoteSite} from './insights';
import {LEAD_SITES} from '../shared/crm-schema';
const one=(sql:string,...args:unknown[])=>sqlite.prepare(sql).get(...args) as Record<string,number>;
export function crmStats(req:Request){
 const now=Date.now(),monthAgo=now-30*86400000,ls=businessScope(req,'l.site'),qs=businessScope(req,quoteSite);
 const counts=one(`SELECT sum(CASE WHEN stage NOT IN ('won','lost') THEN 1 ELSE 0 END) openLeads,sum(CASE WHEN stage NOT IN ('won','lost') THEN coalesce(estimated_value_cents,0) ELSE 0 END) pipelineValueCents,sum(CASE WHEN stage='won' THEN 1 ELSE 0 END) won,sum(CASE WHEN stage='lost' THEN 1 ELSE 0 END) lost,sum(CASE WHEN created_at>=? THEN 1 ELSE 0 END) leadsThisWeek FROM crm_leads l WHERE deleted_at IS NULL AND ${ls}`,now-7*86400000);
 const sent=one(`SELECT count(*) n FROM quotes q WHERE deleted_at IS NULL AND sent_at>=? AND ${qs}`,monthAgo).n;
 const accepted=one(`SELECT coalesce(sum(total_cents),0) n FROM quotes q WHERE deleted_at IS NULL AND status='accepted' AND accepted_at>=? AND ${qs}`,monthAgo).n;
 const leadsBySite:Record<string,number>=Object.fromEntries(LEAD_SITES.map(s=>[s,0]));
 for(const r of sqlite.prepare(`SELECT l.site,count(*) n FROM crm_leads l WHERE l.deleted_at IS NULL AND strftime('%Y-%m',l.created_at/1000,'unixepoch')=? AND ${ls} GROUP BY l.site`).all(new Date().toISOString().slice(0,7)) as {site:string;n:number}[])leadsBySite[r.site]=r.n;
 const topSource=sqlite.prepare(`SELECT source,count(*) count FROM crm_leads l WHERE deleted_at IS NULL AND created_at>=? AND ${ls} GROUP BY source ORDER BY count DESC,source LIMIT 1`).get(monthAgo)||null;
 return {openLeads:counts.openLeads||0,pipelineValueCents:counts.pipelineValueCents||0,leadsThisWeek:counts.leadsThisWeek||0,quotesSentLast30:sent,revenueClosed30dCents:accepted,closeRate:counts.won+counts.lost?counts.won/(counts.won+counts.lost):null,leadsBySite,topSource};
}
export function crmReports(req:Request){
 const now=new Date(),cutoff=new Date(now.getFullYear(),now.getMonth()-11,1).getTime(),ls=businessScope(req,'l.site'),qs=businessScope(req,quoteSite);
 return {
  monthlyRevenue:sqlite.prepare(`SELECT strftime('%Y-%m',accepted_at/1000,'unixepoch') month,sum(total_cents) revenueCents FROM quotes q WHERE deleted_at IS NULL AND status='accepted' AND accepted_at>=? AND ${qs} GROUP BY month ORDER BY month`).all(cutoff),
  monthlyLeads:sqlite.prepare(`SELECT strftime('%Y-%m',created_at/1000,'unixepoch') month,count(*) count FROM crm_leads l WHERE deleted_at IS NULL AND created_at>=? AND ${ls} GROUP BY month ORDER BY month`).all(cutoff),
  bySource:sqlite.prepare(`SELECT source,count(*) leads,sum(CASE WHEN stage='won' THEN 1 ELSE 0 END) won,sum(CASE WHEN stage='won' THEN coalesce(revenue_closed_cents,0) ELSE 0 END) revenueCents FROM crm_leads l WHERE deleted_at IS NULL AND ${ls} GROUP BY source ORDER BY leads DESC,source`).all(),
  byStage:sqlite.prepare(`SELECT stage,count(*) count,coalesce(sum(estimated_value_cents),0) valueCents FROM crm_leads l WHERE deleted_at IS NULL AND ${ls} GROUP BY stage`).all(),
  winLoss:sqlite.prepare(`SELECT win_loss_reason reason,count(*) count FROM crm_leads l WHERE deleted_at IS NULL AND stage='lost' AND win_loss_reason IS NOT NULL AND ${ls} GROUP BY reason ORDER BY count DESC,reason`).all(),
 };
}
