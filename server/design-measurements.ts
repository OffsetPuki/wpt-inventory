import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {audit} from './audit';
import {designRecord} from './design-registry';
import {businessDay} from './business-clock';

const positiveId=z.coerce.number().int().positive();
const bodySchema=z.object({
 version:z.string(),part:z.string().trim().min(1).max(120),dimension:z.string().trim().min(1).max(120),
 value:z.number().finite().min(-1000000).max(1000000),tolerance:z.number().finite().min(0).max(10000),unit:z.enum(['mm','in']),
 datum:z.string().trim().min(3).max(240),source:z.enum(['field-measurement','approved-drawing','supplier-specification']),
 reference:z.string().trim().min(3).max(500),measuredDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),fileId:z.number().int().positive().nullable(),
 confirmed:z.literal(true),
});
const problem=(message:string,status=400)=>Object.assign(new Error(message),{status});
export function designMeasurements(designId:number){
 return sqlite.prepare(`SELECT m.*,u.name verified_by FROM suite_design_measurements m JOIN users u ON u.id=m.verified_by_id
  WHERE m.design_id=? ORDER BY m.model_revision,m.part,m.dimension,m.id`).all(designId) as any[];
}
export function registerDesignMeasurements(app:Express){
 sqlite.exec(`CREATE TABLE IF NOT EXISTS suite_design_measurements(
  id INTEGER PRIMARY KEY AUTOINCREMENT,design_id INTEGER NOT NULL REFERENCES suite_designs(id),model_revision TEXT NOT NULL,
  part TEXT NOT NULL,dimension TEXT NOT NULL,value_mm REAL NOT NULL,tolerance_mm REAL NOT NULL,entered_unit TEXT NOT NULL,
  datum TEXT NOT NULL,source TEXT NOT NULL,reference TEXT NOT NULL,measured_date TEXT NOT NULL,source_file_id INTEGER REFERENCES suite_files(id),
  verified_by_id INTEGER NOT NULL REFERENCES users(id),verified_at INTEGER NOT NULL,
  UNIQUE(design_id,model_revision,part,dimension));`);
 app.get('/api/design-studio/registry/:id/measurements',requireElevated,(req,res)=>{try{
  const design=designRecord(positiveId.parse(req.params.id)),all=designMeasurements(design.id);
  const previous=req.query.previous==='true',rows=all.filter(r=>previous?r.model_revision!==design.model_revision:r.model_revision===design.model_revision);
  const page=Math.min(z.coerce.number().int().min(0).max(100000).parse(req.query.page||0),Math.max(0,Math.ceil(rows.length/20)-1));
  res.json({rows:rows.slice(page*20,page*20+20),total:rows.length,page,design,manufacturingReady:false});
 }catch(e:any){res.status(e instanceof z.ZodError?400:e.status||500).json({message:e.message});}});
 app.post('/api/design-studio/registry/:id/measurements',requireElevated,(req,res)=>{try{
  const designId=positiveId.parse(req.params.id),body=bodySchema.parse(req.body);
  const parsed=new Date(body.measuredDate+'T12:00:00Z');
  if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==body.measuredDate||body.measuredDate>businessDay())throw problem('Use the actual measurement or source-review date, no later than today.');
  const saved=sqlite.transaction(()=>{
   const design=designRecord(designId);
   if(design.archived_at||design.revisionChanged||design.relationshipChanged)throw problem('Review the active design and its connections before recording measurements.');
   if(body.version!==design.version)throw problem('The design changed. Reload the measurement log before saving.',409);
   if(body.fileId){const file=sqlite.prepare('SELECT project_id FROM suite_files WHERE id=?').get(body.fileId) as any;if(!file||!design.project_id||file.project_id!==design.project_id)throw problem('Choose a source file attached to this design’s job.');}
   const previous=sqlite.prepare('SELECT * FROM suite_design_measurements WHERE design_id=? AND model_revision=? AND part=? AND dimension=?').get(designId,design.model_revision,body.part,body.dimension);
   if(!previous&&(sqlite.prepare('SELECT count(*) n FROM suite_design_measurements WHERE design_id=?').get(designId) as any).n>=1000)throw problem('This design has 1,000 measurements. Start a separate design for the next assembly.');
   const factor=body.unit==='in'?25.4:1,now=Date.now();
   sqlite.prepare(`INSERT INTO suite_design_measurements(design_id,model_revision,part,dimension,value_mm,tolerance_mm,entered_unit,datum,source,reference,measured_date,source_file_id,verified_by_id,verified_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(design_id,model_revision,part,dimension) DO UPDATE SET
    value_mm=excluded.value_mm,tolerance_mm=excluded.tolerance_mm,entered_unit=excluded.entered_unit,datum=excluded.datum,source=excluded.source,reference=excluded.reference,
    measured_date=excluded.measured_date,source_file_id=excluded.source_file_id,verified_by_id=excluded.verified_by_id,verified_at=excluded.verified_at`).run(designId,design.model_revision,body.part,body.dimension,body.value*factor,body.tolerance*factor,body.unit,body.datum,body.source,body.reference,body.measuredDate,body.fileId,req.user!.userId,now);
   // A monotonic revision stamp also rejects two saves in the same millisecond.
   sqlite.prepare('UPDATE suite_designs SET updated_at=max(updated_at+1,?) WHERE id=?').run(now,designId);
   const after=designRecord(designId);
   sqlite.prepare('INSERT INTO suite_design_history(design_id,snapshot_json,created_at,created_by) VALUES(?,?,?,?)').run(designId,JSON.stringify({after,measurement:{previous:previous||null,recorded:body}}),now,req.user!.userId);
   audit(req,'design.measurement',{targetType:'design',targetId:designId,details:{part:body.part,dimension:body.dimension,revision:design.model_revision}});
   return {design:after,manufacturingReady:false};
  })();res.status(201).json(saved);
 }catch(e:any){res.status(e instanceof z.ZodError?400:e.status||500).json({message:e.message});}});
 app.get('/api/design-studio/registry/:id/measurements.csv',requireElevated,(req,res)=>{try{
  const design=designRecord(positiveId.parse(req.params.id));
  const cell=(value:unknown)=>{let s=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['REFERENCE MEASUREMENT LOG — NOT A MANUFACTURING RELEASE'],['Design',design.name,'Model revision',design.model_revision],
   ['Part','Dimension','Value mm','Tolerance ± mm','Datum','Source','Reference','Measured / reviewed date','Recorded by'],
   ...designMeasurements(design.id).filter(m=>m.model_revision===design.model_revision).map(m=>[m.part,m.dimension,m.value_mm,m.tolerance_mm,m.datum,m.source,m.reference,m.measured_date,m.verified_by])];
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`attachment; filename="design-${design.id}-measurements.csv"`);res.type('text/csv').send('\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n'));
 }catch(e:any){res.status(e instanceof z.ZodError?400:e.status||500).json({message:e.message});}});
}
