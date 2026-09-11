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
    const match = req.path.match(
      /^\/(crm\/clients|crm\/leads|hr\/employees|pm\/tasks|pm\/contracts|pm\/change-orders|finance\/invoices|finance\/expenses|finance\/purchase-orders|projects)(?:\/(\d+)(?:\/detail)?)?$/,
    );
    if (!match) return next();
    requireAuth(req, res, () => {
      if (req.method === "GET") {
        const send = res.json.bind(res);
        res.json = ((body: any) => {
          const add = (row: any) => {
            if (!row || typeof row !== "object" || !Number.isInteger(row.id))
              return row;
            const v: any = sqlite
              .prepare(
                "SELECT version FROM suite_record_versions WHERE entity=? AND id=?",
              )
              .get(match[1], row.id);
            return v ? { ...row, _version: v.version } : row;
          };
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
      if (!match[2]) return next();
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
            message:
              "This record changed on another screen. Reload it before saving.",
          });
        return;
      }
      if (req.method === "GET") res.setHeader("ETag", etag);
      next();
    });
  });
}
