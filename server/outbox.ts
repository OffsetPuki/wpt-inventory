import { sqlite } from "./storage";
sqlite.exec(
  `CREATE TABLE IF NOT EXISTS suite_outbox(id INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,locked_at INTEGER,last_error TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),completed_at INTEGER)`,
);
export function enqueueFollowup(
  eventKey: string,
  kind: string,
  payload: unknown,
) {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO suite_outbox(event_key,kind,payload) VALUES(?,?,?)",
    )
    .run(eventKey, kind, JSON.stringify(payload));
  return sqlite
    .prepare("SELECT * FROM suite_outbox WHERE event_key=?")
    .get(eventKey) as any;
}
