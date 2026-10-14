import type {Express, Response} from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {audit} from './audit';

const models = [
 {key:'film-plant', name:'Film table · current plant layout', workspace:'film-table', file:'client/src/components/design-studio/plant-film-model.js', referenceOnly:true},
 {key:'film-earlier', name:'Film table · earlier bolted design', workspace:'film-table', file:'server/design-studio/current/parts.json', referenceOnly:true},
 {key:'walnut-table', name:'Dallas walnut table', workspace:'dallas-table', file:'server/design-studio/walnut-table/model.json', referenceOnly:true},
] as const;
const id = z.coerce.number().int().positive();
const create = z.object({name:z.string().trim().min(2).max(120),modelKey:z.enum(['film-plant','film-earlier','walnut-table']),jobId:z.number().int().positive().nullable()});
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(res:Response,e:any)=>res.status(e instanceof z.ZodError?400:e.status||500).json({message:e.message});
const problem=(message:string,status=400)=>Object.assign(new Error(message),{status});
let catalogCache: {stamp:string; data:any[]}|undefined;
export function designCatalog(){
 const stamp=models.map(m=>{try{const s=fs.statSync(m.file);return s.mtimeMs+':'+s.size;}catch{return 'missing';}}).join('|');
 if(catalogCache?.stamp===stamp)return catalogCache.data;
 const data=models.map(({file,...model})=>{
  if(!fs.existsSync(file))return {...model,available:false,revision:null};
  const bytes=fs.readFileSync(file),json=file.endsWith('.json')?JSON.parse(bytes.toString()):null;
  return {...model,available:true,revision:json?.revision||crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12)};
 });
 catalogCache={stamp,data};return data;
}
function jobLinks(jobId:number|null){
 if(!jobId)return {jobId:null,clientId:null,quoteId:null};
 const job=sqlite.prepare('SELECT id,client_id,quote_id FROM projects WHERE id=? AND deleted_at IS NULL').get(jobId) as any;
 if(!job)throw problem('Choose an available job.');
 return {jobId:job.id,clientId:job.client_id||null,quoteId:job.quote_id||null};
}
export function designRecord(designId:number){
 const row=sqlite.prepare(`SELECT d.*,p.name job_name,p.deleted_at job_deleted,p.client_id current_client_id,p.quote_id current_quote_id,c.name customer_name,q.number quote_number
  FROM suite_designs d LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN crm_clients c ON c.id=d.client_id LEFT JOIN quotes q ON q.id=d.quote_id WHERE d.id=?`).get(designId) as any;
 if(!row)throw problem('Design not found.',404);
 const model=designCatalog().find(m=>m.key===row.model_key);
 const relationshipChanged=!!row.project_id&&(row.job_deleted!=null||row.client_id!==row.current_client_id||row.quote_id!==row.current_quote_id);
 return {...row,model,relationshipChanged,revisionChanged:row.model_revision!==model?.revision,version:digest(row),href:`/design-studio/${model?.workspace}?design=${row.id}`};
}
export function jobDesigns(jobId:number){
 return (sqlite.prepare('SELECT id FROM suite_designs WHERE project_id=? ORDER BY archived_at IS NOT NULL,updated_at DESC,id DESC').all(jobId) as {id:number}[]).map(r=>designRecord(r.id));
}
export function registerDesignRegistry(app:Express){
 sqlite.exec(`CREATE TABLE IF NOT EXISTS suite_designs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,model_key TEXT NOT NULL,model_revision TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),client_id INTEGER REFERENCES crm_clients(id),quote_id INTEGER REFERENCES quotes(id),
  approved_at INTEGER,approved_by INTEGER REFERENCES users(id),archived_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS suite_designs_job ON suite_designs(project_id,archived_at,updated_at);
  CREATE TABLE IF NOT EXISTS suite_design_history(id INTEGER PRIMARY KEY AUTOINCREMENT,design_id INTEGER NOT NULL REFERENCES suite_designs(id),snapshot_json TEXT NOT NULL,created_at INTEGER NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id));`);
 app.get('/api/design-studio/registry',requireElevated,(req,res)=>{try{
  const page=z.coerce.number().int().min(0).max(100000).parse(req.query.page||0),jobId=req.query.jobId?id.parse(req.query.jobId):null;
  const archived=req.query.archived==='true',where=`archived_at IS ${archived?'NOT ':''}NULL AND (@job IS NULL OR project_id=@job)`;
  const rows=sqlite.prepare(`SELECT id FROM suite_designs WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET @offset`).all({job:jobId,offset:page*20}) as {id:number}[];
  const total=(sqlite.prepare(`SELECT COUNT(*) n FROM suite_designs WHERE ${where}`).get({job:jobId}) as any).n;
  res.json({models:designCatalog(),rows:rows.map(r=>designRecord(r.id)),total,page});
 }catch(e){fail(res,e);}});
 app.get('/api/design-studio/registry/:id',requireElevated,(req,res)=>{try{res.json(designRecord(id.parse(req.params.id)));}catch(e){fail(res,e);}});
 app.post('/api/design-studio/registry',requireElevated,(req,res)=>{try{
  const body=create.parse(req.body),model=designCatalog().find(m=>m.key===body.modelKey);
  if(!model?.available)throw problem('This model is unavailable. Restore its model files first.');
  const result=sqlite.transaction(()=>{
   const links=jobLinks(body.jobId),now=Date.now();
   const inserted=sqlite.prepare('INSERT INTO suite_designs(name,model_key,model_revision,project_id,client_id,quote_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(body.name,body.modelKey,model.revision,links.jobId,links.clientId,links.quoteId,now,now);
   const saved=designRecord(Number(inserted.lastInsertRowid));
   sqlite.prepare('INSERT INTO suite_design_history(design_id,snapshot_json,created_at,created_by) VALUES(?,?,?,?)').run(saved.id,JSON.stringify(saved),now,req.user!.userId);
   audit(req,'design.created',{targetType:'design',targetId:saved.id,details:links});return saved;
  })();res.status(201).json(result);
 }catch(e){fail(res,e);}});
 app.patch('/api/design-studio/registry/:id',requireElevated,(req,res)=>{try{
  const designId=id.parse(req.params.id),body=z.object({version:z.string(),action:z.enum(['archive','restore','review']),jobId:z.number().int().positive().nullable().optional(),approve:z.boolean().optional()}).parse(req.body);
  const result=sqlite.transaction(()=>{
   const before=designRecord(designId);if(before.version!==body.version)throw problem('This design changed. Reload and review it again.',409);
   const now=Math.max(Date.now(),before.updated_at+1);
   if(body.action==='review'){
    if(before.archived_at)throw problem('Restore this design before reviewing it.');
    if(!before.model?.available)throw problem('This model is unavailable. Restore its model files first.');
    const links=jobLinks(body.jobId===undefined?before.project_id:body.jobId);
    sqlite.prepare('UPDATE suite_designs SET project_id=?,client_id=?,quote_id=?,model_revision=?,approved_at=?,approved_by=?,updated_at=? WHERE id=?').run(links.jobId,links.clientId,links.quoteId,before.model.revision,body.approve?now:null,body.approve?req.user!.userId:null,now,designId);
   }else sqlite.prepare('UPDATE suite_designs SET archived_at=?,updated_at=? WHERE id=?').run(body.action==='archive'?now:null,now,designId);
   const saved=designRecord(designId);
   sqlite.prepare('INSERT INTO suite_design_history(design_id,snapshot_json,created_at,created_by) VALUES(?,?,?,?)').run(designId,JSON.stringify({before,after:saved}),now,req.user!.userId);
   audit(req,'design.'+body.action,{targetType:'design',targetId:designId,details:{previousRevision:before.model_revision,revision:saved.model_revision,approved:!!saved.approved_at}});return saved;
  })();res.json(result);
 }catch(e){fail(res,e);}});
 app.get('/api/design-studio/registry/:id/history',requireElevated,(req,res)=>{try{
  const designId=id.parse(req.params.id);designRecord(designId);
  const page=z.coerce.number().int().min(0).max(100000).parse(req.query.page||0);
  const rows=sqlite.prepare('SELECT h.id,h.snapshot_json,h.created_at,u.name reviewer FROM suite_design_history h JOIN users u ON u.id=h.created_by WHERE h.design_id=? ORDER BY h.id DESC LIMIT 20 OFFSET ?').all(designId,page*20);
  res.json({rows,total:(sqlite.prepare('SELECT COUNT(*) n FROM suite_design_history WHERE design_id=?').get(designId) as any).n,page});
 }catch(e){fail(res,e);}});
}
