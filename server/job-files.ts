import type {Express,Request} from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {requireElevated,requireAuth} from './auth';
import {isElevated} from './http-util';
import {employeeHasJob} from './employee-data';
import {sqlite,uploadsDir} from './storage';
import {JOB_DOCUMENT_EXTENSIONS,JOB_FILE_MAX_BYTES,isJobImage} from '../shared/job-files';
import {inventoryOnce} from './inventory-core';
import {audit} from './audit';
import {z} from 'zod';

const allowed=new Set<string>(JOB_DOCUMENT_EXTENSIONS);
const upload=multer({
  storage:multer.diskStorage({destination:uploadsDir,filename:(_req,file,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)}),
  limits:{fileSize:JOB_FILE_MAX_BYTES,files:1},
  fileFilter:(_req,file,cb)=>allowed.has(path.extname(file.originalname).slice(1).toLowerCase())?cb(null,true):cb(new Error('Choose a PDF, Word, Excel, text, CAD, or ZIP file.')),
});
export function registerJobFileRoutes(app:Express){
  const active=(id:unknown)=>sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL').get(Number(id)||0);
  const permitted=(req:Request)=>isElevated(req)||(req.path.startsWith('/api/employee/')&&employeeHasJob(req.user!.userId,Number(req.params.id)));
  const attach=multer({storage:uploadStorage(),limits:{fileSize:JOB_FILE_MAX_BYTES,files:1},fileFilter:(_req,file,cb)=>allowed.has(path.extname(file.originalname).slice(1).toLowerCase())||isJobImage(file.originalname)?cb(null,true):cb(new Error('Choose a supported photo, PDF, Office document, CAD file or ZIP.'))});
  app.post(['/api/suite/jobs/:id/attachments','/api/employee/jobs/:id/attachments'],requireAuth,(req,res)=>{
    if(!permitted(req))return res.status(403).json({message:'You can attach files only to jobs assigned to you.'});
    if(!active(req.params.id))return res.status(404).json({message:'Job not found.'});
    attach.single('file')(req,res,async error=>{
      if(error)return res.status(400).json({message:error.code==='LIMIT_FILE_SIZE'?'Choose a file smaller than 25 MB.':error.message});
      if(!req.file)return res.status(400).json({message:'Choose a file to upload.'});
      const file=req.file,url=`/uploads/${file.filename}`;
      let retained=false;
      try{
        const body=z.object({requestKey:z.string().uuid(),title:z.string().trim().min(1).max(200),kind:z.enum(['photo','drawing','measurement','receipt','other'])}).parse(req.body);
        const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file.path))digest.update(chunk);
        const hash=digest.digest('hex'),id=Number(req.params.id);
        const result=inventoryOnce(sqlite,req.user!.userId,body.requestKey,{action:'attach-job-file',id,hash,...body},()=>{
          if(!active(id))throw new Error('This job was deleted during the upload.');
          if(!permitted(req))throw Object.assign(new Error('Your access to this job changed during the upload.'),{status:403});
          const inserted=sqlite.prepare('INSERT INTO suite_files(project_id,title,url,kind,user_id) VALUES(?,?,?,?,?) RETURNING id,url,title').get(id,body.title,url,body.kind,req.user!.userId) as {id:number;url:string;title:string};
          audit(req,'suite.file_attached',{targetType:'project',targetId:id,details:{fileId:inserted.id,bytes:file.size}});
          return inserted;
        }) as {id:number;url:string;title:string};
        retained=result.url===url;
        res.status(201).json(result);
      }catch(e:any){res.status(e.status||400).json({message:e.message});}
      finally{if(!retained)await fs.promises.unlink(file.path).catch(()=>{});}
    });
  });
  app.post('/api/suite/jobs/:id/file-upload',requireElevated,(req,res)=>{
    if(!active(req.params.id))return res.status(404).json({message:'Job not found.'});
    upload.single('file')(req,res,error=>{
      if(error)return res.status(400).json({message:error.code==='LIMIT_FILE_SIZE'?'Choose a file smaller than 25 MB.':error.message});
      if(!req.file)return res.status(400).json({message:'Choose a file to upload.'});
      if(!active(req.params.id)){
        fs.unlinkSync(req.file.path);
        return res.status(409).json({message:'This job was deleted during the upload.'});
      }
      res.status(201).json({url:`/uploads/${req.file.filename}`,name:req.file.originalname});
    });
  });
  app.get(['/api/suite/jobs/:id/files/:fileId/download','/api/employee/jobs/:id/files/:fileId/download'],requireAuth,(req,res)=>{
    if(!permitted(req))return res.status(403).json({message:'This job is not assigned to you.'});
    if(!active(req.params.id))return res.status(404).json({message:'Job not found.'});
    const file=sqlite.prepare('SELECT title,url FROM suite_files WHERE id=? AND project_id=?').get(Number(req.params.fileId)||0,Number(req.params.id)||0) as {title:string;url:string}|undefined;
    if(!file||!/^\/uploads\/[A-Za-z0-9_.-]+$/.test(file.url))return res.status(404).json({message:'File not found.'});
    const base=path.basename(file.url),ext=path.extname(base).toLowerCase();
    if(!allowed.has(ext.slice(1))&&!isJobImage(file.url))return res.status(404).json({message:'File type unavailable.'});
    const absolute=path.join(uploadsDir,base);
    if(!fs.existsSync(absolute))return res.status(404).json({message:'File is missing. Upload it again.'});
    const title=file.title.replace(/[\\/\u0000-\u001f]/g,'_');
    const name=title.toLowerCase().endsWith(ext)?title:title+ext;
    // Documents are authenticated downloads; they never execute on the Suite origin.
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','private, no-store');
    res.download(absolute,name);
  });
}
function uploadStorage(){return multer.diskStorage({destination:uploadsDir,filename:(_req,file,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)});}
