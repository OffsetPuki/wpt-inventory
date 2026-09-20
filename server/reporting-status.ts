import {sqlite} from './storage';

sqlite.exec(`CREATE TABLE IF NOT EXISTS mk_reporting_status (
  provider TEXT NOT NULL, site TEXT NOT NULL, kind TEXT NOT NULL,
  attempted_at INTEGER NOT NULL, succeeded_at INTEGER, error TEXT,
  PRIMARY KEY(provider,site,kind)
);`);
export function recordReportingStatus(provider: 'google'|'bing', site: string, kind: string, error: string|null,start='',end='') {
  const now=Date.now();
  sqlite.exec(`CREATE TABLE IF NOT EXISTS mk_reporting_period_status(provider TEXT,site TEXT,kind TEXT,start_date TEXT,end_date TEXT,attempted_at INTEGER,succeeded_at INTEGER,error TEXT,PRIMARY KEY(provider,site,kind,start_date,end_date));`);
  sqlite.prepare(`INSERT INTO mk_reporting_period_status VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider,site,kind,start_date,end_date) DO UPDATE SET attempted_at=excluded.attempted_at,succeeded_at=COALESCE(excluded.succeeded_at,mk_reporting_period_status.succeeded_at),error=excluded.error`).run(provider,site,kind,start,end,now,error?null:now,error);
  sqlite.prepare(`INSERT INTO mk_reporting_status(provider,site,kind,attempted_at,succeeded_at,error)
    VALUES(?,?,?,?,?,?) ON CONFLICT(provider,site,kind) DO UPDATE SET
    attempted_at=excluded.attempted_at,error=excluded.error,
    succeeded_at=COALESCE(excluded.succeeded_at,mk_reporting_status.succeeded_at)`)
    .run(provider,site,kind,now,error ? null : now,error);
}
export function reportingStatus(provider: 'google'|'bing', site: string,start?:string,end?:string) {
  if(start&&end && sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='mk_reporting_period_status'").get())return sqlite.prepare('SELECT kind,attempted_at AS attemptedAt,succeeded_at AS succeededAt,error FROM mk_reporting_period_status WHERE provider=? AND site=? AND start_date=? AND end_date=?').all(provider,site,start,end) as {kind:string;attemptedAt:number;succeededAt:number|null;error:string|null}[];
  return sqlite.prepare('SELECT kind,attempted_at AS attemptedAt,succeeded_at AS succeededAt,error FROM mk_reporting_status WHERE provider=? AND site=?').all(provider,site) as {kind:string;attemptedAt:number;succeededAt:number|null;error:string|null}[];
}
