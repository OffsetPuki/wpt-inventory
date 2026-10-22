import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {Express} from 'express';
import {z} from 'zod';
import {dataDir,sqlite} from './storage';
import {requireAuth} from './auth';

const directory=path.join(dataDir,'lead-files');
fs.mkdirSync(directory,{recursive:true});
sqlite.exec(`CREATE TABLE IF NOT EXISTS crm_lead_files (id TEXT PRIMARY KEY, lead_id INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_crm_lead_files_lead ON crm_lead_files(lead_id);`);
export const requestFilesSchema=z.array(z.object({name:z.string().min(1).max(200),data:z.string().min(4).max(13_333_336)}).strict()).max(3).default([]);
type Incoming=z.infer<typeof requestFilesSchema>;
export type StoredLeadFile={id:string;name:string;size:number};
const decode=(file:Incoming[number])=>{
 const bytes=Buffer.from(file.data,'base64');
 if(bytes.toString('base64')!==file.data)throw new Error('Invalid file encoding.');
 if(!bytes.length||bytes.length>10_000_000)throw new Error('Files must be no larger than 10 MB each.');
 return bytes;
};
export function stageLeadFiles(files:Incoming,photos:string[]=[]):StoredLeadFile[]{
 if(files.length+photos.length>3)throw new Error('Attach up to 3 files.');
 const buffers=files.map(decode);
 const total=buffers.reduce((n,b)=>n+b.length,0)+photos.reduce((n,p)=>n+Buffer.byteLength(p.split(',')[1]||'','base64'),0);
 if(total>20_000_000)throw new Error('Attachments must total no more than 20 MB.');
 const staged:StoredLeadFile[]=[];
 try{
  for(let i=0;i<files.length;i++){
   const id=crypto.randomUUID(),name=files[i].name.replace(/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'_').trim()||'attachment';
   fs.writeFileSync(path.join(directory,id),buffers[i],{flag:'wx',mode:0o600});
   staged.push({id,name,size:buffers[i].length});
  }
  return staged;
 }catch(error){discardLeadFiles(staged);throw error;}
}
export function discardLeadFiles(files:StoredLeadFile[]){for(const file of files){try{fs.unlinkSync(path.join(directory,file.id));}catch{}}}
export function attachLeadFiles(leadId:number,files:StoredLeadFile[]){
 const existing=sqlite.prepare('SELECT COUNT(*) n FROM crm_lead_files WHERE lead_id=?').get(leadId) as {n:number};
 if(files.length&&existing.n+files.length>36)throw new Error('This request has reached its file limit. Please contact us.');
 for(const file of files)sqlite.prepare('INSERT INTO crm_lead_files VALUES(?,?,?,?,?)').run(file.id,leadId,file.name,file.size,Date.now());
}
export function listLeadFiles(leadId:number){return sqlite.prepare('SELECT id,name,size FROM crm_lead_files WHERE lead_id=? ORDER BY created_at,id').all(leadId) as StoredLeadFile[];}
export function registerLeadFiles(app:Express){
 app.get('/api/crm/leads/:id/files/:fileId',requireAuth,(req,res)=>{
  const file=sqlite.prepare('SELECT f.id,f.name FROM crm_lead_files f JOIN crm_leads l ON l.id=f.lead_id WHERE f.id=? AND f.lead_id=? AND l.deleted_at IS NULL').get(String(req.params.fileId),Number(req.params.id)) as {id:string;name:string}|undefined;
  if(!file)return res.status(404).json({message:'File not found'});
  // Never render customer-supplied HTML, SVG, scripts or other active formats.
  res.set({'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'private, no-store'});
  res.download(path.join(directory,file.id),file.name,{headers:{'Content-Type':'application/octet-stream'}},error=>{if(error&&!res.headersSent)res.status(404).json({message:'File unavailable'});});
 });
}
