import type {Express} from 'express';
import {requireElevated} from './auth';
import {sqlite} from './storage';
import {audit} from './audit';
export function registerCrmRecovery(app:Express){
  for(const [resource,table,label] of [['clients','crm_clients','customer'],['leads','crm_leads','lead']]){
    app.get(`/api/crm/${resource}/deleted`,requireElevated,(req,res)=>{
      const pattern='%'+String(req.query.q||'').trim().slice(0,100).replace(/[\\%_]/g,'\\$&')+'%';
      res.json(sqlite.prepare(`SELECT id,name,email,phone,deleted_at deletedAt FROM ${table} WHERE deleted_at IS NOT NULL AND name LIKE ? ESCAPE '\\' ORDER BY deleted_at DESC,id DESC LIMIT 100`).all(pattern));
    });
    app.post(`/api/crm/${resource}/:id/restore`,requireElevated,(req,res)=>{
      const id=Number(req.params.id)||0;
      const record=sqlite.prepare(`SELECT id,name,deleted_at FROM ${table} WHERE id=?`).get(id) as {id:number;name:string;deleted_at:number|null}|undefined;
      if(!record)return res.status(404).json({message:`This ${label} could not be found.`});
      if(record.deleted_at!==null){
        sqlite.prepare(`UPDATE ${table} SET deleted_at=NULL WHERE id=?`).run(id);
        audit(req,`crm.${label}_restore`,{targetType:label==='customer'?'client':'lead',targetId:id,targetName:record.name});
      }
      res.json({ok:true,id});
    });
  }
}
