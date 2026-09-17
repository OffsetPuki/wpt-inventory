import {visitorContext} from './visitor-context';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sqlite } from './storage';
import { requireElevated } from './auth';
import { hasLeadKey } from './public-api';
import { audit } from './audit';
import { enqueueFollowup } from './outbox';
import { ownerMailStatus } from './mailer';
import { savePreviewActivity, previewActivity } from './preview-activity';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_OPTIONS = 6;
const tokenPattern = /^[a-f0-9]{48}$/;
const metadata = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(''),
  customer: z.string().trim().max(120).default(''),
  width: z.string().trim().max(40).default(''),
  depth: z.string().trim().max(40).default(''),
  height: z.string().trim().max(40).default(''),
  finish: z.string().trim().max(60).default(''),
  note: z.string().trim().max(1200).default(''),
});
type Preview = z.infer<typeof metadata> & { id: number; token: string; published: number; created_at: number; updated_at: number; version: number };

// Embedded models live in SQLite so the existing complete database backup also
// backs up every customer preview. No publicly browsable upload directory.
sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_previews (
 id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', customer TEXT NOT NULL DEFAULT '',
 width TEXT NOT NULL DEFAULT '', height TEXT NOT NULL DEFAULT '', finish TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 published INTEGER NOT NULL DEFAULT 0, source_key TEXT UNIQUE, version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_preview_models (
 id TEXT PRIMARY KEY, preview_id INTEGER NOT NULL REFERENCES customer_previews(id) ON DELETE CASCADE,
 label TEXT NOT NULL, position INTEGER NOT NULL, bytes BLOB NOT NULL, size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_preview_models_preview ON customer_preview_models(preview_id,position);`);
if (!(sqlite.pragma('table_info(customer_previews)') as {name:string}[]).some(c=>c.name==='deleted_at')) sqlite.exec('ALTER TABLE customer_previews ADD COLUMN deleted_at INTEGER');
if (!(sqlite.pragma('table_info(customer_previews)') as {name:string}[]).some(c=>c.name==='merge_request')) sqlite.exec('ALTER TABLE customer_previews ADD COLUMN merge_request TEXT');
if (!(sqlite.pragma('table_info(customer_previews)') as {name:string}[]).some(c=>c.name==='depth')) sqlite.exec("ALTER TABLE customer_previews ADD COLUMN depth TEXT NOT NULL DEFAULT ''");
const modelColumns=new Set((sqlite.pragma('table_info(customer_preview_models)') as {name:string}[]).map(c=>c.name));
for(const [name,definition] of [['revision','INTEGER NOT NULL DEFAULT 1'],['previous_bytes','BLOB']]){
  if(!modelColumns.has(name))sqlite.exec(`ALTER TABLE customer_preview_models ADD COLUMN ${name} ${definition}`);
}
sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_preview_feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT, preview_id INTEGER NOT NULL REFERENCES customer_previews(id),
 submission_id TEXT NOT NULL, option_label TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(preview_id,submission_id)
);
CREATE INDEX IF NOT EXISTS customer_preview_feedback_recent ON customer_preview_feedback(preview_id,created_at DESC,id DESC);`);
// Keep existing customer comments when adding design decisions to their history.
const responseColumns=new Set((sqlite.pragma('table_info(customer_preview_feedback)') as {name:string}[]).map(c=>c.name));
for(const [name,definition] of [['kind',"TEXT NOT NULL DEFAULT 'feedback'"],['option_id',"TEXT NOT NULL DEFAULT ''"],['design_version','INTEGER']]) {
  if(!responseColumns.has(name))sqlite.exec(`ALTER TABLE customer_preview_feedback ADD COLUMN ${name} ${definition}`);
}
sqlite.exec('DROP INDEX IF EXISTS customer_preview_acceptance_once;');

export function validatePreviewGlb(bytes: Buffer): void {
  if (bytes.length < 24 || bytes.length > MAX_BYTES || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw new Error('Choose a valid GLB 2.0 model, up to 25 MB.');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || jsonLength > 4 * 1024 * 1024 || jsonLength % 4 || 20 + jsonLength > bytes.length)
    throw new Error('The model has an invalid GLB header.');
  let doc: any;
  try { doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)); } catch { throw new Error('The model description is invalid.'); }
  if (doc.asset?.version !== '2.0' || !Array.isArray(doc.meshes) || !doc.meshes.length || !Array.isArray(doc.nodes) || !Array.isArray(doc.scenes))
    throw new Error('The GLB must contain a 3D scene with meshes.');
  if (doc.nodes.length > 10000 || doc.meshes.length > 5000) throw new Error('This model has too many separate parts. Simplify it before uploading.');
  if ((doc.extensionsRequired || []).length) throw new Error('Export an uncompressed GLB with standard materials.');
  if ((doc.buffers || []).some((b: any) => b.uri) || (doc.images || []).some((i: any) => i.uri))
    throw new Error('Embed all textures and geometry inside the GLB; external files are not supported.');
  let offset = 20 + jsonLength, binaryLength = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('The GLB is incomplete.');
    const size = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
    if (size % 4 || offset + 8 + size > bytes.length) throw new Error('The GLB is incomplete.');
    if (kind === 0x004e4942) binaryLength = size;
    offset += 8 + size;
  }
  if (!binaryLength || (doc.buffers || []).length !== 1 || !Number.isInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength > binaryLength)
    throw new Error('The model geometry is missing or incomplete.');
  for (const view of doc.bufferViews || []) {
    if ((view.buffer || 0) !== 0 || !Number.isInteger(view.byteLength) || view.byteLength < 0 || !Number.isInteger(view.byteOffset || 0) || (view.byteOffset || 0) < 0 || (view.byteOffset || 0) + view.byteLength > binaryLength)
      throw new Error('The model geometry has invalid bounds.');
  }
}

