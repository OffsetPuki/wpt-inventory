import type {Express} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {sqlite,uploadsDir} from './storage';
import {requireElevated} from './auth';
type Reference={table:string;record:string;state:string};
type FileRow={name:string;bytes:number;modifiedAt:number;references:Reference[];referenceCount:number};
/** Conservative inventory: historical JSON and Trash count as references too.
 * There is deliberately no delete or purge action in this report. */
export async function scanUploadReferences(){
 const byName=new Map<string,FileRow[]>(),rows:FileRow[]=[],skipped:string[]=[];
 async function walk(dir:string){for(const entry of await fs.promises.readdir(dir,{withFileTypes:true})){
  const absolute=path.join(dir,entry.name),name=path.relative(uploadsDir,absolute).replaceAll('\\','/');
  if(entry.isSymbolicLink()){skipped.push(name);continue;}
  if(entry.isDirectory()){await walk(absolute);continue;}if(!entry.isFile())continue;
  const stat=await fs.promises.stat(absolute),row={name,bytes:stat.size,modifiedAt:stat.mtimeMs,references:[],referenceCount:0};rows.push(row);byName.set(entry.name,[...(byName.get(entry.name)||[]),row]);
 }}
 await walk(uploadsDir);
 const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
 let inspected=0;
 for(const {name} of tables){
  if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))continue;
  const columns=sqlite.prepare(`PRAGMA table_info("${name}")`).all() as {name:string;type:string;pk:number}[];
  const textColumns=columns.filter(c=>/TEXT|CHAR|JSON/i.test(c.type)),primary=columns.find(c=>c.pk),deleted=columns.find(c=>c.name==='deleted_at'),status=columns.find(c=>c.name==='status');
  if(!textColumns.length)continue;
  const chosen=[...new Set([...textColumns.map(c=>c.name),...(primary?[primary.name]:[]),...(deleted?[deleted.name]:[]),...(status?[status.name]:[])])];
  const quoted=chosen.map(c=>'"'+c.replaceAll('"','""')+'"').join(',');
  for(const item of sqlite.prepare(`SELECT ${quoted} FROM "${name}"`).iterate() as Iterable<Record<string,unknown>>){
   const found=new Set<FileRow>();
   for(const column of textColumns){const value=item[column.name];if(typeof value!=='string')continue;for(const token of value.match(/[A-Za-z0-9][A-Za-z0-9_.-]*\.[A-Za-z0-9]{1,12}/g)||[])for(const file of byName.get(token)||[])found.add(file);}
   for(const file of found){file.referenceCount++;if(file.references.length<20)file.references.push({table:name,record:primary?String(item[primary.name]):'historical entry',state:deleted&&item.deleted_at!=null?'Trash':status&&['archived','inactive','terminated'].includes(String(item.status))?'Archived':'Retained record'});}
   if(++inspected%1000===0)await new Promise<void>(resolve=>setImmediate(resolve));
  }
 }
 const now=Date.now(),files=rows.map(row=>({...row,ageDays:Math.max(0,Math.floor((now-row.modifiedAt)/86400000)),state:row.referenceCount?'Referenced':now-row.modifiedAt<30*86400000?'Recent upload — retain':'Review candidate'}));
 return {generatedAt:now,files:files.sort((a,b)=>a.referenceCount-b.referenceCount||b.bytes-a.bytes),skipped,total:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),candidateBytes:files.filter(f=>f.state==='Review candidate').reduce((n,f)=>n+f.bytes,0),candidateCount:files.filter(f=>f.state==='Review candidate').length,retentionDays:30};
}
export function registerStorageReview(app:Express){
 let cached:Awaited<ReturnType<typeof scanUploadReferences>>|undefined,running:Promise<Awaited<ReturnType<typeof scanUploadReferences>>>|undefined;
 app.get('/api/suite/storage-review',requireElevated,async(req,res)=>{try{
  if(!cached||Date.now()-cached.generatedAt>60000){running??=scanUploadReferences().finally(()=>{running=undefined;});cached=await running;}
  const state=typeof req.query.state==='string'?req.query.state:'all',filtered=cached.files.filter(f=>state==='all'||f.state===state),page=Math.min(Math.max(0,Math.floor(Number(req.query.page)||0)),Math.max(0,Math.ceil(filtered.length/25)-1));
  const {files,...summary}=cached;res.json({...summary,rows:filtered.slice(page*25,(page+1)*25),page,filteredTotal:filtered.length,pageSize:25});
 }catch{res.status(500).json({message:'Could not inspect stored files.'});}});
}
