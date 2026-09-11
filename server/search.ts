import type { Express } from "express";
import { sqlite } from "./storage";
import { requireAuth } from "./auth";
import { isElevated } from "./http-util";
export function registerSearchRoutes(app: Express) {
  app.get("/api/search", requireAuth, (req, res) => {
    const q = String(req.query.q || "")
      .trim()
      .slice(0, 120);
    if (q.length < 2) return res.json({ results: [], more: false });
    const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    const sources = [
      [
        "Items",
        "items",
        "name",
        "part_number",
        "name,part_number,area,rack_letter,shelf,bin",
        "/item/",
      ],
      [
        "Jobs",
        "projects",
        "name",
        "job_number",
        "name,job_number,customer,site_address",
        "/project/",
      ],
      [
        "Clients",
        "crm_clients",
        "name",
        "company",
        "name,company,email,phone,address",
        "/crm/clients?client=",
      ],
      [
        "Leads",
        "crm_leads",
        "name",
        "service_requested",
        "name,service_requested,phone,email",
        "/crm/leads?lead=",
      ],
      [
        "Quotes",
        "quotes",
        "number",
        "customer_name",
        "number,customer_name,design_ref",
        "/crm/quotes?quote=",
      ],
      [
        "Tasks",
        "pm_tasks",
        "title",
        "description",
        "title,description",
        "/pm/board?task=",
      ],
      [
        "Contracts",
        "pm_contracts",
        "title",
        "client_name",
        "title,client_name,quote_ref",
        "/pm/contracts?contract=",
      ],
      ...(isElevated(req)
        ? [
            [
              "Invoices",
              "fin_invoices",
              "number",
              "client_name",
              "number,client_name",
              "/finance/invoices?invoice=",
            ],
            [
              "Purchase Orders",
              "fin_purchase_orders",
              "number",
              "vendor",
              "number,vendor",
              "/finance/purchase-orders?po=",
            ],
            [
              "Expenses",
              "fin_expenses",
              "coalesce(vendor,'Expense')",
              "date",
              "vendor,notes",
              "/finance/expenses?expense=",
            ],
            [
              "Employees",
              "hr_employees",
              "first_name||' '||last_name",
              "job_title",
              "first_name,last_name,email,phone",
              "/hr/employees?employee=",
            ],
          ]
        : []),
    ].filter((s) => !req.query.type || s[0] === req.query.type);
    const groups: any[][] = [],
      errors: string[] = [];
    for (const [type, table, label, sub, fieldText, href] of sources)
      try {
        const fields = fieldText.split(",");
        const rows = sqlite
          .prepare(
            `SELECT id,${label} AS label,${sub} AS sublabel,CASE WHEN lower(${label})=lower(?) OR lower(${sub})=lower(?) THEN 0 ELSE 1 END AS rank FROM ${table} WHERE deleted_at IS NULL AND (${fields.map((f) => `${f} LIKE ? ESCAPE '\\'`).join(" OR ")}) ORDER BY rank,id DESC LIMIT 6`,
          )
          .all(q, q, ...fields.map(() => pattern)) as any[];
        groups.push(
          rows.map((r) => ({
            type,
            label: r.label,
            sublabel: r.sublabel,
            href: href + r.id,
            rank: r.rank,
          })),
        );
      } catch {
        errors.push(type);
      }
    const results = groups.flat().filter((r) => r.rank === 0);
    for (let i = 0; i < 6; i++)
      for (const group of groups)
        if (group[i] && group[i].rank !== 0) results.push(group[i]);
    const cap = req.query.all === "1" ? 72 : 20;
    res.json({
      results: results.slice(0, cap).map(({ rank, ...r }) => r),
      more: results.length > cap || groups.some((g) => g.length === 6),
      unavailable: errors,
    });
  });
}
