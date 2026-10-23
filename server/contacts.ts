import type { Express } from 'express';
import { sqlite } from './storage';
import { requireAuth, requireElevated } from './auth';
import { audit } from './audit';
import { contactInput, type BusinessContact } from '../shared/contacts';

sqlite.exec(`CREATE TABLE IF NOT EXISTS business_contacts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL,
 company TEXT NOT NULL, title TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
 website TEXT NOT NULL, address TEXT NOT NULL, services TEXT NOT NULL, notes TEXT NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS business_contacts_name ON business_contacts(name COLLATE NOCASE);`);
const select = `SELECT id,name,type,company,title,email,phone,website,address,services,notes,archived,version,created_at AS createdAt,updated_at AS updatedAt FROM business_contacts`;
const decode=(row:any):BusinessContact=>({...row,archived:!!row.archived});
export function registerContacts(app:Express){
  app.get('/api/contacts',requireAuth,requireElevated,(_req,res)=>{
    res.json(sqlite.prepare(select+' ORDER BY name COLLATE NOCASE,id').all().map(decode));
  });
  app.post('/api/contacts',requireAuth,requireElevated,(req,res)=>{
    const parsed=contactInput.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
    const d=parsed.data,now=Date.now();
    const result=sqlite.prepare(`INSERT INTO business_contacts(name,type,company,title,email,phone,website,address,services,notes,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.name,d.type,d.company,d.title,d.email,d.phone,d.website,d.address,d.services,d.notes,Number(d.archived),now,now);
    const id=Number(result.lastInsertRowid);audit(req,'contact.created',{targetType:'contact',targetId:id,targetName:d.name});
    res.status(201).json(decode(sqlite.prepare(select+' WHERE id=?').get(id)));
  });
  app.put('/api/contacts/:id',requireAuth,requireElevated,(req,res)=>{
    const id=Number(req.params.id),parsed=contactInput.safeParse(req.body),version=req.body?.version;
    if(!Number.isSafeInteger(id)||id<1||!parsed.success||!Number.isSafeInteger(version))return res.status(400).json({message:parsed.success?'Invalid contact or version':parsed.error.issues[0].message});
    const d=parsed.data;
    const result=sqlite.prepare(`UPDATE business_contacts SET name=?,type=?,company=?,title=?,email=?,phone=?,website=?,address=?,services=?,notes=?,archived=?,updated_at=?,version=version+1 WHERE id=? AND version=?`).run(d.name,d.type,d.company,d.title,d.email,d.phone,d.website,d.address,d.services,d.notes,Number(d.archived),Date.now(),id,version);
    if(!result.changes)return res.status(409).json({message:'This contact changed. Refresh the directory and reopen it before saving.'});
    audit(req,'contact.updated',{targetType:'contact',targetId:id,targetName:d.name});res.json(decode(sqlite.prepare(select+' WHERE id=?').get(id)));
  });
}
