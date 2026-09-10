import type Database from "better-sqlite3";
import {
  fractionalUnit,
  isTool,
  normalizeStockUnit,
  stockRound,
  STOCK_UNITS,
} from "../shared/inventory";

type DB = Database.Database;
export function inventoryMigrate(db: DB) {
  const add = (table: string, column: string, definition: string) => {
    if (
      !(db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
        (c) => c.name === column,
      )
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  // SQLite's numeric affinity already preserves fractional values in the existing
  // non-STRICT quantity columns. No rebuild or rounding of historical stock.
  for (const [column, definition] of Object.entries({
    unit: "TEXT NOT NULL DEFAULT 'each'",
    stock_version: "INTEGER NOT NULL DEFAULT 0",
    detail_version: "INTEGER NOT NULL DEFAULT 0",
    reorder_target: "REAL NOT NULL DEFAULT 0",
    supplier: "TEXT",
    last_cost_cents: "INTEGER NOT NULL DEFAULT 0",
  }))
    add("items", column, definition);
  add("project_checklist", "stock_used", "REAL NOT NULL DEFAULT 0");
  for (const table of ["transactions", "adjustments"]) {
    add(table, "before_quantity", "REAL");
    add(table, "after_quantity", "REAL");
    add(table, "stock_unit", "TEXT");
  }
  add("transactions", "action", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_requests (user_id INTEGER NOT NULL, request_key TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(user_id, request_key));
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      checklist_id INTEGER UNIQUE REFERENCES project_checklist(id) ON DELETE CASCADE,
      quantity REAL NOT NULL CHECK(quantity >= 0), created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_reservation_item ON inventory_reservations(item_id, project_id);
    CREATE TABLE IF NOT EXISTS inventory_loans (
      id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      borrower_id INTEGER NOT NULL REFERENCES users(id), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      quantity REAL NOT NULL, returned_quantity REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_loans_item ON inventory_loans(item_id);
    CREATE TABLE IF NOT EXISTS inventory_receipts (
      id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL, line_index INTEGER NOT NULL,
      quantity REAL NOT NULL, item_id INTEGER REFERENCES items(id), stock_quantity REAL NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_receipt_po ON inventory_receipts(po_id, line_index);
    CREATE TABLE IF NOT EXISTS inventory_po_expenses (
      po_id INTEGER PRIMARY KEY,
      expense_id INTEGER REFERENCES fin_expenses(id) ON DELETE SET NULL
    );
    CREATE TRIGGER IF NOT EXISTS inventory_stock_version AFTER UPDATE OF quantity, quantity_reserved, unit ON items
      WHEN NEW.quantity != OLD.quantity OR NEW.quantity_reserved != OLD.quantity_reserved OR NEW.unit != OLD.unit BEGIN
      UPDATE items SET stock_version = stock_version + 1 WHERE id = NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS inventory_nonnegative BEFORE UPDATE OF quantity ON items
      WHEN NEW.quantity < 0 AND NEW.quantity < OLD.quantity BEGIN SELECT RAISE(ABORT, 'Not enough stock. Refresh and check the available quantity.'); END;
    CREATE TRIGGER IF NOT EXISTS inventory_transaction_balance AFTER INSERT ON transactions BEGIN
      UPDATE transactions SET before_quantity = (SELECT quantity FROM items WHERE id = NEW.item_id) - CASE WHEN NEW.type='check_out' THEN -NEW.quantity ELSE NEW.quantity END,
        after_quantity = (SELECT quantity FROM items WHERE id=NEW.item_id), stock_unit = (SELECT unit FROM items WHERE id=NEW.item_id) WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS inventory_adjustment_balance AFTER INSERT ON adjustments BEGIN
      UPDATE adjustments SET before_quantity = (SELECT quantity FROM items WHERE id=NEW.item_id) - NEW.delta,
        after_quantity = (SELECT quantity FROM items WHERE id=NEW.item_id), stock_unit = (SELECT unit FROM items WHERE id=NEW.item_id) WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS inventory_reservation_delete AFTER DELETE ON inventory_reservations BEGIN
      UPDATE items SET quantity_reserved = MAX(0, ROUND(quantity_reserved - OLD.quantity, 4)) WHERE id=OLD.item_id; END;
    CREATE TABLE IF NOT EXISTS inventory_migrations (key TEXT PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS idx_items_active_name ON items(name COLLATE NOCASE, id) WHERE deleted_at IS NULL;
  `);
  // Attribute only reservations already present in the old total; never invent
  // stock, increase reservations, or infer historical borrowers during migration.
  if (
    !db
      .prepare(
        "SELECT 1 FROM inventory_migrations WHERE key='reservation-attribution-v1'",
      )
      .get()
  )
    db.transaction(() => {
      for (const item of db
        .prepare(
          "SELECT id, quantity_reserved FROM items WHERE quantity_reserved > 0",
        )
        .all() as any[]) {
        let remaining = item.quantity_reserved;
        const rows = db
          .prepare(
            "SELECT c.id,c.qty,c.project_id FROM project_checklist c JOIN projects p ON p.id=c.project_id WHERE c.item_id=? AND c.status IN ('pending','ordered') AND p.deleted_at IS NULL AND p.status!='done' ORDER BY c.id",
          )
          .all(item.id) as any[];
        for (const row of rows) {
          const qty = Math.min(remaining, Math.max(0, Number(row.qty) || 0));
          if (qty > 0)
            db.prepare(
              "INSERT INTO inventory_reservations(item_id,project_id,checklist_id,quantity) VALUES(?,?,?,?)",
            ).run(item.id, row.project_id, row.id, qty);
          remaining = stockRound(remaining - qty);
        }
      }
      db.prepare(
        "INSERT INTO inventory_migrations VALUES('reservation-attribution-v1')",
      ).run();
    })();
}

export function activeItem(db: DB, id: number): any {
  const item = db
    .prepare("SELECT * FROM items WHERE id=? AND deleted_at IS NULL")
    .get(id) as any;
  if (!item) throw new Error("Item not found");
  return item;
}
export function validateQuantity(n: number, unit: string, allowZero = false) {
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    (!allowZero && n === 0) ||
    n > 1e9 ||
    stockRound(n) !== n
  )
    throw new Error("Enter a valid quantity with up to four decimal places.");
  if (!fractionalUnit(unit) && !Number.isInteger(n))
    throw new Error(
      `${unit} must be counted in whole numbers. Choose a measured unit for fractional stock.`,
    );
}
export function validateItemData(data: any, existing?: any) {
  if (
    data.name !== undefined &&
    (typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > 240)
  )
    throw new Error("Enter an item name (up to 240 characters).");
  const unit = normalizeStockUnit(data.unit ?? existing?.unit);
  if (!(STOCK_UNITS as readonly string[]).includes(unit))
    throw new Error("Choose a supported stock unit.");
  if (!existing) validateQuantity(Number(data.quantity ?? 0), unit, true);
  for (const key of ["lowStockThreshold", "reorderTarget"])
    if (data[key] !== undefined)
      validateQuantity(Number(data[key]), unit, true);
  if (
    (data.itemType ?? existing?.itemType) === "tool" &&
    (unit !== "each" || (existing && !Number.isInteger(existing.quantity)))
  )
    throw new Error("Reusable tools must use whole pieces.");
  if (
    data.lastCostCents !== undefined &&
    (!Number.isSafeInteger(data.lastCostCents) || data.lastCostCents < 0)
  )
    throw new Error("Enter a valid unit cost.");
  return unit;
}
export function inventoryOnce<T>(
  db: DB,
  userId: number,
  key: string | undefined,
  payload: unknown,
  fn: () => T,
): T {
  return db.transaction(() => {
    const encoded = JSON.stringify(payload);
    if (key) {
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
        throw new Error("Invalid operation key");
      const prior = db
        .prepare(
          "SELECT payload,result FROM inventory_requests WHERE user_id=? AND request_key=?",
        )
        .get(userId, key) as any;
      if (prior) {
        if (prior.payload !== encoded)
          throw new Error(
            "This operation was already saved with different details. Refresh before making another change.",
          );
        return JSON.parse(prior.result);
      }
    }
    const result = fn();
    if (key)
      db.prepare("INSERT INTO inventory_requests VALUES(?,?,?,?)").run(
        userId,
        key,
        encoded,
        JSON.stringify(result),
      );
    return result;
  })();
}
export function reservationRows(db: DB, id: number) {
  return db
    .prepare(
      `SELECT r.id,r.project_id AS projectId,r.checklist_id AS checklistId,r.quantity,p.job_number AS jobNumber,p.name AS projectName
    FROM inventory_reservations r JOIN projects p ON p.id=r.project_id WHERE r.item_id=? AND r.quantity>0 ORDER BY p.job_number,r.id`,
    )
    .all(id);
}
export function loanRows(db: DB, id: number) {
  return db
    .prepare(
      `SELECT l.id,l.item_id AS itemId,l.quantity,ROUND(l.quantity-l.returned_quantity,4) AS remaining,l.project_id AS projectId,
    u.name AS borrowerName,p.job_number AS jobNumber,l.created_at AS createdAt FROM inventory_loans l JOIN users u ON u.id=l.borrower_id
    LEFT JOIN projects p ON p.id=l.project_id WHERE l.item_id=? AND l.quantity>l.returned_quantity ORDER BY l.created_at,l.id`,
    )
    .all(id);
}
export function releaseReservation(db: DB, id: number) {
  db.prepare("DELETE FROM inventory_reservations WHERE id=?").run(id);
}
export function reserveStock(
  db: DB,
  itemId: number,
  projectId: number,
  quantity: number,
  checklistId: number | null = null,
  allowPartial = false,
) {
  return db.transaction(() => {
    const item = activeItem(db, itemId);
    validateQuantity(quantity, item.unit);
    if (
      !db
        .prepare(
          "SELECT id FROM projects WHERE id=? AND deleted_at IS NULL AND status!='done'",
        )
        .get(projectId)
    )
      throw new Error("Choose an open job.");
    const available = Math.max(
      0,
      stockRound(item.quantity - item.quantity_reserved),
    );
    if (quantity > available && !allowPartial)
      throw new Error(`Only ${available} ${item.unit} available to reserve.`);
    const qty = Math.min(quantity, available);
    if (qty <= 0) return null;
    const id = db
      .prepare(
        "INSERT INTO inventory_reservations(item_id,project_id,checklist_id,quantity) VALUES(?,?,?,?)",
      )
      .run(itemId, projectId, checklistId, qty).lastInsertRowid;
    db.prepare(
      "UPDATE items SET quantity_reserved=ROUND(quantity_reserved+?,4) WHERE id=?",
    ).run(qty, itemId);
    return Number(id);
  })();
}
function consumeReservations(
  db: DB,
  itemId: number,
  projectId: number | undefined,
  quantity: number,
  checklistId?: number,
) {
  if (!projectId) return;
  let left = quantity;
  const rows = db
    .prepare(
      `SELECT * FROM inventory_reservations WHERE item_id=? AND project_id=? ${checklistId ? "AND checklist_id=?" : ""} ORDER BY id`,
    )
    .all(
      ...(checklistId ? [itemId, projectId, checklistId] : [itemId, projectId]),
    ) as any[];
  for (const row of rows) {
    const used = Math.min(left, row.quantity);
    if (used <= 0) continue;
    db.prepare(
      "UPDATE inventory_reservations SET quantity=ROUND(quantity-?,4) WHERE id=?",
    ).run(used, row.id);
    db.prepare(
      "UPDATE items SET quantity_reserved=MAX(0,ROUND(quantity_reserved-?,4)) WHERE id=?",
    ).run(used, itemId);
    left = stockRound(left - used);
  }
}
function recordChecklistUsage(
  db: DB,
  itemId: number,
  projectId: number | undefined,
  quantity: number,
  checklistId?: number,
  returning = false,
) {
  if (!projectId) return;
  let left = quantity;
  const rows = db
    .prepare(
      `SELECT id,qty,stock_used FROM project_checklist WHERE item_id=? AND project_id=? ${checklistId ? "AND id=?" : ""} ORDER BY id`,
    )
    .all(
      ...(checklistId ? [itemId, projectId, checklistId] : [itemId, projectId]),
    ) as any[];
  for (const row of returning ? rows.reverse() : rows) {
    const amount = Math.min(
      left,
      Math.max(
        0,
        returning ? row.stock_used : Number(row.qty) - row.stock_used,
      ),
    );
    if (amount <= 0) continue;
    db.prepare(
      "UPDATE project_checklist SET stock_used=ROUND(stock_used+?,4) WHERE id=?",
    ).run(returning ? -amount : amount, row.id);
    left = stockRound(left - amount);
  }
}
export function moveStock(
  db: DB,
  itemId: number,
  userId: number,
  type: "check_out" | "check_in",
  data: {
    quantity: number;
    notes?: string;
    projectId?: number;
    requestKey?: string;
    loanId?: number;
    action?: string;
    checklistId?: number;
  },
) {
  return inventoryOnce(
    db,
    userId,
    data.requestKey,
    { itemId, type, ...data },
    () => {
      const item = activeItem(db, itemId);
      const tool = isTool({
        itemType: item.item_type,
        category: item.category,
      });
      validateQuantity(data.quantity, tool ? "each" : item.unit);
      if (
        data.projectId &&
        !db
          .prepare("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL")
          .get(data.projectId)
      )
        throw new Error("Job not found.");
      if (type === "check_out") {
        const own = data.projectId
          ? (
              db
                .prepare(
                  `SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_reservations WHERE item_id=? AND project_id=? ${data.checklistId ? "AND checklist_id=?" : ""}`,
                )
                .get(
                  ...(data.checklistId
                    ? [itemId, data.projectId, data.checklistId]
                    : [itemId, data.projectId]),
                ) as any
            ).n
          : 0;
        const available = Math.min(
          item.quantity,
          Math.max(0, stockRound(item.quantity - item.quantity_reserved + own)),
        );
        if (data.quantity > available)
          throw new Error(
            `Only ${available} ${item.unit} available for this job. Other stock is reserved.`,
          );
        consumeReservations(
          db,
          itemId,
          data.projectId,
          data.quantity,
          data.checklistId,
        );
        recordChecklistUsage(
          db,
          itemId,
          data.projectId,
          data.quantity,
          data.checklistId,
        );
      } else if (tool && data.action !== "receive") {
        const loan = db
          .prepare("SELECT * FROM inventory_loans WHERE id=? AND item_id=?")
          .get(data.loanId ?? -1, itemId) as any;
        if (!loan)
          throw new Error(
            "Choose the checkout being returned. Use Receive stock for newly purchased tools or Count stock to reconcile older records.",
          );
        if (data.quantity > stockRound(loan.quantity - loan.returned_quantity))
          throw new Error("The return exceeds the outstanding checkout.");
        db.prepare(
          "UPDATE inventory_loans SET returned_quantity=ROUND(returned_quantity+?,4) WHERE id=?",
        ).run(data.quantity, loan.id);
        data.projectId = loan.project_id ?? undefined;
      }
      if (!tool && type === "check_in" && data.action !== "receive")
        recordChecklistUsage(
          db,
          itemId,
          data.projectId,
          data.quantity,
          undefined,
          true,
        );
      const delta = type === "check_out" ? -data.quantity : data.quantity;
      db.prepare(
        "UPDATE items SET quantity=ROUND(quantity+?,4) WHERE id=?",
      ).run(delta, itemId);
      const action =
        type === "check_out"
          ? tool
            ? "check_out"
            : "use_on_job"
          : data.action === "receive"
            ? "receive"
            : tool
              ? "return_tool"
              : "return_unused";
      const id = Number(
        db
          .prepare(
            "INSERT INTO transactions(item_id,user_id,type,quantity,notes,project_id,action) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            itemId,
            userId,
            type,
            data.quantity,
            data.notes || null,
            data.projectId || null,
            action,
          ).lastInsertRowid,
      );
      if (tool && type === "check_out")
        db.prepare(
          "INSERT INTO inventory_loans(id,item_id,borrower_id,project_id,quantity) VALUES(?,?,?,?,?)",
        ).run(id, itemId, userId, data.projectId || null, data.quantity);
      return id;
    },
  );
}
export function adjustStock(
  db: DB,
  itemId: number,
  userId: number,
  data: {
    delta?: number;
    countedQuantity?: number;
    expectedVersion?: number;
    reason: string;
    notes?: string;
    projectId?: number | null;
    requestKey?: string;
  },
) {
  return inventoryOnce(db, userId, data.requestKey, { itemId, ...data }, () => {
    const item = activeItem(db, itemId);
    if (
      data.countedQuantity !== undefined &&
      data.expectedVersion !== item.stock_version
    )
      throw new Error(
        "Stock changed while you were counting. Refresh the item and confirm your count again.",
      );
    const next =
      data.countedQuantity ?? stockRound(item.quantity + (data.delta ?? 0));
    validateQuantity(next, item.unit, true);
    const delta = stockRound(next - item.quantity);
    db.prepare("UPDATE items SET quantity=? WHERE id=?").run(next, itemId);
    return Number(
      db
        .prepare(
          "INSERT INTO adjustments(item_id,user_id,delta,reason,notes,project_id) VALUES(?,?,?,?,?,?)",
        )
        .run(
          itemId,
          userId,
          delta,
          data.reason,
          data.notes || null,
          data.projectId || null,
        ).lastInsertRowid,
    );
  });
}
