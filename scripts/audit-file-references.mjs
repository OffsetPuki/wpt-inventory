// Read-only reconciliation. Candidates require review, never automatic deletion.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const dbPath=process.argv[2], uploads=process.argv[3];
if(!dbPath||!uploads)throw Error('Usage: node scripts/audit-file-references.mjs DATABASE UPLOAD_DIRECTORY');
const db=new Database(path.resolve(dbPath),{readonly:true,fileMustExist:true});
const referenced=new Set();
const quote=s=>'"'+s.replaceAll('"','""')+'"';
try {
  db.transaction(()=>{
    for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
      const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all().filter(c=>/TEXT|CHAR|CLOB/i.test(c.type));
      if(!columns.length)continue;
      for(const row of db.prepare('SELECT '+columns.map(c=>quote(c.name)).join(',')+' FROM '+quote(name)).iterate()) {
        for(const value of Object.values(row))if(typeof value==='string')for(const token of value.match(/[A-Za-z0-9._-]+/g)||[])referenced.add(token);
      }
    }
  })();
  const files=[];
  for(const directory of [path.resolve(uploads),path.join(path.dirname(path.resolve(dbPath)),'mail-attachments')]) {
    if(!fs.existsSync(directory))continue;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}))if(entry.isFile()){
      const info=fs.statSync(path.join(directory,entry.name));
      if(!referenced.has(entry.name))files.push({directory: path.basename(directory),file:entry.name,bytes:info.size,modified:info.mtime.toISOString()});
    }
  }
  console.log(JSON.stringify({mode:'report-only',notice:'No files changed. Review candidates against external references and backups before removal.',candidates:files},null,2));
} finally {db.close();}
