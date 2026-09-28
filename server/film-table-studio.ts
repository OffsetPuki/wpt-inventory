import type {Express} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {requireElevated} from './auth';

// Read-only shop drawings. These assets never become public customer options.
export function registerFilmTableStudio(app:Express) {
  const root=path.resolve('server/design-studio/current');
  const send=(res:any,file:string,type:string)=>{
    const target=path.join(root,file);
    if(!fs.existsSync(target)){res.status(503).json({message:'The current table drawings have not been installed.'});return;}
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.type(type).sendFile(target);
  };
  app.get('/api/design-studio/film-table/parts',requireElevated,(_req,res)=>send(res,'parts.json','json'));
  const currentRevision=(req:any,res:any)=>{const index=path.join(root,'parts.json');if(!fs.existsSync(index)){res.status(503).json({message:'Drawings are not installed.'});return false;}const revision=JSON.parse(fs.readFileSync(index,'utf8')).revision;if(req.query.revision&&req.query.revision!==revision){res.status(409).json({message:'The model has changed. Refresh the workspace to use the current drawings.'});return false;}return true;};
  app.get('/api/design-studio/film-table/field-book',requireElevated,(req,res)=>{
    if(!currentRevision(req,res))return;
    const meta=path.join(root,'field-book-meta.json');
    if(!fs.existsSync(meta)||JSON.parse(fs.readFileSync(meta,'utf8')).revision!==JSON.parse(fs.readFileSync(path.join(root,'parts.json'),'utf8')).revision){res.status(503).json({message:'The offline field book needs to be rebuilt for this revision.'});return;}
    send(res,'field-book.html','html');
  });
  app.get('/api/design-studio/film-table/parts/:partId',requireElevated,(req,res)=>{
    if(!currentRevision(req,res))return;
    if(!/^FT-\d{3}$/.test(String(req.params.partId))){res.status(404).json({message:'Part not found.'});return;}
    const index=path.join(root,'parts.json');
    if(!fs.existsSync(index)){res.status(503).json({message:'The current table drawings have not been installed.'});return;}
    if(!JSON.parse(fs.readFileSync(index,'utf8')).parts.some((p:{id:string})=>p.id===req.params.partId)){res.status(404).json({message:'Part not found.'});return;}
    const file='parts/'+req.params.partId+'.json';
    if(!fs.existsSync(path.join(root,file))){res.status(404).json({message:'Part not found.'});return;}
    send(res,file,'json');
  });
  app.get('/api/design-studio/film-table/geometry',requireElevated,(_req,res)=>send(res,'studio-model.bin.gz','application/octet-stream'));
}
