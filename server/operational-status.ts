import crypto from 'node:crypto';
import type {Express} from 'express';
import {sqlite} from './storage';
import {requireElevated,requireAuth} from './auth';
import {readableValidation} from '../shared/validation-message';
export const releaseVersion=(process.env.RAILWAY_GIT_COMMIT_SHA||process.env.RELEASE_SHA||'development').slice(0,12);
export function initializeOperationalStatus(){sqlite.exec(`
 CREATE TABLE IF NOT EXISTS suite_service_health(name TEXT PRIMARY KEY,started_at INTEGER,completed_at INTEGER,last_error TEXT);
 CREATE TABLE IF NOT EXISTS suite_error_events(id TEXT PRIMARY KEY,method TEXT NOT NULL,route TEXT NOT NULL,status INTEGER NOT NULL,release TEXT NOT NULL,duration_ms INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS suite_error_age ON suite_error_events(created_at);
`);}
export function workerStarted(name:string){sqlite.prepare('INSERT INTO suite_service_health(name,started_at) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET started_at=excluded.started_at').run(name,Date.now());}
export function workerFinished(name:string,failed=false){sqlite.prepare('UPDATE suite_service_health SET completed_at=?,last_error=? WHERE name=?').run(Date.now(),failed?'Worker run failed. Check service logs.':null,name);}
export function registerOperationalStatus(app:Express){
 initializeOperationalStatus();
 app.use('/api',(req,res,next)=>{
  const start=Date.now(),reference=crypto.randomUUID().slice(0,18);res.setHeader('X-Support-Reference',reference);res.setHeader('X-Release-Version',releaseVersion);
  const json=res.json.bind(res);
  res.json=(body:any)=>{
   if(res.statusCode>=400&&body&&typeof body==='object'&&!Array.isArray(body)){
    const validation=readableValidation(body.message||body.error||body.errors);
    // Unexpected service errors must not expose SQL, provider text or credentials.
    body=res.statusCode>=500?{message:'The service could not finish this request. Your changes were not confirmed. Please retry or share the support reference.',supportReference:reference}:{...body,...(validation||{}),supportReference:reference};
   }
   return json(body);
  };
  res.once('finish',()=>{
   if(res.statusCode<400||[401,404].includes(res.statusCode))return;
   // Never record bodies, query strings, names, addresses, tokens or provider text.
   try{sqlite.prepare('INSERT INTO suite_error_events VALUES(?,?,?,?,?,?,?)').run(reference,req.method,typeof req.route?.path==='string'?req.route.path:'API middleware',res.statusCode,releaseVersion,Date.now()-start,Date.now());sqlite.prepare('DELETE FROM suite_error_events WHERE id NOT IN (SELECT id FROM suite_error_events ORDER BY created_at DESC LIMIT 1000)').run();}catch{console.warn('[support] Could not store diagnostic reference');}
  });next();
 });
 app.get('/api/suite/release',requireAuth,(_req,res)=>res.json({version:releaseVersion}));
 app.get('/api/suite/diagnostics',requireElevated,(_req,res)=>res.json({version:releaseVersion,workers:sqlite.prepare('SELECT * FROM suite_service_health').all(),recent:sqlite.prepare(`SELECT coalesce(sum(status=409),0) conflicts,coalesce(sum(status>=400 AND status<500 AND status!=409),0) corrections,coalesce(sum(status>=500),0) serviceFailures,count(DISTINCT CASE WHEN status>=500 THEN route END) affectedRoutes FROM suite_error_events WHERE created_at>=?`).get(Date.now()-15*60000),errors:sqlite.prepare('SELECT * FROM suite_error_events ORDER BY created_at DESC LIMIT 50').all()}));
}
