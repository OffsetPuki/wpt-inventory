import {registerTaskReschedule} from './task-reschedule';
import {readableValidation} from '../shared/validation-message';
import {registerDesignRegistry} from './design-registry';
import {registerDesignMeasurements} from './design-measurements';
import {registerJobCompletion} from './job-completion';
import {registerRelationshipReview} from './relationship-review';
import {registerDeletionReview} from './deletion-review';
import {registerStorageReview} from './storage-review';
import {registerRecordCommunication} from './record-communication';
import {registerJobPacks} from './job-pack';
import {registerRecordConnections} from './record-connections';
import {registerCustomerAccounts} from './customer-accounts';
import {jobReadinessMany} from "./suite-data";
import {registerJobFileRoutes} from './job-files';
import {businessScope} from "./business-scope";
import {registerCustomerProjectPage} from './customer-project-page';
import {registerBusinessReport} from './business-report';
import { suiteHealth } from './suite-health-data';
import { businessTimeZone } from './business-clock';
import { registerSuiteControls } from "./suite-controls";
import type { Express, Request } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { sqlite, uploadsDir, db } from "./storage";
import { requireAuth, requireElevated, getSession } from "./auth";
import { payrollDate } from "./payroll";
import { isElevated, todayLocal } from "./http-util";
import {
  initializeSuite,
  jobRecord,
  jobMaterials,
  jobReadiness,
} from "./suite-data";
import {
  inventoryOnce,
  reserveStock,
  activeItem,
  validateQuantity,
} from "./inventory-core";
import { eq } from "drizzle-orm";
import { purchaseOrders, expenses } from "../shared/finance-schema";
import { insertNumbered } from "./numbering";
import { audit } from "./audit";

const idSchema = z.coerce.number().int().positive();
// Older saved forms used zero for an empty optional quote selector.
const optionalQuoteId = z.preprocess(value => value === 0 || value === '' ? null : value,
  z.number().int().positive('Choose an accepted quote from the list.').nullable().optional());
const quoteCustomerSql = "coalesce(l.client_id,CASE WHEN json_valid(q.payload) THEN json_extract(q.payload,'$.customer.clientId') END)";
const date = z
  .string()
  .refine((value) => {
    try {
      payrollDate(value);
      return true;
    } catch {
      return false;
    }
  }, "Use a valid date.")
  .nullable();
