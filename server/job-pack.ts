import {jobDesigns} from './design-registry';
import {designMeasurements} from './design-measurements';
import type {Express} from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {sqlite,uploadsDir} from './storage';
import {requireAuth} from './auth';
import {isElevated} from './http-util';
import {employeeHasJob} from './employee-data';
import {businessTimeZone} from './business-clock';
import {jobRecord} from './suite-data';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function buildJobPack(id:number){
 const job=jobRecord(id),customer=job.client_id?sqlite.prepare('SELECT name,company,phone FROM crm_clients WHERE id=? AND deleted_at IS NULL').get(job.client_id) as any:null;
 const tasks=sqlite.prepare('SELECT t.title,t.status,t.start_date,t.due_date,u.name owner FROM pm_tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? AND t.deleted_at IS NULL ORDER BY t.due_date IS NULL,t.due_date,t.id').all(id) as any[];
 const parts=sqlite.prepare('SELECT label,qty,unit,status,notes FROM project_checklist WHERE project_id=? ORDER BY order_index,id').all(id) as any[];
 const files=sqlite.prepare('SELECT id,title,url,kind,created_at,replaces_id FROM suite_files WHERE project_id=? ORDER BY id DESC').all(id) as any[];
 const source=sqlite.prepare('SELECT template_key,template_version FROM suite_template_runs WHERE project_id=?').get(id) as any;
 let remaining=12*1024*1024,excluded=0;
 const attachments=files.filter(f=>!files.some(newer=>newer.replaces_id===f.id)).map(f=>{
   const filePath=/^\/uploads\/[A-Za-z0-9_.-]+$/.test(f.url)?path.join(uploadsDir,path.basename(f.url)):'';
   if(!filePath||!fs.existsSync(filePath)){excluded++;return {...f,problem:'File missing from server; recover it before field work.'};}
   const bytes=fs.statSync(filePath).size;
   if(bytes>remaining){excluded++;return {...f,problem:'Download separately from the job; exceeds this pack’s 12 MB attachment budget.'};}
   remaining-=bytes;
   const data=fs.readFileSync(filePath).toString('base64'),extension=path.extname(filePath).toLowerCase(),imageMime=({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'} as Record<string,string>)[extension];
   return {...f,bytes,extension,imageMime,data};
 });
 const designs=jobDesigns(id).filter(d=>!d.archived_at).map(d=>({name:d.name,revision:d.model_revision,needsReview:!d.approved_at||d.relationshipChanged||d.revisionChanged,measurements:designMeasurements(d.id).filter(m=>m.model_revision===d.model_revision).map(m=>({part:m.part,dimension:m.dimension,value:m.value_mm,tolerance:m.tolerance_mm,datum:m.datum,source:m.reference,date:m.measured_date,reviewer:m.verified_by}))}));
 const generatedAt=Date.now(),revision=crypto.createHash('sha256').update(JSON.stringify({job,customer,tasks,parts,attachments,source,designs})).digest('hex').slice(0,12);
 const table=(headers:string[],rows:unknown[][])=>`<div class="table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 const when=new Intl.DateTimeFormat('en-US',{timeZone:businessTimeZone,dateStyle:'medium',timeStyle:'short'}).format(generatedAt);
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(job.name)} · Offline job pack</title><style>body{margin:0;background:#f3f5f6;color:#17252b;font:16px/1.55 system-ui,sans-serif}main{max-width:950px;margin:auto;padding:24px}header{border-top:5px solid #ee8800}header,section{padding:24px;background:#fff;border:1px solid #dae1e4;border-radius:16px;margin-bottom:18px}h1{font-size:clamp(25px,5vw,40px);line-height:1.15}h2{font-size:21px}p{overflow-wrap:anywhere}.muted{color:#4b626c;font-size:14px}.notice{background:#fff2d7;padding:14px;border-radius:10px}.table{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px;border-bottom:1px solid #dae1e4;vertical-align:top}a{display:inline-block;min-height:44px;line-height:44px;color:#00677d}img{max-width:100%;max-height:650px;object-fit:contain}.file{border-top:1px solid #ddd;margin-top:16px}small{display:block}@media(max-width:480px){main{padding:10px}header,section{padding:16px}th,td{padding:8px;font-size:14px}}@media print{body{background:white}main{padding:0}section{break-inside:avoid}.table{overflow:visible}}</style></head><body><main><header><p class="muted">CJM · PRIVATE TEAM COPY · OFFLINE JOB PACK</p><h1>${esc(job.name)}</h1><p>${esc(job.job_number)} · ${esc(job.site)} · ${esc(job.status)}</p><p class="notice">Snapshot saved ${esc(when)} (${esc(businessTimeZone)}). Revision ${revision}. Re-download before work if the job changes. This copy cannot save changes, approve work or collect payments.</p>${excluded?`<p class="notice">${excluded} file(s) need separate download or recovery. Review the file list before going offline.</p>`:''}</header><section><h2>Job details</h2><p>${esc(customer?.company||customer?.name||job.customer||'Customer not linked')}</p><p>${esc(customer?.phone||'')}<br>${esc(job.site_address||'Address not set')}</p><p>Schedule: ${esc(job.schedule_state)} · ${esc(job.start_date||'Start not set')} → ${esc(job.due_date||'Finish not set')}</p>${source?`<p class="muted">Template ${esc(source.template_key)} · Revision ${esc(source.template_version.slice(0,12))}</p>`:''}<p>${esc(job.notes||'')}</p></section><section><h2>Work plan</h2>${table(['Task','Owner','State','Due'],tasks.map(t=>[t.title,t.owner||'Unassigned',t.status,t.due_date||'Not set']))}</section><section><h2>Checklist & materials</h2>${table(['Item','Quantity','State','Notes'],parts.map(p=>[p.label,`${p.qty||''} ${p.unit||''}`,p.status,p.notes]))}</section><section><h2>Design revisions &amp; measurement sources</h2><p class="notice">Reference records only. Manufacturing packs remain incomplete until all parts, hole centers, radii, materials and tolerances are verified and incorporated into approved drawings. Values below do not change the model geometry.</p>${designs.map(d=>`<h3>${esc(d.name)}</h3><p>Model ${esc(d.revision)} · ${d.needsReview?'Needs layout / connection review':'Layout reviewed'}</p>${table(['Part / dimension','mm ± tolerance','Origin','Source / review'],d.measurements.map(m=>[m.part+' · '+m.dimension,m.value+' ± '+m.tolerance,m.datum,m.source+' · '+m.date+' · '+m.reviewer]))}`).join('')||'<p>No job designs linked.</p>'}</section><section><h2>Current team files</h2><p class="muted">Current revisions attached directly to this job. Company documents and customer previews are available separately in the website. Download links below contain the original file bytes.</p>${attachments.map(f=>`<article class="file"><h3>${esc(f.title)}</h3><small>File ${f.id} · ${esc(f.kind)}</small>${f.problem?`<p class="notice">${esc(f.problem)}</p>`:`${f.imageMime?`<img alt="${esc(f.title)}" src="data:${f.imageMime};base64,${f.data}" loading="lazy">`:''}<a download="${esc(f.title.toLowerCase().endsWith(f.extension)?f.title:f.title+f.extension)}" href="data:application/octet-stream;base64,${f.data}">Save ${esc(f.title)}</a>`}</article>`).join('')||'<p>No team files attached.</p>'}</section></main></body></html>`;
 return {html,revision,excluded,filename:`job-${id}-${revision}.html`};
}
export function registerJobPacks(app:Express){
 for(const route of ['/api/suite/jobs/:id/pack','/api/employee/jobs/:id/pack'])app.get(route,requireAuth,(req,res)=>{try{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({message:'Choose a valid job.'});
  if(!isElevated(req)&&!employeeHasJob(req.user!.userId,id))return res.status(403).json({message:'This job is not assigned to you.'});
  const pack=buildJobPack(id);res.setHeader('Content-Disposition',`attachment; filename="${pack.filename}"`);res.setHeader('X-Pack-Revision',pack.revision);res.setHeader('X-Pack-Excluded',String(pack.excluded));res.setHeader('Cache-Control','private, no-store');res.type('html').send(pack.html);
 }catch(e:any){res.status(e.status||400).json({message:e.message});}});
}
