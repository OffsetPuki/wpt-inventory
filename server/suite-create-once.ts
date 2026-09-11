import type { Express } from "express";
import { requireAuth } from "./auth";
import { isElevated } from "./http-util";
import { sqlite } from "./storage";
import { inventoryOnce } from "./inventory-core";

// Only these synchronous JSON creation handlers are eligible. Their insert,
// audit and retry receipt commit together before the response is written.
export function registerCreateOnce(app: Express) {
  const routes = new Set([
    "/api/crm/clients",
    "/api/crm/leads",
    "/api/pm/tasks",
    "/api/pm/contracts",
    "/api/pm/change-orders",
    "/api/finance/invoices",
    "/api/finance/expenses",
    "/api/finance/purchase-orders",
    "/api/projects",
    "/api/hr/employees",
  ]);
  app.use((req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (
      req.method !== "POST" ||
      !(
        routes.has(req.path) ||
        /^\/api\/finance\/invoices\/\d+\/payments$/.test(req.path)
      ) ||
      typeof key !== "string"
    )
      return next();
    if (!/^[a-zA-Z0-9:-]{8,100}$/.test(key))
      return res.status(400).json({ message: "Invalid request identity." });
    requireAuth(req, res, () => {
      if (
        !["/api/crm/clients", "/api/crm/leads", "/api/pm/tasks"].includes(
          req.path,
        ) &&
        !isElevated(req)
      )
        return res.status(403).json({ message: "Owner access required." });
      const send = res.json.bind(res);
      let captured: any;
      res.json = ((body: any) => {
        captured = { status: res.statusCode, body };
        return res;
      }) as typeof res.json;
      try {
        const result = inventoryOnce(
          sqlite,
          req.user!.userId,
          key,
          { path: req.path, body: req.body },
          () => {
            next();
            if (!captured) throw new Error("Creation did not return a result.");
            if (captured.status >= 400)
              throw Object.assign(
                new Error(captured.body?.message || "Could not save."),
                { status: captured.status },
              );
            return captured;
          },
        );
        res.json = send;
        res.status(result.status).json(result.body);
      } catch (e: any) {
        res.json = send;
        res.status(e.status || 400).json({ message: e.message });
      }
    });
  });
}
