import type { Express } from "express";
import { sqlite } from "./storage";
import { requireAuth } from "./auth";
export function registerRecordVersions(app: Express) {
  const resources: Record<string, string> = {
    "crm/clients": "crm_clients",
    "crm/leads": "crm_leads",
    "hr/employees": "hr_employees",
    "pm/tasks": "pm_tasks",
    "pm/contracts": "pm_contracts",
    "pm/change-orders": "pm_change_orders",
    "finance/invoices": "fin_invoices",
    "finance/expenses": "fin_expenses",
    "finance/purchase-orders": "fin_purchase_orders",
    projects: "projects",
  };
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS suite_record_versions(entity TEXT NOT NULL,id INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(entity,id))",
  );
  for (const [resource, table] of Object.entries(resources)) {
    sqlite.exec(`INSERT OR IGNORE INTO suite_record_versions(entity,id) SELECT '${resource}',id FROM ${table};
   CREATE TRIGGER IF NOT EXISTS suite_version_${table}_insert AFTER INSERT ON ${table} BEGIN INSERT OR IGNORE INTO suite_record_versions(entity,id) VALUES('${resource}',NEW.id); END;
   CREATE TRIGGER IF NOT EXISTS suite_version_${table}_update AFTER UPDATE ON ${table} BEGIN UPDATE suite_record_versions SET version=version+1 WHERE entity='${resource}' AND id=NEW.id; END;`);
  }
  app.use("/api", (req, res, next) => {
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const send=res.json.bind(res);
      res.json=((body:any)=>{
        if(res.statusCode<300 && req.user){const rows=sqlite.prepare('SELECT topic,version FROM suite_revisions').all().filter((r:any)=>['owner','manager'].includes(req.user!.role)||r.topic!=='finance');res.setHeader('X-Suite-Revisions',JSON.stringify(rows));}
        return send(body);
      }) as typeof res.json;
    }
    const match = req.path.match(
      /^\/(crm\/clients|crm\/leads|hr\/employees|pm\/tasks|pm\/contracts|pm\/change-orders|finance\/invoices|finance\/expenses|finance\/purchase-orders|projects)(?:\/(\d+)(?:\/detail)?)?$/,
    );
    if (!match) return next();
    requireAuth(req, res, () => {
      if (req.method === "GET") {
        const send = res.json.bind(res);
        res.json = ((body: any) => {
          const fields=['rows','invoice','client','lead','employee','contract'];
          const candidates=Array.isArray(body)?body:[body,...fields.flatMap(f=>body?.[f] ? [body[f]].flat():[])];
          const ids=[...new Set(candidates.filter(r=>r&&Number.isInteger(r.id)).map(r=>r.id))];
          const versions=new Map((ids.length ? sqlite.prepare("SELECT id,version FROM suite_record_versions WHERE entity=? AND id IN (SELECT value FROM json_each(?))").all(match[1],JSON.stringify(ids)):[]).map((r:any)=>[r.id,r.version]));
          // Read the revision once for both the body and headers. Transport
          // proxies may weaken ETags when compressing responses, so expose the
          // application revision separately from the HTTP cache validator.
          if (res.statusCode < 300 && match[2] && versions.has(Number(match[2]))) {
            const version = versions.get(Number(match[2]));
            res.setHeader("ETag", `"${version}"`);
            res.setHeader("X-Record-Version", String(version));
            res.setHeader("Cache-Control", "private, no-store");
          }
          const add=(row:any)=>row && versions.has(row.id)?{...row,_version:versions.get(row.id)}:row;
          if (Array.isArray(body)) body = body.map(add);
          else if (body && typeof body === "object") {
            body = add(body);
            for (const field of [
              "rows",
              "invoice",
              "client",
              "lead",
              "employee",
              "contract",
            ])
              if (body[field])
                body = {
                  ...body,
                  [field]: Array.isArray(body[field])
                    ? body[field].map(add)
                    : add(body[field]),
                };
          }
          return send(body);
        }) as typeof res.json;
      }
      if (!match[2] || !["PATCH", "DELETE"].includes(req.method)) return next();
      const row: any = sqlite
        .prepare(
          "SELECT version FROM suite_record_versions WHERE entity=? AND id=?",
        )
        .get(match[1], Number(match[2]));
      if (!row) return next();
      const etag = `"${row.version}"`;
      if (
        ["PATCH", "DELETE"].includes(req.method) &&
        req.headers["if-match"] &&
        req.headers["if-match"] !== etag
      ) {
        res
          .status(409)
          .json({
            code: "RECORD_VERSION_CONFLICT",
            message:
              "This record changed on another screen. Reload it before saving.",
          });
        return;
      }
      next();
    });
  });
}
