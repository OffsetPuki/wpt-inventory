import { DEFAULT_PRICE_BOOK } from "../client/src/quote/data/priceBook.js";
import { deepMerge } from "../client/src/quote/lib/store.js";
import type { Express } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { sqlite, db } from "./storage";
import { requireAuth, requireElevated } from "./auth";
import { isElevated } from "./http-util";
import { audit } from "./audit";
import { jobRecord, jobReadiness } from "./suite-data";
import { inventoryOnce } from "./inventory-core";
import { insertNumbered } from "./numbering";
import { pmTasks } from "../shared/pm-schema";
import { eq } from "drizzle-orm";
import { invoices } from "../shared/finance-schema";
const key = z.string().min(8).max(100),
  positive = z.coerce.number().int().positive();
const customerTables = [
  "projects",
  "crm_leads",
  "pm_contracts",
  "fin_invoices",
  "mk_reviews",
  "review_requests",
];
function customerMerge(source: number, target: number) {
  if (source === target) throw new Error("Choose two different customers.");
  const clients = sqlite
    .prepare(
      "SELECT * FROM crm_clients WHERE id IN (?,?) AND deleted_at IS NULL ORDER BY id",
    )
    .all(source, target) as any[];
  if (clients.length !== 2) throw new Error("Both customers must be active.");
  const references = customerTables.map((table) => ({
    table,
    rows: sqlite
      .prepare(`SELECT id FROM ${table} WHERE client_id=? ORDER BY id`)
      .all(source),
  }));
  references.push({
    table: "crm_activities",
    rows: sqlite
      .prepare(
        "SELECT id FROM crm_activities WHERE entity_type='client' AND entity_id=? ORDER BY id",
      )
      .all(source),
  });
  const quotes = sqlite
    .prepare(
      "SELECT id,version FROM quotes WHERE json_extract(payload,'$.customer.clientId')=? ORDER BY id",
    )
    .all(source);
  const snapshot = JSON.stringify({ clients, references, quotes });
  return {
    source: clients.find((c) => c.id === source),
    target: clients.find((c) => c.id === target),
    references: references.map((r) => ({
      table: r.table,
      count: r.rows.length,
    })),
    quoteCount: quotes.length,
    version: crypto.createHash("sha256").update(snapshot).digest("hex"),
  };
}
export function registerSuiteControls(app: Express) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS suite_change_bills(change_order_id INTEGER PRIMARY KEY,invoice_id INTEGER NOT NULL,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
 CREATE TABLE IF NOT EXISTS suite_restore_checks(id INTEGER PRIMARY KEY,backup_name TEXT NOT NULL,sha256 TEXT NOT NULL,result TEXT NOT NULL,notes TEXT NOT NULL,verified_by INTEGER NOT NULL,verified_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS suite_files_project ON suite_files(project_id,id);`);
  const endpoint = (
    method: "get" | "post",
    url: string,
    owner: boolean,
    fn: any,
  ) =>
    app[method](url, owner ? requireElevated : requireAuth, (req, res) => {
      try {
        res.json(fn(req));
      } catch (e: any) {
        res.status(e.status || 400).json({ message: e.message });
      }
    });

  endpoint("get", "/api/suite/pickers/:type", true, (req: any) => {
    const type = z.enum(["clients", "jobs", "quotes"]).parse(req.params.type),
      q = String(req.query.q || "")
        .trim()
        .slice(0, 100),
      id = Number(req.query.id) || 0;
    const configs = {
      clients: {
        table: "crm_clients",
        columns: "id,name,company,email",
        search: "name||coalesce(company,'')||coalesce(email,'')",
        extra: "",
      },
      jobs: {
        table: "projects",
        columns:
          "id,name,job_number AS jobNumber,client_id AS clientId,customer",
        search: "name||job_number||coalesce(customer,'')",
        extra: "",
      },
      quotes: {
        table: "quotes",
        columns:
          "id,number,customer_name AS customerName,status,total_cents AS totalCents",
        search: "number||coalesce(customer_name,'')",
        extra: " AND status IN ('sent','accepted')",
      },
    };
    const c = configs[type],
      pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    return sqlite
      .prepare(
        `SELECT ${c.columns} FROM ${c.table} WHERE deleted_at IS NULL ${c.extra} AND (${c.search} LIKE @pattern ESCAPE '\\' OR id=@id) ORDER BY id=@id DESC,id DESC LIMIT 12`,
      )
      .all({ id, pattern });
  });
  endpoint("get", "/api/pm/tasks/:id", false, (req: any) => {
    const row = db
      .select()
      .from(pmTasks)
      .where(eq(pmTasks.id, positive.parse(req.params.id)))
      .get();
    if (!row || row.deletedAt)
      throw Object.assign(new Error("Task not found."), { status: 404 });
    return row;
  });
  endpoint("get", "/api/suite/customer-merge", true, (req: any) =>
    customerMerge(
      positive.parse(req.query.source),
      positive.parse(req.query.target),
    ),
  );
  endpoint("post", "/api/suite/customer-merge", true, (req: any) => {
    const b = z
      .object({
        requestKey: key,
        source: positive,
        target: positive,
        version: z.string(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(req.body);
    return inventoryOnce(sqlite, req.user.userId, b.requestKey, b, () => {
      if (customerMerge(b.source, b.target).version !== b.version)
        throw Object.assign(
          new Error("Customer records changed. Review a new preview."),
          { status: 409 },
        );
      for (const table of customerTables)
        sqlite
          .prepare(`UPDATE ${table} SET client_id=? WHERE client_id=?`)
          .run(b.target, b.source);
      sqlite
        .prepare(
          "UPDATE crm_activities SET entity_id=? WHERE entity_type='client' AND entity_id=?",
        )
        .run(b.target, b.source);
      // Relink identity only. Names, addresses and prices on issued snapshots stay intact.
      sqlite
        .prepare(
          "UPDATE quotes SET payload=json_set(payload,'$.customer.clientId',?),version=version+1 WHERE json_extract(payload,'$.customer.clientId')=?",
        )
        .run(b.target, b.source);
      sqlite
        .prepare("UPDATE crm_clients SET deleted_at=? WHERE id=?")
        .run(Date.now(), b.source);
      audit(req, "suite.customer_merge", {
        targetType: "client",
        targetId: b.target,
        details: { source: b.source, reason: b.reason },
      });
      return { id: b.target };
    });
  });
  endpoint("post", "/api/suite/change-orders/:id/bill", true, (req: any) => {
    const id = positive.parse(req.params.id),
      b = z
        .object({
          requestKey: key,
          invoiceId: positive.nullable().optional(),
          reviewed: z.literal(true),
        })
        .parse(req.body);
    return inventoryOnce(
      sqlite,
      req.user.userId,
      b.requestKey,
      { id, ...b },
      () => {
        const co: any = sqlite
          .prepare(
            "SELECT * FROM pm_change_orders WHERE id=? AND deleted_at IS NULL AND status='approved'",
          )
          .get(id);
        if (!co) throw new Error("Choose an approved change order.");
        const job = jobRecord(co.project_id),
          existing: any = sqlite
            .prepare(
              "SELECT i.* FROM suite_change_bills b JOIN fin_invoices i ON i.id=b.invoice_id WHERE b.change_order_id=?",
            )
            .get(id);
        if (existing && !existing.deleted_at && existing.status !== "void")
          return { id: existing.id };
        const line = {
          description: `Approved extra: ${co.title}`,
          qty: 1,
          unit: "each",
          unitPriceCents: co.amount_cents,
        };
        let invoiceId: number;
        if (b.invoiceId) {
          const inv: any = sqlite
            .prepare(
              "SELECT * FROM fin_invoices WHERE id=? AND project_id=? AND status='draft' AND deleted_at IS NULL AND paid_cents=0",
            )
            .get(b.invoiceId, job.id);
          if (!inv)
            throw new Error("Choose an unpaid draft invoice on this job.");
          if (inv.discount_cents || inv.retainage_cents)
            throw new Error(
              "Use a draft without discount or retainage, then review those terms.",
            );
          const items = JSON.parse(inv.items);
          items.push(line);
          const subtotal = items.reduce(
            (s: number, l: any) => s + Math.round(l.qty * l.unitPriceCents),
            0,
          );
          if (subtotal < 0)
            throw new Error(
              "A deductive extra cannot make the invoice negative.",
            );
          const tax = Math.round((subtotal * inv.tax_rate_bp) / 10000);
          sqlite
            .prepare(
              "UPDATE fin_invoices SET items=?,subtotal_cents=?,tax_cents=?,total_cents=? WHERE id=?",
            )
            .run(JSON.stringify(items), subtotal, tax, subtotal + tax, inv.id);
          invoiceId = inv.id;
        } else {
          if (co.amount_cents <= 0)
            throw new Error(
              "Add a deductive extra to an existing draft invoice.",
            );
          const customer: any = job.client_id
            ? sqlite
                .prepare("SELECT name FROM crm_clients WHERE id=?")
                .get(job.client_id)
            : null;
          invoiceId = insertNumbered("fin_invoices", "INV", (number) =>
            db
              .insert(invoices)
              .values({
                number,
                projectId: job.id,
                clientId: job.client_id,
                clientName: customer?.name || job.customer,
                status: "draft",
                items: JSON.stringify([line]),
                subtotalCents: co.amount_cents,
                totalCents: co.amount_cents,
                notes: `Approved change order #${co.id}; review tax and terms before sending.`,
              })
              .returning()
              .get(),
          ).id;
        }
        sqlite
          .prepare(
            "INSERT INTO suite_change_bills(change_order_id,invoice_id) VALUES(?,?) ON CONFLICT(change_order_id) DO UPDATE SET invoice_id=excluded.invoice_id",
          )
          .run(id, invoiceId);
        sqlite
          .prepare(
            "UPDATE suite_review_actions SET resolved_at=? WHERE event_key=?",
          )
          .run(Date.now(), `change-order:${id}`);
        audit(req, "suite.extra_billed", {
          targetType: "project",
          targetId: job.id,
          details: { changeOrderId: id, invoiceId },
        });
        return { id: invoiceId };
      },
    );
  });
  endpoint("get", "/api/suite/costs", true, () =>
    sqlite
      .prepare(
        `SELECT p.*,i.name FROM suite_cost_proposals p JOIN items i ON i.id=p.item_id WHERE p.status='pending' ORDER BY p.id DESC LIMIT 100`,
      )
      .all(),
  );
  endpoint("post", "/api/suite/costs/:id", true, (req: any) => {
    const id = positive.parse(req.params.id),
      b = z
        .object({
          action: z.enum(["approve", "dismiss"]),
          priceBookKey: z.string().max(100).optional(),
          expectedPrice: z.number().optional(),
        })
        .parse(req.body);
    return sqlite.transaction(() => {
      const row: any = sqlite
        .prepare(
          "SELECT * FROM suite_cost_proposals WHERE id=? AND status='pending'",
        )
        .get(id);
      if (!row) throw new Error("This cost has already been reviewed.");
      if (b.action === "approve") {
        const settings: any = sqlite
          .prepare("SELECT price_book FROM quote_settings WHERE id=1")
          .get();
        const book: any = deepMerge(
          DEFAULT_PRICE_BOOK,
          JSON.parse(settings?.price_book || "{}"),
        );
        const field = b.priceBookKey || row.material_key;
        if (
          !field ||
          !Object.hasOwn(book.materials, field) ||
          typeof book.materials[field]?.cost !== "number"
        )
          throw new Error(
            "Choose a numeric price-book field and confirm the purchase-to-pricing unit conversion.",
          );
        if (book.materials[field].cost !== b.expectedPrice)
          throw Object.assign(
            new Error(
              "The price book changed. Refresh before applying this cost.",
            ),
            { status: 409 },
          );
        // The owner supplies the converted cost in the same units as this field.
        const price = z
          .number()
          .finite()
          .nonnegative()
          .parse(req.body.convertedPrice);
        book.materials[field] = {
          ...book.materials[field],
          cost: price,
          updatedAt: Date.now(),
        };
        sqlite
          .prepare(
            "UPDATE quote_settings SET price_book=?,updated_at=? WHERE id=1",
          )
          .run(JSON.stringify(book), Date.now());
      }
      sqlite
        .prepare(
          "UPDATE suite_cost_proposals SET status=?,reviewed_at=? WHERE id=?",
        )
        .run(b.action === "approve" ? "approved" : "dismissed", Date.now(), id);
      audit(req, "suite.cost_review", {
        targetType: "item",
        targetId: row.item_id,
        details: { proposalId: id, ...b },
      });
      return { ok: true };
    })();
  });
  endpoint("post", "/api/suite/restore-checks", true, (req: any) => {
    const b = z
      .object({
        backupName: z.string().trim().min(1).max(200),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        result: z.enum(["passed", "failed"]),
        notes: z.string().trim().min(10).max(2000),
      })
      .parse(req.body);
    const row = sqlite
      .prepare(
        "INSERT INTO suite_restore_checks(backup_name,sha256,result,notes,verified_by,verified_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        b.backupName,
        b.sha256,
        b.result,
        b.notes,
        req.user.userId,
        Date.now(),
      );
    audit(req, "suite.restore_evidence", {
      targetType: "restore",
      targetId: Number(row.lastInsertRowid),
      details: b,
    });
    return { ok: true };
  });
  endpoint("get", "/api/suite/schedule", false, (req: any) => {
    const from = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(req.query.from),
      to = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(req.query.to);
    if (to < from || Date.parse(to) - Date.parse(from) > 62 * 86400000)
      throw new Error("Choose up to two months.");
    return (
      sqlite
        .prepare(
          "SELECT id,name,start_date,due_date,schedule_state FROM projects WHERE deleted_at IS NULL AND status='active' AND start_date<=? AND due_date>=? ORDER BY start_date,id LIMIT 200",
        )
        .all(to, from) as any[]
    ).map((job) => {
      const r = jobReadiness(job.id);
      return {
        ...job,
        blockers: r.blockers,
        ready: r.ready,
        conflicts: r.conflicts,
      };
    });
  });
  endpoint("get", "/api/suite/time-review", false, (req: any) => {
    const uid = req.user.userId;
    return {
      unassigned: sqlite
        .prepare(
          `SELECT t.id,t.started_at,t.duration_min,u.name FROM pm_time_entries t JOIN users u ON u.id=t.user_id WHERE t.project_id IS NULL AND t.ended_at IS NOT NULL AND t.invoice_id IS NULL ${isElevated(req) ? "" : "AND t.user_id=?"} ORDER BY t.id DESC LIMIT 30`,
        )
        .all(...(isElevated(req) ? [] : [uid])),
      running: sqlite
        .prepare(
          `SELECT t.id,t.started_at,u.name FROM pm_time_entries t JOIN users u ON u.id=t.user_id WHERE t.ended_at IS NULL AND t.started_at<? ${isElevated(req) ? "" : "AND t.user_id=?"} LIMIT 30`,
        )
        .all(Date.now() - 12 * 3600000, ...(isElevated(req) ? [] : [uid])),
    };
  });
  endpoint("get", "/api/suite/jobs/:id/timeline", false, (req: any) => {
    const id = positive.parse(req.params.id);
    jobRecord(id);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    // Only names and event summaries are returned. Private note bodies and
    // financial payloads stay behind their original permissions.
    const related = [
      "(target_type='project' AND target_id=@job)",
      "(target_type='pm_task' AND target_id IN (SELECT id FROM pm_tasks WHERE project_id=@job))",
      "(target_type='time_entry' AND target_id IN (SELECT id FROM pm_time_entries WHERE project_id=@job))",
      "(target_type='pm_document' AND target_id IN (SELECT id FROM pm_documents WHERE project_id=@job))",
    ];
    if (isElevated(req))
      related.push(
        "(target_type='invoice' AND target_id IN (SELECT id FROM fin_invoices WHERE project_id=@job))",
        "(target_type='pm_contract' AND target_id IN (SELECT id FROM pm_contracts WHERE project_id=@job))",
        "(target_type='pm_change_order' AND target_id IN (SELECT id FROM pm_change_orders WHERE project_id=@job))",
        "(target_type='expense' AND target_id IN (SELECT id FROM fin_expenses WHERE project_id=@job))",
        "(target_type='purchase_order' AND target_id IN (SELECT id FROM fin_purchase_orders WHERE project_id=@job))",
        "(target_type='quote' AND target_id IN (SELECT quote_id FROM projects WHERE id=@job))",
      );
    return sqlite
      .prepare(
        `SELECT id,action,target_name,user_name,created_at FROM audit_log WHERE id<@before AND (${related.join(" OR ")}) ${isElevated(req) ? "" : "AND action NOT LIKE 'suite.extra_%'"} ORDER BY id DESC LIMIT 40`,
      )
      .all({ before, job: id });
  });
}