const key = z.string().min(8).max(100);
const parse = (text: string, fallback: any = []) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
function localUpload(value: string) {
  if (
    !/^\/uploads\/[A-Za-z0-9_.-]+$/.test(value) ||
    !fs.existsSync(path.join(uploadsDir, path.basename(value)))
  )
    throw new Error("Choose a file uploaded to this suite.");
  return value;
}
export function registerSuiteRoutes(app: Express) {
  initializeSuite();
  registerCustomerAccounts(app);
  registerDesignRegistry(app);
  registerDesignMeasurements(app);
  registerTaskReschedule(app);
  registerJobCompletion(app);
  registerRelationshipReview(app);
  registerDeletionReview(app);
  registerStorageReview(app);
  registerJobPacks(app);
  registerRecordConnections(app);
  registerRecordCommunication(app);
  registerJobFileRoutes(app);
  registerSuiteControls(app);
  registerBusinessReport(app);
  registerCustomerProjectPage(app);
  initializeSuite(); // Include revision triggers for the control tables just created.
  const endpoint = (
    method: "get" | "post" | "patch",
    route: string,
    owner: boolean,
    fn: (req: Request) => any,
  ) =>
    app[method](
      route,
      owner ? requireElevated : requireAuth,
      async (req, res) => {
        try {
          res.json(await fn(req));
        } catch (e: any) {
          const message = e instanceof z.ZodError ? readableValidation(e.issues)?.message || e.message : e.message;
          const fields = e instanceof z.ZodError ? [...new Set(e.issues.map(issue => String(issue.path[0] || '')).filter(Boolean))] : e.fields;
          res.status(e.status || 400).json({ message, ...(fields?.length ? {fields} : {}) });
        }
      },
    );
  endpoint("get", "/api/finance/expenses/:id", true, (req) => {
    const row = db
      .select()
      .from(expenses)
      .where(eq(expenses.id, idSchema.parse(req.params.id)))
      .get();
    if (!row || row.deletedAt)
      throw Object.assign(new Error("Expense not found"), { status: 404 });
    return row;
  });
  endpoint("get", "/api/finance/purchase-orders/:id", true, (req) => {
    const row = db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, idSchema.parse(req.params.id)))
      .get();
    if (!row || row.deletedAt)
      throw Object.assign(new Error("Order not found"), { status: 404 });
    return row;
  });
  endpoint("get", "/api/suite/people", false, () =>
    sqlite
      .prepare(
        "SELECT id,name FROM users WHERE disabled_at IS NULL ORDER BY name",
      )
      .all(),
  );
  endpoint("get", "/api/suite/jobs/:id", false, (req) => {
    const id = idSchema.parse(req.params.id),
      job = jobRecord(id),
      readiness = jobReadiness(id);
    const customer = job.client_id
      ? sqlite
          .prepare(
            "SELECT id,name,phone,email,company FROM crm_clients WHERE id=? AND deleted_at IS NULL",
          )
          .get(job.client_id)
      : null;
    const quote = job.quote_id
      ? sqlite
          .prepare(
            "SELECT id,number,status,type FROM quotes WHERE id=? AND deleted_at IS NULL",
          )
          .get(job.quote_id)
      : null;
    const actions = isElevated(req)
      ? sqlite
          .prepare(
            "SELECT id,event_key,title,href FROM suite_review_actions WHERE project_id=? AND resolved_at IS NULL ORDER BY id DESC",
          )
          .all(id)
      : [];
    if (!isElevated(req)) {
      delete (readiness as any).depositDue;
      delete (readiness as any).deposit;
      readiness.materials = readiness.materials.map(
        ({ last_cost_cents, ...m }) => m,
      );
    }
    const revision = sqlite.prepare("SELECT version FROM suite_record_versions WHERE entity='projects' AND id=?").get(id) as {version:number}|undefined;
    return { job:{...job,_version:revision?.version}, customer, quote, readiness, actions };
  });
  endpoint('get', '/api/suite/jobs/:id/accepted-quotes', true, req => {
    const job = jobRecord(idSchema.parse(req.params.id));
    const clientId = idSchema.parse(req.query.clientId);
    const search = String(req.query.q || '').trim().slice(0,100);
    const pattern = '%' + search.replace(/[\\%_]/g,'\\$&') + '%';
    return sqlite.prepare(`SELECT q.id,q.number,q.customer_name customerName,q.total_cents totalCents
      FROM quotes q LEFT JOIN crm_leads l ON l.id=q.lead_id
      WHERE q.status='accepted' AND q.deleted_at IS NULL AND ${quoteCustomerSql}=?
      AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.quote_id=q.id AND p.id!=?)
      AND (q.number||coalesce(q.customer_name,'')) LIKE ? ESCAPE '\\'
      ORDER BY q.id DESC LIMIT 30`).all(clientId,job.id,pattern);
  });
  endpoint("patch", "/api/suite/jobs/:id", true, (req) => {
    const id = idSchema.parse(req.params.id),
      before = jobRecord(id);
    const body = z
      .object({
        version: z.number().int(),
        clientId: z.number().int().positive().nullable(),
        quoteId: optionalQuoteId,
        site: z.enum(["metals", "concrete", "insulation", "trades"]),
        siteAddress: z.string().max(400),
        preferredLanguage: z.enum(["en", "es"]),
        billingMode: z.enum(["review", "fixed", "time_materials"]),
        startDate: date,
        dueDate: date,
        scheduleState: z.enum(["tentative", "confirmed"]),
        depositRequired: z.boolean(),
        documentsRequired: z
          .array(z.enum(["coi", "w9", "lien_waiver", "contract", "other"]))
          .max(5),
        tools: z.array(z.number().int().positive()).max(30),
        overrideReason: z.string().max(500).optional(),
      })
      .parse(req.body);
    return sqlite.transaction(() => {
      if (before.version !== body.version)
        throw Object.assign(
          new Error("This job changed. Reload it before saving."),
          { status: 409 },
        );
      if (body.startDate && body.dueDate && body.startDate > body.dueDate)
        throw Object.assign(new Error("Finish date must be on or after the start date."), {fields:['dueDate']});
      if (
        body.clientId &&
        !sqlite
          .prepare(
            "SELECT 1 FROM crm_clients WHERE id=? AND deleted_at IS NULL",
          )
          .get(body.clientId)
      )
        throw new Error("Choose an active customer.");
      if (body.quoteId && body.quoteId !== before.quote_id) {
        const q: any = sqlite
          .prepare(
            `SELECT q.id,${quoteCustomerSql} client_id FROM quotes q LEFT JOIN crm_leads l ON l.id=q.lead_id WHERE q.id=? AND q.status='accepted' AND q.deleted_at IS NULL`,
          )
          .get(body.quoteId);
        if (!q) throw new Error("Choose an accepted quote.");
        if (
          sqlite
            .prepare(
              "SELECT 1 FROM projects WHERE quote_id=? AND id!=?",
            )
            .get(body.quoteId, id)
        )
          throw new Error("That quote already belongs to another job.");
        const cid = q.client_id;
        if (!cid || Number(cid) !== body.clientId)
          throw new Error(
            "The quote and job must share the selected customer.",
          );
      }
      if (
        body.clientId !== before.client_id &&
        sqlite
          .prepare(
            "SELECT 1 FROM fin_invoices WHERE project_id=? AND deleted_at IS NULL AND status!='void' AND client_id IS NOT NULL AND client_id IS NOT ?",
          )
          .get(id, body.clientId)
      )
        throw new Error(
          "Review the linked invoice customer before relinking this job.",
        );
      if (before.quote_id && body.clientId !== before.client_id)
        throw new Error("Use the customer-link review for an accepted job.");
      sqlite
        .prepare(
          `UPDATE projects SET client_id=?,site=?,site_address=?,preferred_language=?,billing_mode=?,start_date=?,due_date=?,schedule_state=?,version=version+1 WHERE id=? AND version=?`,
        )
        .run(
          body.clientId,
          body.site,
          body.siteAddress,
          body.preferredLanguage,
          body.billingMode,
          body.startDate,
          body.dueDate,
          body.scheduleState,
          id,
          body.version,
        );
      if (body.quoteId !== undefined && !before.quote_id)
        sqlite
          .prepare("UPDATE projects SET quote_id=? WHERE id=?")
          .run(body.quoteId, id);
      for (const itemId of body.tools) activeItem(sqlite, itemId);
      const previousRules=sqlite.prepare('SELECT * FROM suite_job_rules WHERE project_id=?').get(id) as any;
      const sameSet=(a:unknown,b:unknown)=>JSON.stringify(Array.isArray(a)?[...a].sort():[])===JSON.stringify(Array.isArray(b)?[...b].sort():[]);
      const confirmationChanged=body.scheduleState==='confirmed' && (
        before.schedule_state!=='confirmed'||before.start_date!==body.startDate||before.due_date!==body.dueDate||
        before.client_id!==body.clientId||(body.quoteId!==undefined&&before.quote_id!==body.quoteId)||before.billing_mode!==body.billingMode||
        !!previousRules?.deposit_required!==body.depositRequired||!sameSet(parse(previousRules?.documents_required||'[]'),body.documentsRequired)||!sameSet(parse(previousRules?.tools||'[]'),body.tools)
      );
      sqlite
        .prepare(
          `INSERT INTO suite_job_rules(project_id,deposit_required,documents_required,tools) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET deposit_required=excluded.deposit_required,documents_required=excluded.documents_required,tools=excluded.tools`,
        )
        .run(
          id,
          +body.depositRequired,
          JSON.stringify(body.documentsRequired),
          JSON.stringify([...new Set(body.tools)]),
        );
      const ready = jobReadiness(id);
      if(confirmationChanged||body.scheduleState==='tentative')sqlite.prepare('UPDATE suite_job_rules SET override_reason=NULL,override_by=NULL,override_at=NULL WHERE project_id=?').run(id);
      if (confirmationChanged && !ready.ready) {
        if (!body.overrideReason?.trim())
          throw new Error(
            `Before confirming the schedule:\n${ready.blockers.map(b=>`• ${b.label}`).join('\n')}\nSave as tentative, or enter a reason to confirm despite these items.`,
          );
        sqlite
          .prepare(
            "UPDATE suite_job_rules SET override_reason=?,override_by=?,override_at=? WHERE project_id=?",
          )
          .run(body.overrideReason, req.user!.userId, Date.now(), id);
      }
      audit(req, "project.plan", {
        targetType: "project",
        targetId: id,
        targetName: before.name,
        details: {
          billingMode: body.billingMode,
          scheduleState: body.scheduleState,
          overrideReason: body.overrideReason,
        },
      });
      return jobRecord(id);
    })();
  });
  endpoint("post", "/api/suite/jobs/:id/reserve", true, (req) => {
    const id = idSchema.parse(req.params.id);
    jobRecord(id);
    const body = z.object({ requestKey: key }).parse(req.body);
    return inventoryOnce(
      sqlite,
      req.user!.userId,
      body.requestKey,
      { action: "reserve-job", id },
      () => {
        for (const m of jobMaterials(id))
          if (m.item_id && m.needed > 0)
            reserveStock(sqlite, m.item_id, id, m.needed, m.id, true);
        return { ok: true };
      },
    );
  });
  endpoint("post", "/api/suite/jobs/:id/order", true, (req) => {
    const id = idSchema.parse(req.params.id);
    jobRecord(id);
    const body = z
      .object({
        requestKey: key,
        vendor: z.string().trim().min(1).max(200),
        expectedDate: date,
        lines: z
          .array(
            z.object({
              itemId: z.number().int().positive(),
              quantity: z.number().positive(),
              unitCostCents: z.number().int().nonnegative(),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);
    return inventoryOnce(
      sqlite,
      req.user!.userId,
      body.requestKey,
      { action: "job-order", id, ...body },
      () => {
        const need = new Map<number, number>();
        for (const m of jobMaterials(id))
          if (m.item_id)
            need.set(m.item_id, (need.get(m.item_id) || 0) + m.missing);
        const seen = new Set<number>();
        const lines = body.lines.map((l) => {
          if (seen.has(l.itemId))
            throw new Error("Combine repeated items into one order line.");
          seen.add(l.itemId);
          const item = activeItem(sqlite, l.itemId);
          validateQuantity(l.quantity, item.unit);
          if (l.quantity > (need.get(l.itemId) || 0))
            throw new Error(
              "The shortage changed. Refresh this job before ordering.",
            );
          return {
            description: item.name,
            qty: l.quantity,
            unit: item.unit,
            unitPriceCents: l.unitCostCents,
            inventoryItemId: item.id,
            materialKey: item.material_key,
          };
        });
        return insertNumbered("fin_purchase_orders", "PO", (number) =>
          db
            .insert(purchaseOrders)
            .values({
              number,
              vendor: body.vendor,
              projectId: id,
              expectedDate: body.expectedDate,
              items: JSON.stringify(lines),
              totalCents: lines.reduce(
                (s, l) => s + Math.round(l.qty * l.unitPriceCents),
                0,
              ),
            })
            .returning()
            .get(),
        );
      },
    );
  });
  endpoint("get", "/api/suite/jobs/:id/activity", false, (req) => {
    const id = idSchema.parse(req.params.id);
    jobRecord(id);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    return sqlite
      .prepare(
        `SELECT c.*,u.name AS user_name FROM suite_comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.id<? ${isElevated(req) ? "" : "AND c.visibility='team'"} ORDER BY c.id DESC LIMIT 40`,
      )
      .all(id, before)
      .map((r: any) => ({ ...r, attachments: parse(r.attachments) }));
  });
  endpoint("post", "/api/suite/jobs/:id/comments", false, (req) => {
    const id = idSchema.parse(req.params.id);
    jobRecord(id);
    const body = z
      .object({
        requestKey: key,
        body: z.string().trim().min(1).max(4000),
        visibility: z.enum(["team", "owner"]),
        parentId: z.number().int().positive().nullable().optional(),
        taskId: z.number().int().positive().nullable().optional(),
        mentions: z.array(z.number().int().positive()).max(30),
        attachments: z.array(z.string()).max(5),
      })
      .parse(req.body);
    if (body.visibility === "owner" && !isElevated(req))
      throw Object.assign(new Error("Owner notes require owner access."), {
        status: 403,
      });
    return inventoryOnce(
      sqlite,
      req.user!.userId,
      body.requestKey,
      { action: "comment", id, ...body },
      () => {
        body.attachments.forEach(localUpload);
        if (
          body.taskId &&
          !sqlite
            .prepare(
              "SELECT 1 FROM pm_tasks WHERE id=? AND project_id=? AND deleted_at IS NULL",
            )
            .get(body.taskId, id)
        )
          throw new Error("Choose a task on this job.");
        if (
          body.parentId &&
          !sqlite
            .prepare(
              "SELECT 1 FROM suite_comments WHERE id=? AND project_id=? AND visibility=?",
            )
            .get(body.parentId, id, body.visibility)
        )
          throw new Error("Reply visibility must match its parent.");
        const inserted = sqlite
          .prepare(
            "INSERT INTO suite_comments(project_id,task_id,parent_id,user_id,body,visibility,attachments) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id,
            body.taskId || null,
            body.parentId || null,
            req.user!.userId,
            body.body,
            body.visibility,
            JSON.stringify(body.attachments),
          );
        const recipients = new Set(body.mentions);
        if (body.parentId)
          recipients.add(
            (
              sqlite
                .prepare("SELECT user_id FROM suite_comments WHERE id=?")
                .get(body.parentId) as any
            ).user_id,
          );
        for (const userId of recipients) {
          const user: any = sqlite
            .prepare(
              "SELECT role FROM users WHERE id=? AND disabled_at IS NULL",
            )
            .get(userId);
          if (!user)
            throw new Error("A mentioned teammate is no longer active.");
          if (body.visibility === "owner" && user.role !== "owner")
            throw new Error("Owner notes can only mention owners.");
          if (userId !== req.user!.userId)
            sqlite
              .prepare(
                "INSERT OR IGNORE INTO suite_notifications(user_id,event_key,title,href) VALUES(?,?,?,?)",
              )
              .run(
                userId,
                `comment:${inserted.lastInsertRowid}`,
                `${req.user!.name} mentioned or replied to you`,
                `/project/${id}?tab=activity`,
              );
        }
        return { id: Number(inserted.lastInsertRowid) };
      },
    );
  });
  endpoint("get", "/api/suite/notifications", false, (req) =>
    sqlite
      .prepare(
        `SELECT * FROM suite_notifications WHERE user_id=? AND resolved_at IS NULL AND coalesce(snoozed_until,0)<=? ORDER BY id DESC LIMIT 80`,
      )
      .all(req.user!.userId, Date.now()),
  );
  endpoint("patch", "/api/suite/notifications/:id", false, (req) => {
    const body = z
      .object({ action: z.enum(["read", "resolve", "snooze"]) })
      .parse(req.body);
    const field = {
      read: "read_at",
      resolve: "resolved_at",
      snooze: "snoozed_until",
    }[body.action];
    sqlite
      .prepare(
        `UPDATE suite_notifications SET ${field}=? WHERE id=? AND user_id=?`,
      )
      .run(
        Date.now() + (body.action === "snooze" ? 3600000 : 0),
        idSchema.parse(req.params.id),
        req.user!.userId,
      );
    return { ok: true };
  });
  endpoint("get", "/api/suite/jobs/:id/files", false, (req) => {
    const id = idSchema.parse(req.params.id);
    jobRecord(id);
    return sqlite
      .prepare(
        "SELECT f.*,(SELECT thumbnail_url FROM suite_photo_previews WHERE url=f.url) AS thumbnail_url,u.name AS user_name FROM suite_files f JOIN users u ON u.id=f.user_id WHERE f.project_id=? ORDER BY f.id DESC",
      )
      .all(id);
  });
  endpoint("get", "/api/suite/jobs/:id/source-files", false, req=>{
    const job=jobRecord(idSchema.parse(req.params.id)), rows:any[]=[];
    const lead:any=job.lead_id?sqlite.prepare('SELECT photos FROM crm_leads WHERE id=? AND deleted_at IS NULL').get(job.lead_id):null;
    const photos=parse(lead?.photos,[]);
    if(Array.isArray(photos))for(const [index,url] of photos.entries())if(typeof url==='string'&&/^\/uploads\/[A-Za-z0-9_.-]+$/.test(url))rows.push({id:'request-'+index,url,title:'Customer request photo '+(index+1),source:'Customer request',visibility:'Team only',image:true});
    if(isElevated(req)){
      const previews=sqlite.prepare('SELECT id,title,published FROM customer_previews WHERE deleted_at IS NULL AND (project_id=? OR (quote_id IS NOT NULL AND quote_id=?)) ORDER BY id DESC').all(job.id,job.quote_id) as any[];
      for(const p of previews)rows.push({id:'preview-'+p.id,url:'/#/crm/previews?preview='+p.id,title:p.title,source:'Design Studio',visibility:p.published?'Shared with customer':'Team only',image:false});
    }
    return rows;
  });
  endpoint("post", "/api/suite/photo-preview", false, (req) => {
    const b = z
      .object({ url: z.string(), thumbnailUrl: z.string() })
      .parse(req.body);
    localUpload(b.url);
    localUpload(b.thumbnailUrl);
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO suite_photo_previews(url,thumbnail_url) VALUES(?,?)",
      )
      .run(b.url, b.thumbnailUrl);
    return { ok: true };
  });
  endpoint("post", "/api/suite/jobs/:id/files", false, (req) => {
    const id = idSchema.parse(req.params.id);
    jobRecord(id);
    const body = z
      .object({
        requestKey: key,
        title: z.string().trim().min(1).max(200),
        url: z.string(),
        kind: z.enum(["photo", "drawing", "measurement", "receipt", "other"]),
        replacesId: z.number().int().positive().nullable(),
      })
      .parse(req.body);
    return inventoryOnce(
      sqlite,
      req.user!.userId,
      body.requestKey,
      { action: "job-file", id, ...body },
      () => {
        localUpload(body.url);
        if (
          body.replacesId &&
          !sqlite
            .prepare("SELECT 1 FROM suite_files WHERE id=? AND project_id=?")
            .get(body.replacesId, id)
        )
          throw new Error("Choose a revision from this job.");
        if (
          body.replacesId &&
          sqlite
            .prepare("SELECT 1 FROM suite_files WHERE replaces_id=?")
            .get(body.replacesId)
        )
          throw Object.assign(
            new Error(
              "That file already has a newer revision. Refresh and replace the current one.",
            ),
            { status: 409 },
          );
        const r = sqlite
          .prepare(
            "INSERT INTO suite_files(project_id,title,url,kind,replaces_id,user_id) VALUES(?,?,?,?,?,?)",
          )
          .run(
            id,
            body.title,
            body.url,
            body.kind,
            body.replacesId,
            req.user!.userId,
          );
        audit(req, "suite.file_added", {
          targetType: "project",
          targetId: id,
          targetName: body.title,
          details: {
            fileId: Number(r.lastInsertRowid),
            replacesId: body.replacesId,
          },
        });
        return { id: r.lastInsertRowid };
      },
    );
  });
  endpoint('get','/api/suite/clock',false,()=>({date:todayLocal(),timeZone:businessTimeZone,now:Date.now()}));
  endpoint("get", "/api/suite/today", false, (req) => {
    const owner = isElevated(req),
      uid = req.user!.userId;
    const tasks = sqlite
      .prepare(
        `SELECT count(*) OVER() AS total_count,t.id,t.title,t.due_date,t.project_id,p.name AS project_name,(SELECT name FROM users WHERE id=t.assignee_id) AS owner FROM pm_tasks t LEFT JOIN projects p ON p.id=t.project_id WHERE t.deleted_at IS NULL AND t.status!='done' AND ${businessScope(req,"coalesce(p.site,(SELECT site FROM crm_leads WHERE id=t.lead_id))")} ${owner ? "" : "AND t.assignee_id=?"} ORDER BY t.due_date IS NULL,t.due_date,t.id LIMIT 25`,
      )
      .all(...(owner ? [] : [uid])) as any[];
    const jobs = sqlite
      .prepare(
        `SELECT count(*) OVER() AS total_count,p.* FROM projects p WHERE p.deleted_at IS NULL AND p.status='active' AND ${businessScope(req,'p.site')} ${owner ? "" : "AND EXISTS(SELECT 1 FROM pm_tasks t WHERE t.project_id=p.id AND t.assignee_id=? AND t.deleted_at IS NULL)"} ORDER BY p.start_date IS NULL,p.start_date,p.id DESC LIMIT 12`,
      )
      .all(...(owner ? [] : [uid])) as any[];
    const loans = sqlite
      .prepare(
        `SELECT l.id,l.item_id,l.quantity-l.returned_quantity AS outstanding,i.name FROM inventory_loans l JOIN items i ON i.id=l.item_id WHERE l.quantity>l.returned_quantity ${owner ? "" : "AND l.borrower_id=?"} LIMIT 20`,
      )
      .all(...(owner ? [] : [uid]));
    const readiness=jobReadinessMany(jobs.map(j=>j.id));
    const today=todayLocal();
    const jobCandidates=[...jobs];
    const jobsNeeded=Math.max(0,5-tasks.filter(t=>t.due_date&&t.due_date<=today).length);
    // Look beyond the display page, so a ready first page never hides an
    // upcoming job with blockers. Batch only as far as the five actions need.
    for(let offset=12;offset<(jobs[0]?.total_count||0)&&jobCandidates.filter(j=>!readiness.get(j.id)!.ready).length<jobsNeeded;offset+=50){
      const more=sqlite.prepare(`SELECT p.* FROM projects p WHERE p.deleted_at IS NULL AND p.status='active' AND ${businessScope(req,'p.site')} ${owner?'':'AND EXISTS(SELECT 1 FROM pm_tasks t WHERE t.project_id=p.id AND t.assignee_id=? AND t.deleted_at IS NULL)'} ORDER BY p.start_date IS NULL,p.start_date,p.id DESC LIMIT 50 OFFSET ?`).all(...(owner?[]:[uid]),offset) as any[];
      for(const [id,row] of jobReadinessMany(more.map(j=>j.id)))readiness.set(id,row);
      jobCandidates.push(...more);
    }
    const nextActions=[
      ...tasks.map(t=>({key:`task:${t.id}`,title:t.title,href:`/pm/board?task=${t.id}`,owner:t.owner||'Unassigned',reason:t.due_date?`${t.due_date<today?'Overdue':t.due_date===today?'Due today':'Due'} · ${t.due_date}`:'Choose a follow-up date',rank:t.due_date&&t.due_date<=today?0:3,date:t.due_date||'9999',action:'Open task'})),
      ...jobCandidates.filter(j=>!readiness.get(j.id)!.ready).map(j=>({key:`job:${j.id}`,title:j.name,href:`/project/${j.id}`,owner:'Job team',reason:readiness.get(j.id)!.blockers[0]?.label,rank:j.start_date&&j.start_date<=today?1:2,date:j.start_date||'9999',action:'Review job'}))
    ].sort((a,b)=>a.rank-b.rank||a.date.localeCompare(b.date)||a.key.localeCompare(b.key)).slice(0,5);
    return {
      nextActions,
      totals:{tasks:tasks[0]?.total_count||0,jobs:jobs[0]?.total_count||0},
      tasks,
      jobs: jobs.map((p) => {
        const r = readiness.get(p.id)!;
        return {
          id: p.id,
          name: p.name,
          startDate: p.start_date,
          scheduleState: p.schedule_state,
          blockers: r.blockers,
          ready: r.ready,
        };
      }),
      loans,
      date: todayLocal(),
    };
  });
  endpoint("get", "/api/suite/health", true, req => suiteHealth(req.query));
  endpoint("patch", "/api/suite/review/:id", true, (req) => {
    const body = z
      .object({ reason: z.string().trim().min(3).max(500) })
      .parse(req.body);
    sqlite
      .prepare("UPDATE suite_review_actions SET resolved_at=? WHERE id=?")
      .run(Date.now(), idSchema.parse(req.params.id));
    audit(req, "suite.review_resolved", {
      targetType: "review",
      targetId: Number(req.params.id),
      details: body,
    });
    return { ok: true };
  });
  endpoint("patch", "/api/suite/outbox/:id", true, (req) => {
    const body = z
      .object({ action: z.enum(["retry", "snooze", "stop"]) })
      .parse(req.body);
    const row: any = sqlite
      .prepare("SELECT * FROM suite_outbox WHERE id=?")
      .get(idSchema.parse(req.params.id));
    if (!row || ["running", "completed"].includes(row.status))
      throw new Error("Only pending or failed work can be changed.");
    if (row.status === "review" && body.action === "retry")
      throw new Error(
        "Check provider delivery history before issuing a new send; this retry identity is outside its safe window.",
      );
    sqlite
      .prepare(
        "UPDATE suite_outbox SET status=?,available_at=?,attempts=0 WHERE id=?",
      )
      .run(
        body.action === "stop" ? "stopped" : "pending",
        Date.now() + (body.action === "snooze" ? 3600000 : 0),
        row.id,
      );
    audit(req, "suite.automation_action", {
      targetType: "automation",
      targetId: row.id,
      details: body,
    });
    return { ok: true };
  });
  // A small authenticated stream carries revision numbers only. Records retain
  // their existing API permissions; no personal data or credentials travel here.
  app.get("/api/suite/events", requireAuth, (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let previous = "";
    const send = () => {
      const session = getSession(String(req.headers["x-auth"] || ""));
      if (!session) {
        res.end();
        return;
      }
      const revisions = sqlite
        .prepare("SELECT * FROM suite_revisions")
        .all()
        .filter(
          (r: any) =>
            ["owner","manager"].includes(session.role) || r.topic!=="finance",
        );
      const data = JSON.stringify(revisions);
      if (data !== previous) {
        res.write(`data: ${data}\n\n`);
        previous = data;
      } else res.write(": keepalive\n\n");
      (res as any).flush?.();
    };
    send();
    const interval = setInterval(send, 3000);
    interval.unref();
    res.on("close", () => clearInterval(interval));
  });
}
