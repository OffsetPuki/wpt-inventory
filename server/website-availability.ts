import type { Express } from 'express';
import { sqlite } from './storage';
import { requireElevated } from './auth';
import { audit } from './audit';

export function registerWebsiteAvailability(app: Express) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS website_availability (
    site TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
  ); INSERT OR IGNORE INTO website_availability(site,active,updated_at) VALUES('insulation',0,0);`);
  const read = () => {
    const row = sqlite.prepare("SELECT active,version,updated_at FROM website_availability WHERE site='insulation'").get() as {active:number;version:number;updated_at:number};
    return {site:'insulation',active:row.active===1,version:row.version,updatedAt:row.updated_at};
  };
  // Public availability only: no business records, credentials or settings.
  app.get('/api/public/website-status/insulation', (_req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Robots-Tag','noindex');
    res.json({active:read().active});
  });
  app.get('/api/settings/website/insulation', requireElevated, (_req,res) => res.json(read()));
  app.put('/api/settings/website/insulation', requireElevated, (req,res) => {
    const {active,version} = req.body || {};
    if(typeof active!=='boolean'||!Number.isSafeInteger(version)||version<1) return res.status(400).json({message:'Choose a website status and reload its current version.'});
    const changed=sqlite.prepare("UPDATE website_availability SET active=?,version=version+1,updated_at=? WHERE site='insulation' AND version=?").run(active?1:0,Date.now(),version);
    if(!changed.changes) return res.status(409).json({message:'The website status changed elsewhere. Refresh and try again.'});
    audit(req,'website.availability',{targetType:'website',targetName:'insulation',details:{active}});
    res.json(read());
  });
}
