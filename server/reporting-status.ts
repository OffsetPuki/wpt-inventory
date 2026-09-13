import {sqlite} from './storage';

sqlite.exec(`CREATE TABLE IF NOT EXISTS mk_reporting_status (
  provider TEXT NOT NULL, site TEXT NOT NULL, kind TEXT NOT NULL,
  attempted_at INTEGER NOT NULL, succeeded_at INTEGER, error TEXT,
  PRIMARY KEY(provider,site,kind)
);`);
export function recordReportingStatus(provider: 'google'|'bing', site: string, kind: string, error: string|null) {
  const now=Date.now();
  sqlite.prepare(`INSERT INTO mk_reporting_status(provider,site,kind,attempted_at,succeeded_at,error)
    VALUES(?,?,?,?,?,?) ON CONFLICT(provider,site,kind) DO UPDATE SET
    attempted_at=excluded.attempted_at,error=excluded.error,
    succeeded_at=COALESCE(excluded.succeeded_at,mk_reporting_status.succeeded_at)`)
    .run(provider,site,kind,now,error ? null : now,error);
}
export function reportingStatus(provider: 'google'|'bing', site: string) {
  return sqlite.prepare('SELECT kind,attempted_at AS attemptedAt,succeeded_at AS succeededAt,error FROM mk_reporting_status WHERE provider=? AND site=?').all(provider,site) as {kind:string;attemptedAt:number;succeededAt:number|null;error:string|null}[];
}
