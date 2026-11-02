import type {Express,Request} from 'express';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {sqlite} from './storage';
import {requireElevated,getSession} from './auth';
import {WEBSITES,websiteById,type WebsiteId} from '../shared/websites';
import rateLimit from 'express-rate-limit';

type Row={site:WebsiteId;active:number;version:number;updated_at:number;promoted:number};
type Check={path:string;ok:boolean;status:number|null;message:string};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const noCache=(_req:any,res:any,next:any)=>{res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex');next();};

export function registerWebsiteAvailability(app:Express){
 sqlite.exec(`CREATE TABLE IF NOT EXISTS website_availability(site TEXT PRIMARY KEY,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS website_control_keys(id INTEGER PRIMARY KEY CHECK(id=1),private_key TEXT NOT NULL,public_key TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS website_changes(id INTEGER PRIMARY KEY,site TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,active INTEGER NOT NULL,promoted INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS website_preview_tickets(digest TEXT PRIMARY KEY,site TEXT NOT NULL,session_token TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS website_search_tasks(id TEXT PRIMARY KEY,done INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0);`);
 const columns=sqlite.prepare('PRAGMA table_info(website_availability)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='promoted'))sqlite.exec('ALTER TABLE website_availability ADD COLUMN promoted INTEGER NOT NULL DEFAULT 1');
 for(const site of WEBSITES)sqlite.prepare('INSERT OR IGNORE INTO website_availability(site,active,updated_at,promoted) VALUES(?,?,0,?)').run(site.id,Number(site.defaultActive),Number(site.id!=='insulation'));
 sqlite.prepare("UPDATE website_availability SET promoted=0 WHERE site='insulation'").run();
 if(!sqlite.prepare('SELECT id FROM website_control_keys WHERE id=1').get()){
  const pair=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  sqlite.prepare('INSERT INTO website_control_keys VALUES(1,?,?)').run(pair.privateKey,pair.publicKey);
 }
 const keys=sqlite.prepare('SELECT private_key,public_key FROM website_control_keys WHERE id=1').get() as {private_key:string;public_key:string};
 const rows=()=>sqlite.prepare('SELECT * FROM website_availability').all() as Row[];
 const read=(id:string)=>{const r=rows().find(r=>r.site===id)!;return {site:r.site,active:r.active===1,promoted:r.promoted===1,version:r.version,updatedAt:r.updated_at};};
 // A fresh change after a database restore must supersede website copies saved before the restore.
 const policy=()=>({schemaVersion:1,revision:Math.max(0,...rows().map(r=>r.updated_at))+rows().reduce((sum,r)=>sum+r.version,0),sites:WEBSITES.map(s=>({...read(s.id),promoted:s.id!=='insulation'&&read(s.id).promoted&&read(s.id).active})),previewPublicKey:keys.public_key});
 const history=(site:string)=>sqlite.prepare('SELECT actor,action,active,promoted,created_at AS createdAt FROM website_changes WHERE site=? ORDER BY id DESC LIMIT 8').all(site);
 const record=(req:Request,site:string,action:string)=>{const r=read(site);sqlite.prepare('INSERT INTO website_changes(site,actor,action,active,promoted,created_at) VALUES(?,?,?,?,?,?)').run(site,req.user?.name||'Owner',action,Number(r.active),Number(r.promoted),Date.now());};
 const previewSession=(site:string)=>{const payload=Buffer.from(JSON.stringify({site,exp:Date.now()+15*60_000,kind:'preview',nonce:randomBytes(16).toString('hex')})).toString('base64url');return payload+'.'+sign(null,Buffer.from(payload),keys.private_key).toString('base64url');};
 const observations=new Map<string,any>(),pendingChecks=new Map<string,Promise<any>>();
 async function checkSite(id:WebsiteId,preview=false){
  const site=websiteById(id)!,saved=read(id),checkKey=id+(preview?':preview':'');
  if(pendingChecks.has(checkKey))return pendingChecks.get(checkKey);
  const work=(async()=>{
   const checks:Check[]=[],cookie=preview?'__Host-cjm-preview='+previewSession(id):undefined;
   async function inspect(path:string,expected:number){
    try{let address=site.url+path;let response:Response;
     for(let redirects=0;;redirects++){
      response=await fetch(address,{headers:{...(cookie?{Cookie:cookie}:{}),'Cache-Control':'no-cache'},redirect:'manual',signal:AbortSignal.timeout(7000)});
      if(![301,302,307,308].includes(response.status))break;
      const next=new URL(response.headers.get('location')||'',address);
      if(redirects>=2||next.origin!==site.url)throw Error('Unexpected website redirect');
      address=next.href;
     }
     const body=await response.text();checks.push({path,status:response.status,ok:response.status===expected,message:response.status===expected?'Passed':'Expected '+expected+', received '+response.status});return {response,body};
    }catch{checks.push({path,status:null,ok:false,message:'The website could not be reached.'});return null;}
   }
   const control=await inspect('/__cjm/status',200);let data:any;
   try{data=control?JSON.parse(control.body):null;}catch{}
   if(!data||data.site!==id||typeof data.active!=='boolean')checks.push({path:'/__cjm/status',status:null,ok:false,message:'Website controls are not connected yet.'});
   const expected=preview||saved.active?200:410;
   const [home]=await Promise.all([inspect('/',expected),inspect('/es/',expected)]);
   if(preview){
    await inspect(site.service,200);
    if(home?.response.ok){
     if(!home.body.includes('cjm-private-preview'))checks.push({path:'/',status:200,ok:false,message:'Private preview protection was not confirmed.'});
     const assets=[...home.body.matchAll(/(?:src|href)=["'](\/(?!\/)[^"'?#]+\.(?:js|css|webp|png|svg))["']/g)].map(m=>m[1]);
     await Promise.all([...new Set(assets)].slice(0,8).map(path=>inspect(path,200)));
     const quote=await inspect('/api/quote',403);
     if(quote&&quote.response.headers.get('x-cjm-preview')!=='true')checks.push({path:'/api/quote',status:quote.response.status,ok:false,message:'Preview form protection was not confirmed.'});
    }
   }
   const confirmed=checks.every(c=>c.ok)&&!!data&&(preview||data.active===saved.active&&data.revision===policy().revision);
   const result={checkedAt:Date.now(),confirmed,checks,durable:data?.durable===true,syncHealthy:data?.syncHealthy===true,revision:data?.revision??null,preview};
   observations.set(checkKey,result);return result;
  })().finally(()=>pendingChecks.delete(checkKey));pendingChecks.set(checkKey,work);return work;
 }
 app.use(['/api/settings/website','/api/settings/websites','/api/public/website-status','/api/public/website-policy','/api/public/website-preview'],noCache);
 app.get('/api/public/website-policy',(_req,res)=>res.json(policy()));
 app.get('/api/public/website-status/insulation',(_req,res)=>res.json({active:read('insulation').active}));
 app.use('/api/public/leads',(req,res,next)=>{
  if(req.method!=='POST')return next();
  const origin=typeof req.body?.site==='string'?req.body.site:'metals';
  if(websiteById(origin)&&!read(origin).active)return res.status(409).json({message:'This website is not accepting requests.'});
  const requested=Array.isArray(req.body?.requestedTrades)?req.body.requestedTrades:[];
  if(requested.some((id:unknown)=>typeof id==='string'&&id!==origin&&websiteById(id)&&(!read(id).active||!read(id).promoted)))return res.status(409).json({message:'One of the selected trades is no longer offered on this website. Refresh the form and review your selection.'});
  next();
 });
 app.get('/api/settings/websites',requireElevated,(_req,res)=>res.json({sites:WEBSITES.map(s=>({...s,...read(s.id),history:history(s.id),verification:observations.has(s.id)?{...observations.get(s.id),confirmed:observations.get(s.id).confirmed&&observations.get(s.id).revision===policy().revision&&observations.get(s.id).checkedAt>Date.now()-120_000}:null,preflight:observations.get(s.id+':preview')||null})),revision:policy().revision}));
 app.get('/api/settings/website/:site',requireElevated,(req,res)=>{if(!websiteById(String(req.params.site)))return res.sendStatus(404);res.json(read(String(req.params.site)));});
 app.post('/api/settings/websites/:site/check',requireElevated,async(req,res)=>{const site=websiteById(String(req.params.site));if(!site)return res.sendStatus(404);res.json(await checkSite(site.id,req.body?.preview===true));});
 app.put('/api/settings/website/:site',requireElevated,async(req,res)=>{
  const site=websiteById(String(req.params.site));if(!site)return res.sendStatus(404);
  const {active,promoted,version}=req.body||{},before=read(site.id);
  if(typeof active!=='boolean'||!Number.isSafeInteger(version)||version<1||(promoted!==undefined&&typeof promoted!=='boolean'))return res.status(400).json({message:'Choose a website status and reload its current version.'});
  if(version!==before.version)return res.status(409).json({message:'The website status changed elsewhere. Refresh and try again.'});
  if(site.id==='insulation'&&promoted===true)return res.status(400).json({message:'Insulation stays excluded from the other CJM websites.'});
  if(active&&!before.active){const ready=await checkSite(site.id,true);if(!ready.confirmed)return res.status(422).json({message:'The private preview checks must pass before this website can go live.',preflight:ready});}
  const changed=sqlite.transaction(()=>{
   const result=sqlite.prepare('UPDATE website_availability SET active=?,promoted=?,version=version+1,updated_at=? WHERE site=? AND version=?').run(Number(active),Number(site.id!=='insulation'&&(promoted??before.promoted)),Date.now(),site.id,version);
   if(result.changes)record(req,site.id,active!==before.active?(active?'Activated website':'Deactivated website'):'Updated family visibility');return result.changes;
  })();
  if(!changed)return res.status(409).json({message:'The website status changed elsewhere. Refresh and try again.'});
  observations.delete(site.id);res.json(read(site.id));
 });
 app.post('/api/settings/websites/:site/preview',requireElevated,(req,res)=>{
  const site=websiteById(String(req.params.site));if(!site)return res.sendStatus(404);
  sqlite.prepare('DELETE FROM website_preview_tickets WHERE expires<?').run(Date.now());
  const token=randomBytes(32).toString('base64url');
  sqlite.prepare('INSERT INTO website_preview_tickets VALUES(?,?,?,?)').run(hash(token),site.id,req.user!.token,Date.now()+60_000);
  res.json({url:site.url+'/__cjm/preview',token,expiresIn:60});
 });
 app.post('/api/public/website-preview/exchange',rateLimit({windowMs:60_000,limit:60,standardHeaders:true,legacyHeaders:false}),(req,res)=>{
  const {token,site}=req.body||{};if(typeof token!=='string'||token.length>100||typeof site!=='string'||!websiteById(site))return res.sendStatus(400);
  const ticket=sqlite.transaction(()=>{const t=sqlite.prepare('SELECT * FROM website_preview_tickets WHERE digest=? AND site=? AND expires>?').get(hash(token),site,Date.now()) as any;if(t)sqlite.prepare('DELETE FROM website_preview_tickets WHERE digest=?').run(hash(token));return t;})();
  const session=ticket&&getSession(ticket.session_token);
  if(!session||!['owner','manager'].includes(session.role))return res.status(403).json({message:'Preview link expired. Open a new preview from the Suite.'});
  res.json({cookie:previewSession(site)});
 });
 const taskIds=['google-removal','bing-removal','business-profile','social-directory-links'];
 for(const id of taskIds)sqlite.prepare('INSERT OR IGNORE INTO website_search_tasks(id) VALUES(?)').run(id);
 app.get('/api/settings/websites/search-cleanup',requireElevated,(_req,res)=>res.json({tasks:sqlite.prepare('SELECT id,done,note,updated_at AS updatedAt FROM website_search_tasks').all()}));
 app.put('/api/settings/websites/search-cleanup/:id',requireElevated,(req,res)=>{
  if(!taskIds.includes(String(req.params.id))||typeof req.body?.done!=='boolean'||typeof req.body?.note!=='string'||req.body.note.length>1000)return res.sendStatus(400);
  sqlite.prepare('UPDATE website_search_tasks SET done=?,note=?,updated_at=? WHERE id=?').run(Number(req.body.done),req.body.note,Date.now(),String(req.params.id));res.json({ok:true});
 });
}

