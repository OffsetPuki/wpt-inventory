import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {audit} from './audit';
import {designRecord} from './design-registry';
import {concreteEstimateSchema,defaultConcreteEstimate,calculateConcrete} from '../shared/concrete-estimate';

export function registerConcreteEstimates(app:Express){
 sqlite.exec(`CREATE TABLE IF NOT EXISTS suite_concrete_estimates(design_id INTEGER PRIMARY KEY REFERENCES suite_designs(id),version INTEGER NOT NULL,payload_json TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by INTEGER NOT NULL REFERENCES users(id));`);
 const id=z.coerce.number().int().positive();
 const read=(designId:number)=>{const row=sqlite.prepare('SELECT * FROM suite_concrete_estimates WHERE design_id=?').get(designId) as any;const data=row?concreteEstimateSchema.parse(JSON.parse(row.payload_json)):defaultConcreteEstimate();return {version:row?.version||0,data,updatedAt:row?.updated_at||null,calculation:calculateConcrete(data)};};
 const design=(designId:number)=>{const d=designRecord(designId);if(d.model_key!=='residential-concrete')throw Object.assign(new Error('Choose a concrete design.'),{status:400});return d;};
 const fail=(res:any,e:any)=>res.status(e instanceof z.ZodError?400:e.status||500).json({message:e instanceof z.ZodError?e.issues.map(i=>i.path.join('.')+': '+i.message).join('\n'):e.message});
 app.get('/api/design-studio/registry/:id/concrete-estimate',requireElevated,(req,res)=>{try{const designId=id.parse(req.params.id);design(designId);res.json(read(designId));}catch(e){fail(res,e);}});
 app.put('/api/design-studio/registry/:id/concrete-estimate',requireElevated,(req,res)=>{try{
  const designId=id.parse(req.params.id),body=z.object({version:z.number().int().min(0),data:concreteEstimateSchema}).strict().parse(req.body);
  const result=sqlite.transaction(()=>{
   const d=design(designId);if(d.archived_at)throw Object.assign(new Error('Restore this design before editing its estimate.'),{status:409});
   const before=read(designId);if(before.version!==body.version)throw Object.assign(new Error('This estimate changed on another device. Your draft is kept. Review the saved version before saving again.'),{status:409});
   const now=Date.now();sqlite.prepare('INSERT INTO suite_concrete_estimates(design_id,version,payload_json,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(design_id) DO UPDATE SET version=excluded.version,payload_json=excluded.payload_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(designId,before.version+1,JSON.stringify(body.data),now,req.user!.userId);
   const after=read(designId);sqlite.prepare('INSERT INTO suite_design_history(design_id,snapshot_json,created_at,created_by) VALUES(?,?,?,?)').run(designId,JSON.stringify({before:d,after:d,concreteEstimate:{previous:before,current:after}}),now,req.user!.userId);
   audit(req,'design.concrete_estimate_saved',{targetType:'design',targetId:designId,details:{version:after.version,total:after.calculation.total}});return after;
  })();res.json(result);
 }catch(e){fail(res,e);}});
}