function getPreview(id: number): Preview | undefined {
  return sqlite.prepare('SELECT * FROM customer_previews WHERE id=? AND deleted_at IS NULL').get(id) as Preview | undefined;
}
function modelList(id: number) {
  return sqlite.prepare('SELECT id,label,size,revision,previous_bytes IS NOT NULL AS canRestore FROM customer_preview_models WHERE preview_id=? ORDER BY position,id').all(id) as {id:string;label:string;size:number;revision:number;canRestore:number}[];
}
function view(p: Preview) {
  return { id:p.id, title:p.title, description:p.description, customer:p.customer, width:p.width,depth:p.depth, height:p.height,
    finish:p.finish, note:p.note, published:!!p.published, version:p.version, createdAt:p.created_at, updatedAt:p.updated_at,
    url:`https://www.cjmmetals.com/preview/${p.token}`, options:modelList(p.id),
    feedback:sqlite.prepare(`SELECT f.id,f.kind,f.option_id AS optionId,f.design_version AS designVersion,f.option_label AS optionLabel,f.message,f.created_at AS createdAt,
      CASE WHEN m.accepted_at IS NOT NULL THEN 'sent'
        WHEN coalesce(d.status,o.status) IN ('failed','review','stopped') THEN 'attention'
        WHEN o.id IS NOT NULL THEN 'queued' ELSE 'not_requested' END AS emailStatus
      FROM customer_preview_feedback f
      LEFT JOIN suite_outbox o ON o.event_key='preview-feedback-owner:'||f.id
      LEFT JOIN suite_mail m ON m.key=o.event_key
      LEFT JOIN suite_outbox d ON d.event_key='delivery:'||o.event_key
      WHERE f.preview_id=? ORDER BY f.created_at DESC,f.id DESC LIMIT 50`).all(p.id) };
}
function record(req: Request, res: Response): Preview | undefined {
  const id = Number(req.params.id);
  const p = Number.isSafeInteger(id) && id > 0 ? getPreview(id) : undefined;
  if (!p) { res.status(404).json({message:'Preview not found.'}); return; }
  return p;
}
function current(req: Request, res: Response, p: Preview): boolean {
  if (Number(req.body?.version) !== p.version) {
    res.status(409).json({message:'This preview changed in another window. Close and reopen it before saving.'}); return false;
  }
  return true;
}
function insertModel(previewId: number, label: string, bytes: Buffer) {
  validatePreviewGlb(bytes);
  const count = (sqlite.prepare('SELECT COUNT(*) AS n FROM customer_preview_models WHERE preview_id=?').get(previewId) as any).n;
  if (count >= MAX_OPTIONS) throw new Error('A preview can have up to six options.');
  const position = (sqlite.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM customer_preview_models WHERE preview_id=?').get(previewId) as any).n;
  sqlite.prepare('INSERT INTO customer_preview_models(id,preview_id,label,position,bytes,size) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomBytes(16).toString('hex'),previewId,label,position,bytes,bytes.length);
  sqlite.prepare('UPDATE customer_previews SET updated_at=?,version=version+1 WHERE id=?').run(Date.now(),previewId);
}

// One owner-requested project ships with the feature. Only inserted once;
// owner edits and disabling a link survive every later deployment.
export function seedCustomerPreview(): void {
  const dir = path.resolve('server/preview-seeds');
  const manifest = path.join(dir,'kalkat.json');
  if (!fs.existsSync(manifest) || sqlite.prepare('SELECT 1 FROM customer_previews WHERE source_key=?').get('kalkat-2026-09')) return;
  const seed = JSON.parse(fs.readFileSync(manifest,'utf8'));
  const values = metadata.parse(seed);
  if (!tokenPattern.test(seed.token)) throw new Error('Invalid seed preview token');
  const models = seed.options.map((o: {file:string;label:string}) => {
    if (!/^[\w.-]+\.glb$/.test(o.file)) throw new Error('Invalid seed model path');
    const bytes = fs.readFileSync(path.join(dir,o.file)); validatePreviewGlb(bytes); return {label:o.label,bytes};
  });
  sqlite.transaction(() => {
    const now=Date.now();
    const result=sqlite.prepare('INSERT INTO customer_previews(token,title,description,customer,width,depth,height,finish,note,published,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)')
      .run(seed.token,values.title,values.description,values.customer,values.width,values.depth,values.height,values.finish,values.note,'kalkat-2026-09',now,now);
    for (const m of models) insertModel(Number(result.lastInsertRowid),m.label,m.bytes);
  })();
}

export function registerCustomerPreviews(app: Express): void {
  seedCustomerPreview();
  const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:3,fieldSize:1000}}).single('model');
  const readShared = (req: Request, res: Response) => {
    res.setHeader('Cache-Control','private, no-store'); res.setHeader('X-Robots-Tag','noindex, nofollow');
    if (!hasLeadKey(req) || !tokenPattern.test(String(req.params.token))) {res.status(404).end();return;}
    const p=sqlite.prepare('SELECT * FROM customer_previews WHERE token=? AND published=1 AND deleted_at IS NULL').get(req.params.token) as Preview|undefined;
    if (!p) {res.status(404).end();return;} return p;
  };
  app.get('/api/public/customer-previews/:token',(req,res) => {
    const p=readShared(req,res);if(!p)return;
    res.json({title:p.title,description:p.description,width:p.width,depth:p.depth,height:p.height,finish:p.finish,note:p.note,version:p.version,options:modelList(p.id)});
  });
  app.get('/api/public/customer-previews/:token/models/:modelId',(req,res) => {
    const p=readShared(req,res);if(!p)return;
    const m=sqlite.prepare('SELECT bytes,size FROM customer_preview_models WHERE preview_id=? AND id=?').get(p.id,req.params.modelId) as {bytes:Buffer;size:number}|undefined;
    if(!m){res.status(404).end();return;}
    res.setHeader('Content-Type','model/gltf-binary');res.setHeader('X-Content-Type-Options','nosniff');res.send(m.bytes);
  });
  const receiveResponse=(req:Request,res:Response,kind:'feedback'|'approval') => {
    const p=readShared(req,res);if(!p)return;
    const parsed=z.object({submissionId:z.string().uuid(),optionId:z.string().regex(/^[a-f0-9]{32}$/),message:z.string().trim().max(2000).default(''),version:z.number().int().positive().optional()}).safeParse(req.body);
    if(!parsed.success||(kind==='feedback'&&!parsed.data.message)||(kind==='approval'&&!parsed.data.version)){res.status(400).json({message:kind==='approval'?'Choose a current design to request a quote.':'Enter your design feedback (up to 2,000 characters).'});return;}
    const message=kind==='approval'?'I like this design. Please prepare a quote.':parsed.data.message;
    const previous=sqlite.prepare('SELECT kind,option_id,option_label,message,design_version FROM customer_preview_feedback WHERE preview_id=? AND submission_id=?').get(p.id,parsed.data.submissionId) as {kind:string;option_id:string;option_label:string;message:string;design_version:number|null}|undefined;
    if(previous){
      if(previous.kind!==kind||previous.message!==message||(previous.option_id&&previous.option_id!==parsed.data.optionId)||(kind==='approval'&&previous.design_version!==parsed.data.version)){res.status(409).json({message:'This response was already used for a different selection. Reload the preview and try again.'});return;}
      res.json({ok:true});return;
    }
    if(kind==='approval'&&parsed.data.version!==p.version){res.status(409).json({message:'This design has changed. Reload the preview and review it before requesting a quote.'});return;}
    const option=modelList(p.id).find(m=>m.id===parsed.data.optionId);
    if(!option){res.status(400).json({message:'Choose one of the current design options.'});return;}
    const latest=sqlite.prepare('SELECT kind,option_id,design_version FROM customer_preview_feedback WHERE preview_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(p.id) as {kind:string;option_id:string;design_version:number}|undefined;
    if(kind==='approval'&&latest?.kind==='approval'&&latest.option_id===option.id&&latest.design_version===p.version){res.json({ok:true});return;}
    const recent=sqlite.prepare('SELECT COUNT(*) AS n FROM customer_preview_feedback WHERE preview_id=? AND created_at>?').get(p.id,Date.now()-3600000) as {n:number};
    if(recent.n>=10){res.status(429).json({message:'Please wait a little before sending another response.'});return;}
    sqlite.transaction(()=>{
      const row=sqlite.prepare('INSERT INTO customer_preview_feedback(preview_id,submission_id,option_label,message,created_at,kind,option_id,design_version) VALUES(?,?,?,?,?,?,?,?)')
        .run(p.id,parsed.data.submissionId,option.label,message,Date.now(),kind,option.id,p.version);
      enqueueFollowup(`preview-feedback-owner:${row.lastInsertRowid}`,'preview-feedback-owner',{
        subject:`[CJM Metals] ${kind==='approval'?'Design accepted — quote requested':'Design feedback'} — ${p.title.replace(/[\r\n]+/g,' ')}`,
        text:`${kind==='approval'?'The customer selected "I like this design" and is ready for a quote.':'New feedback on your customer design preview.'}\n\nProject: ${p.title}\n${p.customer?`Customer / job: ${p.customer}\n`:''}Selected option: ${option.label}\nDesign version: ${p.version}\n\nCustomer response:\n${message}\n\n${kind==='approval'?'Next step: Prepare and send a quote for this selected design.\n\n':''}Review in the Business Suite:\nhttps://flipnob.com/#/crm/previews\n\nCustomer preview:\nhttps://www.cjmmetals.com/preview/${p.token}\n\n${kind==='approval'?'This confirms the preview design for quoting only. Pricing and fabrication still require the normal quote approval.':'This is feedback before a quote, not approval to begin fabrication.'}`,
      });
    })();
    res.status(201).json({ok:true});
  };
  app.post('/api/public/customer-previews/:token/feedback',(req,res)=>receiveResponse(req,res,'feedback'));
  app.post('/api/public/customer-previews/:token/accept',(req,res)=>receiveResponse(req,res,'approval'));
  app.post('/api/public/customer-previews/:token/activity',async(req,res)=>{
    const p=readShared(req,res);if(!p)return;
    const status=savePreviewActivity(p,req.body,String(req.headers['x-preview-user-agent']||'').slice(0,500),await visitorContext(String(req.headers['x-preview-user-agent']||''),String(req.headers['x-activity-client-ip']||'')));
    res.status(status).json({ok:status<300});
  });
  app.get('/api/customer-previews/:id/activity',requireElevated,(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const p=record(req,res);if(!p)return;
    res.json(previewActivity(p.id));
  });
  app.get('/api/customer-previews/notifications',requireElevated,(_req,res)=>res.json(ownerMailStatus()));
  app.get('/api/customer-previews',requireElevated,(_req,res) => {
    const ps=sqlite.prepare('SELECT * FROM customer_previews WHERE deleted_at IS NULL ORDER BY updated_at DESC,id DESC').all() as Preview[];
    res.json(ps.map(view));
  });
  app.post('/api/customer-previews',requireElevated,(req,res) => {
    const parsed=metadata.safeParse(req.body);if(!parsed.success){res.status(400).json({message:'Enter a project title and keep the description and notes within the allowed lengths.'});return;}
    const p=parsed.data,now=Date.now();
    const r=sqlite.prepare('INSERT INTO customer_previews(token,title,description,customer,width,depth,height,finish,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(crypto.randomBytes(24).toString('hex'),p.title,p.description,p.customer,p.width,p.depth,p.height,p.finish,p.note,now,now);
    const id=Number(r.lastInsertRowid);audit(req,'preview.created',{targetType:'customer_preview',targetId:id,targetName:p.title});res.status(201).json(view(getPreview(id)!));
  });
  app.post('/api/customer-previews/merge',requireElevated,(req,res)=>{
    const parsed=z.object({requestId:z.string().uuid(),title:z.string().trim().min(1).max(120),customer:z.string().trim().max(120).default(''),sources:z.array(z.object({id:z.number().int().positive(),version:z.number().int().positive()})).min(2).max(MAX_OPTIONS)}).safeParse(req.body);
    if(!parsed.success){res.status(400).json({message:'Select two or more previews and enter a title.'});return;}
    const data=parsed.data;
    if(new Set(data.sources.map(p=>p.id)).size!==data.sources.length){res.status(400).json({message:'Select each preview only once.'});return;}
    const sourceKey='merge:'+data.requestId;
    // Store the exact request signature so a network retry cannot create a
    // second draft or silently reuse an idempotency key for another merge.
    const signature=JSON.stringify({title:data.title,customer:data.customer,sources:data.sources});
    try{
      const id=sqlite.transaction(()=>{
        const existing=sqlite.prepare('SELECT * FROM customer_previews WHERE source_key=?').get(sourceKey) as (Preview&{deleted_at:number|null;merge_request:string|null})|undefined;
        if(existing){
          if(existing.merge_request!==signature)throw Object.assign(new Error('This merge request was already used. Reopen the merge dialog.'),{status:409});
          if(existing.deleted_at)throw Object.assign(new Error('The merged preview was deleted. Start a new merge.'),{status:410});
          return existing.id;
        }
        const sources=data.sources.map(ref=>{
          const p=getPreview(ref.id);
          if(!p)throw Object.assign(new Error('A selected preview no longer exists. Refresh the list.'),{status:404});
          if(p.version!==ref.version)throw Object.assign(new Error('A selected preview changed. Refresh the list and select it again.'),{status:409});
          const options=modelList(p.id);
          if(!options.length)throw Object.assign(new Error('Each selected preview must have at least one design option.'),{status:400});
          return {p,options};
        });
        if(sources.reduce((sum,s)=>sum+s.options.length,0)>MAX_OPTIONS)throw Object.assign(new Error('The combined preview can have up to six design options.'),{status:400});
        const now=Date.now();
        const row=sqlite.prepare('INSERT INTO customer_previews(token,title,customer,merge_request,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomBytes(24).toString('hex'),data.title,data.customer,signature,sourceKey,now,now);
        const id=Number(row.lastInsertRowid);let position=0;
        for(const source of sources)for(const option of source.options){
          const label=`${++position}. ${source.p.title} — ${option.label}`.slice(0,60);
          sqlite.prepare('INSERT INTO customer_preview_models(id,preview_id,label,position,bytes,size) SELECT ?,?,?,?,bytes,size FROM customer_preview_models WHERE id=? AND preview_id=?').run(crypto.randomBytes(16).toString('hex'),id,label,position-1,option.id,source.p.id);
        }
        return id;
      })();
      audit(req,'preview.merged',{targetType:'customer_preview',targetId:id,targetName:data.title});
      res.status(201).json(view(getPreview(id)!));
    }catch(error){res.status((error as any).status||500).json({message:(error as any).status?(error as Error).message:'Could not merge previews.'});}
  });
  app.post('/api/customer-previews/from-model',requireElevated,(req,res)=>{
    upload(req,res,(err:any)=>{
      if(err||!req.file){res.status(400).json({message:'Choose a model up to 25 MB.'});return;}
      let raw;try{raw=JSON.parse(req.body.details||'{}');}catch{res.status(400).json({message:'Invalid preview details.'});return;}
      const parsed=metadata.safeParse(raw),key=z.string().uuid().safeParse(req.body.requestId);
      if(!parsed.success||!key.success){res.status(400).json({message:'Enter a preview title.'});return;}
      const source='quote-model:'+key.data;
      const existing=sqlite.prepare('SELECT * FROM customer_previews WHERE source_key=?').get(source) as Preview|undefined;
      if(existing){if((existing as any).deleted_at){res.status(410).json({message:'This preview was deleted. Create a new preview.'});return;}res.json(view(existing));return;}
      try{
        validatePreviewGlb(req.file.buffer);const p=parsed.data,now=Date.now();
        const id=sqlite.transaction(()=>{
          const r=sqlite.prepare('INSERT INTO customer_previews(token,title,description,customer,width,depth,height,finish,note,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomBytes(24).toString('hex'),p.title,p.description,p.customer,p.width,p.depth,p.height,p.finish,p.note,source,now,now);
          const id=Number(r.lastInsertRowid);insertModel(id,'Design from quote',req.file!.buffer);return id;
        })();
        audit(req,'preview.created_from_quote_model',{targetType:'customer_preview',targetId:id,targetName:p.title});res.status(201).json(view(getPreview(id)!));
      }catch(e){res.status(400).json({message:e instanceof Error?e.message:'Could not create the preview.'});}
    });
  });
  app.delete('/api/customer-previews/:id',requireElevated,(req,res)=>{
    const p=record(req,res);if(!p||!current(req,res,p))return;
    sqlite.prepare('UPDATE customer_previews SET deleted_at=?,published=0,version=version+1,updated_at=? WHERE id=?').run(Date.now(),Date.now(),p.id);
    audit(req,'preview.deleted',{targetType:'customer_preview',targetId:p.id,targetName:p.title});res.status(204).end();
  });
  app.patch('/api/customer-previews/:id',requireElevated,(req,res) => {
    const p=record(req,res);if(!p||!current(req,res,p))return;
    const parsed=metadata.safeParse(req.body);if(!parsed.success){res.status(400).json({message:'Enter a project title and keep the description and notes within the allowed lengths.'});return;}
    const v=parsed.data;
    sqlite.prepare('UPDATE customer_previews SET title=?,description=?,customer=?,width=?,depth=?,height=?,finish=?,note=?,version=version+1,updated_at=? WHERE id=?')
      .run(v.title,v.description,v.customer,v.width,v.depth,v.height,v.finish,v.note,Date.now(),p.id);
    audit(req,'preview.updated',{targetType:'customer_preview',targetId:p.id,targetName:v.title});res.json(view(getPreview(p.id)!));
  });
  app.post('/api/customer-previews/:id/sharing',requireElevated,(req,res) => {
    const p=record(req,res);if(!p||!current(req,res,p))return;
    if(typeof req.body.published!=='boolean'){res.status(400).json({message:'Choose whether this link is available.'});return;}
    if(req.body.published&&!modelList(p.id).length){res.status(400).json({message:'Add a 3D model before creating the customer link.'});return;}
    sqlite.prepare('UPDATE customer_previews SET published=?,updated_at=?,version=version+1 WHERE id=?').run(req.body.published?1:0,Date.now(),p.id);
    audit(req,req.body.published?'preview.shared':'preview.disabled',{targetType:'customer_preview',targetId:p.id,targetName:p.title});res.json(view(getPreview(p.id)!));
  });
  app.post('/api/customer-previews/:id/models',requireElevated,(req,res,next:NextFunction) => {
    upload(req,res,(err:any) => {
      if(err){res.status(400).json({message:err.code==='LIMIT_FILE_SIZE'?'Choose a model smaller than 25 MB.':'Upload one GLB model at a time.'});return;}
      const p=record(req,res);if(!p||!current(req,res,p))return;
      const label=z.string().trim().min(1).max(60).safeParse(req.body.label);
      if(!label.success||!req.file||!/\.glb$/i.test(req.file.originalname)){res.status(400).json({message:'Choose a GLB model and give the option a name.'});return;}
      try{sqlite.transaction(()=>insertModel(p.id,label.data,req.file!.buffer))();}
      catch(error){res.status(400).json({message:error instanceof Error?error.message:'Could not save model.'});return;}
      audit(req,'preview.model_added',{targetType:'customer_preview',targetId:p.id,targetName:label.data});res.status(201).json(view(getPreview(p.id)!));
    });
  });
  app.post('/api/customer-previews/:id/models/:modelId/replace',requireElevated,(req,res)=>{
    upload(req,res,(err:any)=>{
      if(err||!req.file||!/\.glb$/i.test(req.file.originalname)){res.status(400).json({message:'Choose a GLB model up to 25 MB.'});return;}
      const p=record(req,res);if(!p||!current(req,res,p))return;
      try{validatePreviewGlb(req.file.buffer);}catch(e){res.status(400).json({message:e instanceof Error?e.message:'Invalid model.'});return;}
      const changed=sqlite.transaction(()=>{
        const r=sqlite.prepare('UPDATE customer_preview_models SET previous_bytes=bytes,bytes=?,size=?,revision=revision+1 WHERE id=? AND preview_id=?').run(req.file!.buffer,req.file!.size,req.params.modelId,p.id);
        if(r.changes)sqlite.prepare('UPDATE customer_previews SET updated_at=?,version=version+1 WHERE id=?').run(Date.now(),p.id);
        return r.changes;
      })();
      if(!changed){res.status(404).json({message:'Model not found.'});return;}
      audit(req,'preview.model_replaced',{targetType:'customer_preview',targetId:p.id});res.json(view(getPreview(p.id)!));
    });
  });
  app.post('/api/customer-previews/:id/models/:modelId/restore',requireElevated,(req,res)=>{
    const p=record(req,res);if(!p||!current(req,res,p))return;
    const changed=sqlite.transaction(()=>{
      const r=sqlite.prepare('UPDATE customer_preview_models SET bytes=previous_bytes,previous_bytes=bytes,size=length(previous_bytes),revision=revision+1 WHERE id=? AND preview_id=? AND previous_bytes IS NOT NULL').run(req.params.modelId,p.id);
      if(r.changes)sqlite.prepare('UPDATE customer_previews SET updated_at=?,version=version+1 WHERE id=?').run(Date.now(),p.id);
      return r.changes;
    })();
    if(!changed){res.status(404).json({message:'No previous model is available.'});return;}
    audit(req,'preview.model_restored',{targetType:'customer_preview',targetId:p.id});res.json(view(getPreview(p.id)!));
  });
  app.delete('/api/customer-previews/:id/models/:modelId',requireElevated,(req,res) => {
    const p=record(req,res);if(!p||!current(req,res,p))return;
    if(p.published&&modelList(p.id).length<=1){res.status(400).json({message:'Disable the customer link before removing its last model.'});return;}
    const r=sqlite.prepare('DELETE FROM customer_preview_models WHERE id=? AND preview_id=?').run(req.params.modelId,p.id);
    if(!r.changes){res.status(404).json({message:'Model not found.'});return;}
    sqlite.prepare('UPDATE customer_previews SET updated_at=?,version=version+1 WHERE id=?').run(Date.now(),p.id);
    audit(req,'preview.model_removed',{targetType:'customer_preview',targetId:p.id});res.json(view(getPreview(p.id)!));
  });
}
