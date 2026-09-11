import { normalizeStockUnit } from "../shared/inventory";
import { sqlite } from "./storage";

export function initializeSuite() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS suite_revisions(topic TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS suite_job_rules(project_id INTEGER PRIMARY KEY REFERENCES projects(id),deposit_required INTEGER NOT NULL DEFAULT 0,documents_required TEXT NOT NULL DEFAULT '[]',tools TEXT NOT NULL DEFAULT '[]',override_reason TEXT,override_by INTEGER,override_at INTEGER);
    CREATE TABLE IF NOT EXISTS suite_comments(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),task_id INTEGER REFERENCES pm_tasks(id),parent_id INTEGER REFERENCES suite_comments(id),user_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'team',attachments TEXT NOT NULL DEFAULT '[]',created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
    CREATE INDEX IF NOT EXISTS suite_comments_project ON suite_comments(project_id,id);
    CREATE TABLE IF NOT EXISTS suite_notifications(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),event_key TEXT NOT NULL,title TEXT NOT NULL,href TEXT NOT NULL,read_at INTEGER,resolved_at INTEGER,snoozed_until INTEGER,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),UNIQUE(user_id,event_key));
    CREATE INDEX IF NOT EXISTS suite_notifications_user ON suite_notifications(user_id,id);
    CREATE TABLE IF NOT EXISTS suite_files(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),title TEXT NOT NULL,url TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'photo',replaces_id INTEGER REFERENCES suite_files(id),user_id INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
    CREATE TABLE IF NOT EXISTS suite_photo_previews(url TEXT PRIMARY KEY,thumbnail_url TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suite_outbox(id INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,locked_at INTEGER,last_error TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),completed_at INTEGER);
    CREATE TABLE IF NOT EXISTS suite_review_actions(id INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,project_id INTEGER REFERENCES projects(id),kind TEXT NOT NULL,title TEXT NOT NULL,href TEXT NOT NULL,resolved_at INTEGER,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
    CREATE TRIGGER IF NOT EXISTS suite_project_version AFTER UPDATE ON projects WHEN NEW.version=OLD.version BEGIN UPDATE projects SET version=version+1 WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS suite_change_order_review AFTER UPDATE OF status ON pm_change_orders WHEN NEW.status='approved' AND OLD.status!='approved' BEGIN
      INSERT OR IGNORE INTO suite_review_actions(event_key,project_id,kind,title,href) VALUES('change-order:'||NEW.id,NEW.project_id,'billing','Review approved extra: '||NEW.title,'/project/'||NEW.project_id||'?tab=money'); END;
    CREATE TRIGGER IF NOT EXISTS suite_change_order_create AFTER INSERT ON pm_change_orders WHEN NEW.status='approved' BEGIN
      INSERT OR IGNORE INTO suite_review_actions(event_key,project_id,kind,title,href) VALUES('change-order:'||NEW.id,NEW.project_id,'billing','Review approved extra: '||NEW.title,'/project/'||NEW.project_id||'?tab=money'); END;
    CREATE TRIGGER IF NOT EXISTS suite_change_order_void AFTER UPDATE OF status ON pm_change_orders WHEN NEW.status='void' BEGIN UPDATE suite_review_actions SET resolved_at=unixepoch()*1000 WHERE event_key='change-order:'||NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS suite_task_assign_insert AFTER INSERT ON pm_tasks WHEN NEW.assignee_id IS NOT NULL BEGIN
      INSERT OR IGNORE INTO suite_notifications(user_id,event_key,title,href) VALUES(NEW.assignee_id,'task:'||NEW.id||':'||NEW.assignee_id,'Assigned: '||NEW.title,'/pm/board?task='||NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS suite_task_assign_update AFTER UPDATE OF assignee_id ON pm_tasks WHEN NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS NOT OLD.assignee_id BEGIN
      INSERT INTO suite_notifications(user_id,event_key,title,href) VALUES(NEW.assignee_id,'task:'||NEW.id||':'||NEW.assignee_id,'Assigned: '||NEW.title,'/pm/board?task='||NEW.id)
      ON CONFLICT(user_id,event_key) DO UPDATE SET read_at=NULL,resolved_at=NULL,snoozed_until=NULL; END;
    CREATE TRIGGER IF NOT EXISTS suite_task_unassign AFTER UPDATE OF assignee_id ON pm_tasks WHEN OLD.assignee_id IS NOT NULL AND NEW.assignee_id IS NOT OLD.assignee_id BEGIN UPDATE suite_notifications SET resolved_at=unixepoch()*1000 WHERE user_id=OLD.assignee_id AND event_key='task:'||NEW.id||':'||OLD.assignee_id; END;
    CREATE TRIGGER IF NOT EXISTS suite_task_resolved AFTER UPDATE OF status,deleted_at ON pm_tasks WHEN NEW.status='done' OR NEW.deleted_at IS NOT NULL BEGIN
      UPDATE suite_notifications SET resolved_at=unixepoch()*1000 WHERE event_key LIKE 'task:'||NEW.id||':%'; END;
  `);
  const topics: Record<string, string[]> = {
    inventory: [
      "items",
      "transactions",
      "adjustments",
      "inventory_reservations",
      "inventory_receipts",
      "inventory_loans",
    ],
    jobs: [
      "projects",
      "project_checklist",
      "pm_tasks",
      "pm_contracts",
      "pm_change_orders",
      "pm_documents",
      "suite_job_rules",
      "suite_files",
      "suite_change_bills",
    ],
    time: ["pm_time_entries", "hr_time_corrections"],
    finance: [
      "fin_invoices",
      "fin_invoice_payments",
      "fin_expenses",
      "fin_purchase_orders",
    ],
    crm: [
      "crm_clients",
      "crm_leads",
      "crm_activities",
      "crm_lead_intake",
      "quotes",
      "quote_settings",
    ],
    marketing: ["mk_portfolio", "mk_reviews", "mk_settings"],
    team: [
      "hr_employees",
      "hr_leave_requests",
      "hr_pay_rates",
      "hr_payroll_runs",
    ],
    communication: [
      "suite_comments",
      "suite_notifications",
      "suite_outbox",
      "suite_review_actions",
      "suite_cost_proposals",
      "suite_restore_checks",
    ],
  };
  for (const [topic, tables] of Object.entries(topics)) {
    sqlite
      .prepare("INSERT OR IGNORE INTO suite_revisions(topic) VALUES(?)")
      .run(topic);
    for (const table of tables)
      if (
        sqlite
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        for (const op of ["INSERT", "UPDATE", "DELETE"]) {
          sqlite.exec(
            `CREATE TRIGGER IF NOT EXISTS suite_change_${table}_${op} AFTER ${op} ON ${table} BEGIN UPDATE suite_revisions SET version=version+1 WHERE topic='${topic}'; END;`,
          );
        }
  }
}
export function jobRecord(id: number): any {
  const row = sqlite
    .prepare("SELECT * FROM projects WHERE id=? AND deleted_at IS NULL")
    .get(id);
  if (!row) throw Object.assign(new Error("Job not found."), { status: 404 });
  return row;
}
export function jobMaterials(id: number) {
  const rows = sqlite
    .prepare(
      `SELECT c.*,i.name AS item_name,i.unit AS stock_unit,i.quantity,i.quantity_reserved,i.last_cost_cents,i.supplier,i.material_key,
    coalesce((SELECT sum(r.quantity) FROM inventory_reservations r WHERE r.checklist_id=c.id),0) AS reserved
    FROM project_checklist c LEFT JOIN items i ON i.id=c.item_id AND i.deleted_at IS NULL WHERE c.project_id=? ORDER BY c.id`,
    )
    .all(id) as any[];
  const orders = sqlite
    .prepare(
      "SELECT id,number,items,expected_date FROM fin_purchase_orders WHERE project_id=? AND status='open' AND deleted_at IS NULL",
    )
    .all(id) as any[];
  const incoming = new Map<number, { quantity: number; orders: any[] }>();
  for (const po of orders) {
    let lines: any[] = [];
    try {
      lines = JSON.parse(po.items);
    } catch {}
    lines.forEach((line, index) => {
      if (!line.inventoryItemId) return;
      const received = (
        sqlite
          .prepare(
            "SELECT coalesce(sum(quantity),0) AS n FROM inventory_receipts WHERE po_id=? AND line_index=?",
          )
          .get(po.id, index) as any
      ).n;
      // Only same-unit orders have a known stock quantity before receiving.
      const item = rows.find((r) => r.item_id === line.inventoryItemId);
      if (!item || normalizeStockUnit(line.unit) !== item.stock_unit) return;
      const qty = Math.max(0, line.qty - received),
        entry = incoming.get(line.inventoryItemId) || {
          quantity: 0,
          orders: [],
        };
      entry.quantity += qty;
      entry.orders.push({
        id: po.id,
        number: po.number,
        expectedDate: po.expected_date,
        quantity: qty,
      });
      incoming.set(line.inventoryItemId, entry);
    });
  }
  return rows.map((r) => {
    const needed = ["done", "skipped"].includes(r.status)
        ? 0
        : Math.max(0, Number(r.qty) - Number(r.stock_used || 0)),
      shortage = Math.max(0, needed - r.reserved);
    const arrival = incoming.get(r.item_id) || { quantity: 0, orders: [] };
    // Allocate incoming coverage once, even when several checklist rows use one item.
    const ordered = Math.min(shortage, arrival.quantity);
    arrival.quantity -= ordered;
    return {
      ...r,
      needed,
      shortage,
      ordered,
      missing: Math.max(0, shortage - ordered),
      orders: arrival.orders,
      available: Math.max(0, (r.quantity || 0) - (r.quantity_reserved || 0)),
    };
  });
}
export function jobReadiness(id: number) {
  const job = jobRecord(id),
    materials = jobMaterials(id);
  const rules: any = sqlite
    .prepare("SELECT * FROM suite_job_rules WHERE project_id=?")
    .get(id) || { deposit_required: 0, documents_required: "[]", tools: "[]" };
  const tasks = sqlite
    .prepare(
      "SELECT * FROM pm_tasks WHERE project_id=? AND deleted_at IS NULL AND status!='done'",
    )
    .all(id) as any[];
  const invoices = sqlite
    .prepare(
      "SELECT * FROM fin_invoices WHERE project_id=? AND deleted_at IS NULL AND status!='void'",
    )
    .all(id) as any[];
  const depositDue = invoices.reduce(
    (sum, i) => sum + Math.max(0, (i.deposit_cents || 0) - i.paid_cents),
    0,
  );
  const docs = sqlite
    .prepare(
      "SELECT kind FROM pm_documents WHERE project_id=? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>=date('now','localtime'))",
    )
    .all(id) as any[];
  const required: string[] = JSON.parse(rules.documents_required),
    tools: number[] = JSON.parse(rules.tools);
  const blockers: { kind: string; label: string; tab: string }[] = [];
  if (job.billing_mode === "review")
    blockers.push({
      kind: "billing",
      label: "Review how this job will be billed",
      tab: "money",
    });
  if (
    job.quote_id &&
    !sqlite
      .prepare(
        "SELECT 1 FROM quotes WHERE id=? AND status='accepted' AND deleted_at IS NULL",
      )
      .get(job.quote_id)
  )
    blockers.push({
      kind: "approval",
      label: "Quote approval is pending",
      tab: "overview",
    });
  if (
    rules.deposit_required &&
    (!invoices.some((i) => i.deposit_cents > 0) || depositDue > 0)
  )
    blockers.push({
      kind: "deposit",
      label: "Confirm the required deposit",
      tab: "money",
    });
  if (materials.some((m) => m.needed > 0 && (!m.item_id || m.shortage > 0)))
    blockers.push({
      kind: "materials",
      label: "Review missing or unreserved materials",
      tab: "materials",
    });
  if (!job.start_date || !job.due_date)
    blockers.push({ kind: "dates", label: "Set the work dates", tab: "work" });
  if (!tasks.some((t) => t.assignee_id))
    blockers.push({ kind: "crew", label: "Assign the crew", tab: "work" });
  for (const kind of required)
    if (!docs.some((d) => d.kind === kind))
      blockers.push({
        kind: "document",
        label: `Add current ${kind.replaceAll("_", " ")} paperwork`,
        tab: "files",
      });
  const conflicts: any[] = [];
  if (job.start_date && job.due_date)
    for (const uid of new Set(
      tasks.map((t) => t.assignee_id).filter(Boolean),
    )) {
      const overlaps = sqlite
        .prepare(
          `SELECT t.id,t.title FROM pm_tasks t WHERE t.assignee_id=? AND t.project_id IS NOT ? AND t.deleted_at IS NULL AND t.status!='done'
      AND coalesce(t.start_date,t.due_date)<=? AND coalesce(t.due_date,t.start_date)>=?`,
        )
        .all(uid, id, job.due_date, job.start_date);
      for (const task of overlaps)
        conflicts.push({ kind: "crew", userId: uid, ...(task as any) });
      const leave = sqlite
        .prepare(
          `SELECT l.id FROM hr_leave_requests l JOIN hr_employees e ON e.id=l.employee_id WHERE e.user_id=? AND l.status='approved' AND l.start_date<=? AND l.end_date>=?`,
        )
        .all(uid, job.due_date, job.start_date);
      if (leave.length)
        conflicts.push({
          kind: "leave",
          userId: uid,
          title: "Approved time off",
        });
    }
  for (const itemId of tools) {
    const item: any = sqlite
      .prepare(
        "SELECT name,quantity,quantity_reserved FROM items WHERE id=? AND deleted_at IS NULL",
      )
      .get(itemId);
    if (!item || item.quantity - item.quantity_reserved <= 0)
      conflicts.push({
        kind: "tool",
        title: item?.name || "Required tool unavailable",
      });
    if (job.start_date && job.due_date) {
      const other = sqlite
        .prepare(
          `SELECT p.name FROM suite_job_rules r JOIN projects p ON p.id=r.project_id JOIN json_each(r.tools) tool
        WHERE tool.value=? AND p.id!=? AND p.status='active' AND p.schedule_state='confirmed' AND p.deleted_at IS NULL AND p.start_date<=? AND p.due_date>=?`,
        )
        .all(itemId, id, job.due_date, job.start_date);
      for (const row of other.length >=
      Math.max(0, (item?.quantity || 0) - (item?.quantity_reserved || 0))
        ? other
        : [])
        conflicts.push({
          kind: "tool",
          title: `${item?.name || "Tool"} scheduled on ${(row as any).name}`,
        });
    }
  }
  if (conflicts.length)
    blockers.push({
      kind: "conflict",
      label: "Review crew, leave or tool conflicts",
      tab: "work",
    });
  return {
    rules,
    tasks,
    materials,
    blockers,
    conflicts,
    ready: !blockers.length,
    depositDue,
    override: rules.override_reason
      ? { reason: rules.override_reason, at: rules.override_at }
      : null,
  };
}
