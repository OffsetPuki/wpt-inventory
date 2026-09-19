import crypto from 'node:crypto';
import { sqlite } from './storage';
import { hasLeadKey } from './public-api';
import type { Express } from 'express';
sqlite.exec(`CREATE TABLE IF NOT EXISTS suite_share_links (
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, token TEXT NOT NULL,
 slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS suite_share_target ON suite_share_links(kind,token,id);`);
export function shortLink(kind:'q'|'p',token:string,name:string,custom?:string) {
  const existing=sqlite.prepare('SELECT slug,label FROM suite_share_links WHERE kind=? AND token=? ORDER BY id DESC LIMIT 1').get(kind,token) as {slug:string;label:string}|undefined;
  const label=(custom||name||'design').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'design';
  if(existing && (custom===undefined||label===existing.label))return `${process.env.PUBLIC_SITE_URL||'https://www.cjmmetals.com'}/${kind}/${existing.slug}`;
  // Retain a random suffix and every older alias; changing the readable name
  // must not expose sequential IDs or invalidate links already sent.
  const slug=`${label}-${crypto.randomBytes(12).toString('base64url')}`;
  sqlite.prepare('INSERT INTO suite_share_links(kind,token,slug,label,created_at) VALUES(?,?,?,?,?)').run(kind,token,slug,label,Date.now());
  return `${process.env.PUBLIC_SITE_URL||'https://www.cjmmetals.com'}/${kind}/${slug}`;
}
export function registerShareLinks(app:Express) {
  app.get('/api/public/share-links/:kind/:slug',(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
    if(!hasLeadKey(req)||!['q','p'].includes(String(req.params.kind))||String(req.params.slug).length>60){res.status(404).end();return;}
    const row=sqlite.prepare('SELECT token FROM suite_share_links WHERE kind=? AND slug=?').get(req.params.kind,req.params.slug);
    if(!row){res.status(404).end();return;}res.json(row);
  });
}
