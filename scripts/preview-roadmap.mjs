// Temporary LAN review using a new synthetic database. Never points at production.
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import {testApp} from './test-app.mjs';

const host=process.env.PHONE_PREVIEW_HOST;
if(!host||!(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)))throw new Error('Set PHONE_PREVIEW_HOST to this computer’s private LAN address.');
const app=await testApp({serve:true});
const password='Preview-'+crypto.randomBytes(6).toString('hex');
app.sqlite.prepare("UPDATE users SET pin=?,credential_type='password' WHERE role='owner'").run(await bcrypt.hash(password,12));
const call=async(url,body)=>{const r=await app.api(url,'POST',body,app.owner,{'Idempotency-Key':crypto.randomUUID()});if(r.status>=300)throw new Error(url+': '+JSON.stringify(r.data));return r.data;};
const customer=await call('/api/crm/clients',{name:'Sample customer — phone review',email:'sample@example.test',phone:'555-0100'});
const job=await call('/api/projects',{name:'Sample installation — phone review',jobNumber:'PHONE-PREVIEW',clientId:customer.id});
await call('/api/crm/leads',{name:'Sample request — phone review',clientId:customer.id,site:'metals',source:'other',notes:'Sample data. No real customer messages or payments.'});
const quote=await call('/api/quotes',{type:'custom',customerName:customer.name,totalCents:120000,payload:{type:'custom',customer:{clientId:customer.id,name:customer.name}}});
app.sqlite.prepare("UPDATE quotes SET status='sent' WHERE id=?").run(quote.id);
app.sqlite.prepare('UPDATE projects SET quote_id=? WHERE id=?').run(quote.id,job.id);
const crew=await call('/api/users',{name:'Preview Crew',pin:crypto.randomInt(100000,999999).toString(),role:'worker'});
await call('/api/hr/employees',{userId:crew.id,firstName:'Preview',lastName:'Crew',payType:'hourly',payRateCents:2400});
await call('/api/employee/assignments',{userId:crew.id,projectId:job.id,active:true});
await call('/api/pm/tasks',{title:'Check phone controls',description:'Sample task for physical device review.',projectId:job.id,assigneeId:crew.id});
app.sqlite.prepare("UPDATE users SET name='Preview Owner' WHERE role='owner'").run();
app.sqlite.prepare("UPDATE users SET pin=?,credential_type='password'").run(await bcrypt.hash(password,12));
app.sqlite.prepare("UPDATE settings SET company_name='TEST PREVIEW',company_tagline='Sample records only'").run();
const upstream=new URL(app.base);
const server=http.createServer((req,res)=>{
 const proxy=http.request({hostname:upstream.hostname,port:upstream.port,path:req.url,method:req.method,headers:req.headers},response=>{
  res.writeHead(response.statusCode||502,response.headers);response.pipe(res);
 });
 proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('The local preview is unavailable.');});
 req.on('aborted',()=>proxy.destroy());req.pipe(proxy);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.PHONE_PREVIEW_PORT)||4450,host,resolve);});
const details={url:`http://${host}:${server.address().port}/#/today`,owner:'Preview Owner',crew:'Preview Crew',password,jobId:job.id,quoteId:quote.id,createdAt:new Date().toISOString(),scope:'Synthetic records only; all external requests blocked by the test fixture.'};
if(process.env.PHONE_PREVIEW_INFO)fs.writeFileSync(process.env.PHONE_PREVIEW_INFO,JSON.stringify(details,null,2));
console.log(JSON.stringify(details));
async function close(){await new Promise(resolve=>server.close(resolve));await app.close();process.exit(0);}
process.once('SIGINT',close);process.once('SIGTERM',close);
