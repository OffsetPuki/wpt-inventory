import type {Express} from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {requireElevated} from './auth';
import {sqlite,uploadsDir} from './storage';
import {JOB_DOCUMENT_EXTENSIONS,JOB_FILE_MAX_BYTES,isJobImage} from '../shared/job-files';

const allowed=new Set<string>(JOB_DOCUMENT_EXTENSIONS);
const upload=multer({
  storage:multer.diskStorage({destination:uploadsDir,filename:(_req,file,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)}),
  limits:{fileSize:JOB_FILE_MAX_BYTES,files:1},
  fileFilter:(_req,file,cb)=>allowed.has(path.extname(file.originalname).slice(1).toLowerCase())?cb(null,true):cb(new Error('Choose a PDF, Word, Excel, text, CAD, or ZIP file.')),
});
export function registerJobFileRoutes(app:Express){
  const active=(id:unknown)=>sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL').get(Number(id)||0);
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
  app.get('/api/suite/jobs/:id/files/:fileId/download',requireElevated,(req,res)=>{
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
