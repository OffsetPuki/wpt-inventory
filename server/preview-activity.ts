import {visitorContext,deviceDetails} from './visitor-context';
import { z } from 'zod';
import { sqlite } from './storage';

const count=z.number().int().min(0).max(10000);
const milliseconds=z.number().int().min(0).max(28800000);
const variant=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),views:count,activeMs:milliseconds,loads:count,loadMs:milliseconds,errors:count,gateOpens:count,gateCloses:count,drags:count,zooms:count}).strict();
const payload=z.object({visitId:z.string().uuid(),version:z.number().int().positive(),seq:z.number().int().min(1).max(100000),activeMs:milliseconds,
  variants:z.array(variant).max(6),links:z.object({main:count,concrete:count,insulation:count,phone:count,email:count}).strict(),
  webglFailed:count,contextLost:count,
}).strict();

sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_preview_visits (
 preview_id INTEGER NOT NULL REFERENCES customer_previews(id), visit_id TEXT NOT NULL,
 version INTEGER NOT NULL, started_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
 seq INTEGER NOT NULL, active_ms INTEGER NOT NULL, device TEXT NOT NULL, browser TEXT NOT NULL,
 snapshot TEXT NOT NULL, PRIMARY KEY(preview_id,visit_id)
);
CREATE INDEX IF NOT EXISTS customer_preview_visits_recent ON customer_preview_visits(preview_id,started_at DESC);`);

export function savePreviewActivity(preview:{id:number;version:number},body:unknown,ua:string,context?:Awaited<ReturnType<typeof visitorContext>>) {
  const parsed=payload.safeParse(body);
  if(!parsed.success)return 400;
  const data=parsed.data,now=Date.now();
  if(data.variants.reduce((sum,v)=>sum+v.activeMs,0)>data.activeMs+6)return 400;
  return sqlite.transaction(()=>{
    const old=sqlite.prepare('SELECT * FROM customer_preview_visits WHERE preview_id=? AND visit_id=?').get(preview.id,data.visitId) as any;
    if(old && old.version!==data.version)return 409;
    if(old && old.seq>=data.seq)return 200;
    if(old && now-old.started_at>86400000)return 410;
    if(!old && data.version!==preview.version)return 409;
    if(!old && (sqlite.prepare('SELECT count(*) n FROM customer_preview_visits WHERE preview_id=? AND started_at>?').get(preview.id,now-86400000) as any).n>=2000)return 429;
    const previous=old?JSON.parse(old.snapshot):null;
    const options=previous?.variants || sqlite.prepare('SELECT id,label FROM customer_preview_models WHERE preview_id=?').all(preview.id) as any[];
    if(new Set(data.variants.map(v=>v.id)).size!==data.variants.length || data.variants.some(v=>!options.some((o:any)=>o.id===v.id)))return 400;
    const elapsedBudget=Math.min(28800000,now-(old?.started_at||now)+60000);
    const activeMs=Math.max(old?.active_ms||0,Math.min(data.activeMs,elapsedBudget));
    const variants=options.map((o:any)=>{
      const incoming=data.variants.find(v=>v.id===o.id);
      const row:any={id:o.id,label:o.label};
      for(const name of ['views','activeMs','loads','loadMs','errors','gateOpens','gateCloses','drags','zooms'])row[name]=Math.max(o[name]||0,(incoming as any)?.[name]||0);
      return row;
    });
    // Bound delayed first reports without losing a visit after an offline period.
    const oldVariantTime=options.reduce((sum:number,o:any)=>sum+(o.activeMs||0),0);
    const extra=variants.reduce((sum:number,v:any,i:number)=>sum+v.activeMs-(options[i].activeMs||0),0);
    const scale=extra?Math.min(1,Math.max(0,activeMs-oldVariantTime)/extra):1;
    variants.forEach((v:any,i:number)=>{const prior=options[i].activeMs||0;v.activeMs=prior+Math.floor((v.activeMs-prior)*scale);});
    const links=Object.fromEntries(Object.entries(data.links).map(([key,value])=>[key,Math.max(value,previous?.links[key]||0)]));
    const snapshot={deviceName:previous?.deviceName||context?.deviceName||deviceDetails(ua).deviceName,os:previous?.os||context?.os||deviceDetails(ua).os,location:previous?previous.location??null:context?.location??null,variants,links,webglFailed:Math.max(data.webglFailed,previous?.webglFailed||0),contextLost:Math.max(data.contextLost,previous?.contextLost||0)};
    const device=old||deviceDetails(ua);
    sqlite.prepare(`INSERT INTO customer_preview_visits(preview_id,visit_id,version,started_at,last_at,seq,active_ms,device,browser,snapshot)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(preview_id,visit_id) DO UPDATE SET last_at=excluded.last_at,seq=excluded.seq,active_ms=excluded.active_ms,snapshot=excluded.snapshot`)
      .run(preview.id,data.visitId,data.version,old?.started_at||now,now,data.seq,activeMs,device.device,device.browser,JSON.stringify(snapshot));
    return old?200:201;
  })();
}

export function previewActivity(id:number) {
  const summary=sqlite.prepare(`SELECT count(*) visits,coalesce(sum(active_ms),0) activeMs,min(started_at) firstVisit,max(last_at) lastVisit,
    coalesce(sum(json_extract(snapshot,'$.webglFailed')),0) webglFailed,coalesce(sum(json_extract(snapshot,'$.contextLost')),0) contextLost
    FROM customer_preview_visits WHERE preview_id=?`).get(id) as any;
  const variants=sqlite.prepare(`SELECT json_extract(v.value,'$.id') id,json_extract(v.value,'$.label') label,p.version,
    sum(json_extract(v.value,'$.views')) views,sum(json_extract(v.value,'$.activeMs')) activeMs,
    sum(json_extract(v.value,'$.loads')) loads,sum(json_extract(v.value,'$.loadMs')) loadMs,sum(json_extract(v.value,'$.errors')) errors,
    sum(json_extract(v.value,'$.gateOpens')) gateOpens,sum(json_extract(v.value,'$.gateCloses')) gateCloses,
    sum(json_extract(v.value,'$.drags')) drags,sum(json_extract(v.value,'$.zooms')) zooms
    FROM customer_preview_visits p,json_each(p.snapshot,'$.variants') v WHERE p.preview_id=? GROUP BY p.version,id,label ORDER BY p.version DESC,activeMs DESC`).all(id);
  const links=sqlite.prepare(`SELECT l.key name,sum(l.value) clicks FROM customer_preview_visits p,json_each(p.snapshot,'$.links') l WHERE p.preview_id=? GROUP BY l.key`).all(id);
  const devices=sqlite.prepare(`SELECT device,browser,coalesce(json_extract(snapshot,'$.deviceName'),device) deviceName,count(*) visits FROM customer_preview_visits WHERE preview_id=? GROUP BY device,browser,deviceName ORDER BY visits DESC`).all(id);
  const visits=sqlite.prepare('SELECT visit_id id,version,started_at startedAt,last_at lastAt,active_ms activeMs,device,browser,snapshot FROM customer_preview_visits WHERE preview_id=? ORDER BY started_at DESC LIMIT 100').all(id).map((r:any)=>{const {snapshot,...rest}=r;return {...rest,...JSON.parse(snapshot)};});
  const responses=sqlite.prepare("SELECT count(*) total,sum(CASE WHEN kind='approval' THEN 1 ELSE 0 END) acceptances FROM customer_preview_feedback WHERE preview_id=?").get(id) as any;
  return {summary:{...summary,feedback:responses.total-(responses.acceptances||0),acceptances:responses.acceptances||0},variants,links,devices,visits};
}
