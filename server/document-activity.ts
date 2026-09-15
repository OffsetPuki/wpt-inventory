import {visitorContext} from './visitor-context';
import crypto from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireAuth,requireElevated} from './auth';
import {hasLeadKey} from './public-api';

type Kind='quote'|'invoice';
const kinds=['quote','invoice'];
const count=z.number().int().min(0).max(10000);
const fields=['print','attachment','accept','decline','pay','compare','phone','email','main','other'] as const;
const input=z.object({visitId:z.string().uuid(),revision:z.string().regex(/^[a-z0-9]{1,64}$/),seq:z.number().int().min(1).max(100000),activeMs:z.number().int().min(0).max(28800000),scrollPct:z.number().int().min(0).max(100),loadMs:z.number().int().min(0).max(300000),assetErrors:count,actionErrors:count,actions:z.object({print:count,attachment:count,accept:count,decline:count,pay:count,compare:count,phone:count,email:count,main:count,other:count}).strict()}).strict();
sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_document_visits (
 kind TEXT NOT NULL,document_id INTEGER NOT NULL,visit_id TEXT NOT NULL,revision TEXT NOT NULL,
 started_at INTEGER NOT NULL,last_at INTEGER NOT NULL,seq INTEGER NOT NULL,active_ms INTEGER NOT NULL,
 device TEXT NOT NULL,browser TEXT NOT NULL,snapshot TEXT NOT NULL,
 PRIMARY KEY(kind,document_id,visit_id)
);CREATE INDEX IF NOT EXISTS customer_document_visits_recent ON customer_document_visits(kind,document_id,started_at DESC);`);

export function documentActivityRevision(kind:Kind,row:any):string {
  if(kind==='quote')return String(row.version||1);
  const keys=['items','totalCents','taxRateBp','dueDate','customerNote','terms','discountCents','attachments'];
  const values=keys.map(k=>row[k]??row[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]??null);
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0,24);
}
function document(kind:Kind,by:'id'|'share_token',value:string|number){
  return sqlite.prepare(`SELECT * FROM ${kind==='quote'?'quotes':'fin_invoices'} WHERE ${by}=? AND deleted_at IS NULL`).get(value) as any;
}
function save(kind:Kind,row:any,body:unknown,context:Awaited<ReturnType<typeof visitorContext>>){
  const parsed=input.safeParse(body);if(!parsed.success)return 400;
  const data=parsed.data,now=Date.now();
  return sqlite.transaction(()=>{
    const old=sqlite.prepare('SELECT * FROM customer_document_visits WHERE kind=? AND document_id=? AND visit_id=?').get(kind,row.id,data.visitId) as any;
    if(old&&old.revision!==data.revision)return 409;
    if(old&&old.seq>=data.seq)return 200;
    if(old&&now-old.started_at>86400000)return 410;
    if(!old&&documentActivityRevision(kind,row)!==data.revision)return 409;
    if(!old&&(sqlite.prepare('SELECT count(*) n FROM customer_document_visits WHERE kind=? AND document_id=? AND started_at>?').get(kind,row.id,now-86400000) as any).n>=2000)return 429;
    const previous=old?JSON.parse(old.snapshot):null;
    const snapshot={deviceName:previous?.deviceName||context.deviceName,os:previous?.os||context.os,location:previous?previous.location??null:context.location,scrollPct:Math.max(data.scrollPct,previous?.scrollPct||0),loadMs:Math.max(data.loadMs,previous?.loadMs||0),assetErrors:Math.max(data.assetErrors,previous?.assetErrors||0),actionErrors:Math.max(data.actionErrors,previous?.actionErrors||0),actions:Object.fromEntries(fields.map(k=>[k,Math.max(data.actions[k],previous?.actions[k]||0)]))};
    const activeMs=Math.max(old?.active_ms||0,Math.min(data.activeMs,28800000,now-(old?.started_at||now)+60000));
    const device=old?.device||context.device,browser=old?.browser||context.browser;
    sqlite.prepare(`INSERT INTO customer_document_visits(kind,document_id,visit_id,revision,started_at,last_at,seq,active_ms,device,browser,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(kind,document_id,visit_id) DO UPDATE SET last_at=excluded.last_at,seq=excluded.seq,active_ms=excluded.active_ms,snapshot=excluded.snapshot`)
      .run(kind,row.id,data.visitId,data.revision,old?.started_at||now,now,data.seq,activeMs,device,browser,JSON.stringify(snapshot));
    return old?200:201;
  })();
}
function report(kind:Kind,row:any){
  const summary=sqlite.prepare(`SELECT count(*) visits,coalesce(sum(active_ms),0) activeMs,min(started_at) firstVisit,max(last_at) lastVisit,
    coalesce(avg(json_extract(snapshot,'$.loadMs')),0) averageLoadMs,coalesce(sum(json_extract(snapshot,'$.assetErrors')),0) assetErrors,
    coalesce(sum(json_extract(snapshot,'$.actionErrors')),0) actionErrors,coalesce(max(json_extract(snapshot,'$.scrollPct')),0) scrollPct
    FROM customer_document_visits WHERE kind=? AND document_id=?`).get(kind,row.id);
  const actions=sqlite.prepare(`SELECT a.key name,sum(a.value) count FROM customer_document_visits v,json_each(v.snapshot,'$.actions') a WHERE v.kind=? AND v.document_id=? GROUP BY a.key`).all(kind,row.id);
  const devices=sqlite.prepare(`SELECT device,browser,coalesce(json_extract(snapshot,'$.deviceName'),device) deviceName,count(*) visits FROM customer_document_visits WHERE kind=? AND document_id=? GROUP BY device,browser,deviceName ORDER BY visits DESC`).all(kind,row.id);
  const visits=sqlite.prepare('SELECT visit_id id,revision,started_at startedAt,last_at lastAt,active_ms activeMs,device,browser,snapshot FROM customer_document_visits WHERE kind=? AND document_id=? ORDER BY started_at DESC LIMIT 100').all(kind,row.id).map((r:any)=>{const {snapshot,...rest}=r;return {...rest,...JSON.parse(snapshot)};});
  const confirmed=kind==='quote'?{status:row.status,sentAt:row.sent_at,acceptedAt:row.accepted_at,declinedAt:row.declined_at,acceptNote:row.accept_note,declineNote:row.decline_note,declineReason:row.decline_reason,legacyOpens:row.view_count||0}:{status:row.status,sentAt:row.sent_at,paidCents:row.paid_cents,payments:sqlite.prepare('SELECT id,amount_cents amountCents,method,paid_at paidAt,created_at createdAt FROM fin_invoice_payments WHERE invoice_id=? ORDER BY created_at DESC LIMIT 50').all(row.id)};
  return {kind,number:row.number,revision:documentActivityRevision(kind,row),summary,actions,devices,visits,confirmed};
}
export function registerDocumentActivity(app:Express){
  app.post('/api/public/document-activity/:kind/:token',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
    if(!kinds.includes(String(req.params.kind))||!hasLeadKey(req)||!/^[a-f0-9]{48}$/i.test(String(req.params.token)))return res.status(404).json({ok:false});
    const kind=req.params.kind as Kind,row=document(kind,'share_token',String(req.params.token));
    if(!row||row.status==='draft')return res.status(404).json({ok:false});
    const status=save(kind,row,req.body,await visitorContext(String(req.headers['x-document-user-agent']||''),String(req.headers['x-activity-client-ip']||'')));
    res.status(status).json({ok:status<300});
  });
  app.get('/api/document-activity/:kind/:id',(req,res,next)=>{
    if(!kinds.includes(String(req.params.kind)))return res.status(404).json({message:'Document not found.'});
    return (req.params.kind==='quote'?requireAuth:requireElevated)(req,res,next);
  },(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const id=Number(req.params.id),kind=req.params.kind as Kind;
    const row=Number.isSafeInteger(id)&&id>0?document(kind,'id',id):null;
    if(!row)return res.status(404).json({message:'Document not found.'});
    res.json(report(kind,row));
  });
}
