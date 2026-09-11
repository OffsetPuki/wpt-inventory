import type Database from "better-sqlite3";
type DB = Database.Database;

export function initializeStockCosts(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS suite_stock_lots(id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL,receipt_id INTEGER UNIQUE,quantity REAL NOT NULL,remaining REAL NOT NULL,unit_cost REAL,created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
 CREATE INDEX IF NOT EXISTS suite_stock_lots_item ON suite_stock_lots(item_id,id);
 CREATE TABLE IF NOT EXISTS suite_stock_costs(id INTEGER PRIMARY KEY,transaction_id INTEGER NOT NULL,lot_id INTEGER,project_id INTEGER,item_id INTEGER NOT NULL,quantity REAL NOT NULL,unit_cost REAL,returned REAL NOT NULL DEFAULT 0,invoice_id INTEGER);
 CREATE INDEX IF NOT EXISTS suite_stock_costs_job ON suite_stock_costs(project_id,item_id,id);
 CREATE TABLE IF NOT EXISTS suite_cost_proposals(id INTEGER PRIMARY KEY,receipt_id INTEGER UNIQUE,item_id INTEGER NOT NULL,material_key TEXT,supplier TEXT,unit TEXT NOT NULL,unit_cost_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),reviewed_at INTEGER);
 CREATE TABLE IF NOT EXISTS suite_cost_start(id INTEGER PRIMARY KEY,transaction_id INTEGER NOT NULL);
 INSERT OR IGNORE INTO suite_cost_start VALUES(1,(SELECT coalesce(max(id),0) FROM transactions));`);
  if (
    !(db.prepare("PRAGMA table_info(suite_stock_costs)").all() as any[]).some(
      (c) => c.name === "invoice_id",
    )
  )
    db.exec("ALTER TABLE suite_stock_costs ADD COLUMN invoice_id INTEGER");
}

// Opening stock has no reliable purchase provenance. Keep its cost unknown;
// subsequent receipts create immutable FIFO layers, including unit conversions.
export function alignStockLots(db: DB, itemId: number, quantity: number) {
  const known = (
    db
      .prepare(
        "SELECT coalesce(sum(remaining),0) n FROM suite_stock_lots WHERE item_id=?",
      )
      .get(itemId) as any
  ).n;
  const difference = Math.round((quantity - known) * 10000) / 10000;
  if (difference > 0)
    db.prepare(
      "INSERT INTO suite_stock_lots(item_id,quantity,remaining) VALUES(?,?,?)",
    ).run(itemId, difference, difference);
  if (difference < 0) {
    let left = -difference;
    for (const lot of db
      .prepare(
        "SELECT id,remaining FROM suite_stock_lots WHERE item_id=? AND remaining>0 ORDER BY id",
      )
      .all(itemId) as any[]) {
      const used = Math.min(left, lot.remaining);
      db.prepare(
        "UPDATE suite_stock_lots SET remaining=round(remaining-?,4) WHERE id=?",
      ).run(used, lot.id);
      left -= used;
      if (left <= 0) break;
    }
  }
}
export function receiveStockCost(
  db: DB,
  receiptId: number,
  itemId: number,
  quantity: number,
  totalCost: number,
  supplier: string,
) {
  const item: any = db
    .prepare("SELECT quantity,unit,material_key FROM items WHERE id=?")
    .get(itemId);
  alignStockLots(db, itemId, item.quantity - quantity);
  db.prepare(
    "INSERT INTO suite_stock_lots(item_id,receipt_id,quantity,remaining,unit_cost) VALUES(?,?,?,?,?)",
  ).run(itemId, receiptId, quantity, quantity, totalCost / quantity);
  db.prepare(
    "INSERT INTO suite_cost_proposals(receipt_id,item_id,material_key,supplier,unit,unit_cost_cents) VALUES(?,?,?,?,?,?)",
  ).run(
    receiptId,
    itemId,
    item.material_key,
    supplier,
    item.unit,
    Math.round(totalCost / quantity),
  );
}
export function recordStockCost(
  db: DB,
  transactionId: number,
  item: any,
  projectId: number | undefined,
  quantity: number,
  returning: boolean,
) {
  alignStockLots(db, item.id, item.quantity);
  if (returning) {
    let left = quantity;
    const used = db
      .prepare(
        "SELECT * FROM suite_stock_costs WHERE item_id=? AND project_id IS ? AND quantity>returned AND quantity>0 ORDER BY id DESC",
      )
      .all(item.id, projectId || null) as any[];
    for (const row of used) {
      const amount = Math.min(left, row.quantity - row.returned);
      if (amount <= 0) continue;
      db.prepare(
        "UPDATE suite_stock_costs SET returned=round(returned+?,4) WHERE id=?",
      ).run(amount, row.id);
      if (row.lot_id)
        db.prepare(
          "UPDATE suite_stock_lots SET remaining=round(remaining+?,4) WHERE id=?",
        ).run(amount, row.lot_id);
      db.prepare(
        "INSERT INTO suite_stock_costs(transaction_id,lot_id,project_id,item_id,quantity,unit_cost) VALUES(?,?,?,?,?,?)",
      ).run(
        transactionId,
        row.lot_id,
        projectId || null,
        item.id,
        -amount,
        row.unit_cost,
      );
      left -= amount;
      if (left <= 0) break;
    }
    if (left > 0) {
      db.prepare(
        "INSERT INTO suite_stock_lots(item_id,quantity,remaining) VALUES(?,?,?)",
      ).run(item.id, left, left);
      db.prepare(
        "INSERT INTO suite_stock_costs(transaction_id,project_id,item_id,quantity) VALUES(?,?,?,?)",
      ).run(transactionId, projectId || null, item.id, -left);
    }
  } else {
    let left = quantity;
    for (const lot of db
      .prepare(
        "SELECT * FROM suite_stock_lots WHERE item_id=? AND remaining>0 ORDER BY id",
      )
      .all(item.id) as any[]) {
      const amount = Math.min(left, lot.remaining);
      db.prepare(
        "UPDATE suite_stock_lots SET remaining=round(remaining-?,4) WHERE id=?",
      ).run(amount, lot.id);
      db.prepare(
        "INSERT INTO suite_stock_costs(transaction_id,lot_id,project_id,item_id,quantity,unit_cost) VALUES(?,?,?,?,?,?)",
      ).run(
        transactionId,
        lot.id,
        projectId || null,
        item.id,
        amount,
        lot.unit_cost,
      );
      left -= amount;
      if (left <= 0) break;
    }
  }
}
export function jobStockCost(db: DB, id: number) {
  const row: any = db
    .prepare(
      "SELECT round(coalesce(sum(quantity*unit_cost),0)) cost,coalesce(sum(CASE WHEN unit_cost IS NULL THEN quantity ELSE 0 END),0) missing FROM suite_stock_costs WHERE project_id=?",
    )
    .get(id);
  const old: any = db
    .prepare(
      `SELECT count(*) n FROM transactions t JOIN items i ON i.id=t.item_id WHERE t.project_id=? AND t.id<=(SELECT transaction_id FROM suite_cost_start WHERE id=1) AND NOT (i.item_type='tool' OR (i.item_type='stock' AND i.category='tools'))`,
    )
    .get(id);
  // Received stock is a purchase on the business ledger; charge it to jobs when
  // consumed. Keep direct, unstocked order lines as job expenses.
  const stockedPurchases: any = db
    .prepare(
      `SELECT coalesce(sum(l.quantity*l.unit_cost),0) cents FROM suite_stock_lots l JOIN inventory_receipts r ON r.id=l.receipt_id JOIN inventory_po_expenses p ON p.po_id=r.po_id JOIN fin_expenses e ON e.id=p.expense_id WHERE e.project_id=? AND e.deleted_at IS NULL`,
    )
    .get(id);
  return {
    stockCostCents: row.cost,
    unknownStockQuantity: Math.max(0, row.missing),
    historicalMovementsWithoutCost: old.n,
    stockPurchaseCents: Math.round(stockedPurchases.cents),
  };
}

export function unbilledStock(db: DB, projectId: number) {
  return db
    .prepare(
      `SELECT c.item_id,i.name,i.unit,group_concat(c.id) ids,round(sum(c.quantity),4) quantity,
 round(sum(c.quantity*c.unit_cost)) costCents,
 sum(CASE WHEN c.unit_cost IS NULL THEN abs(c.quantity) ELSE 0 END) missing
 FROM suite_stock_costs c JOIN items i ON i.id=c.item_id WHERE c.project_id=? AND c.invoice_id IS NULL
 GROUP BY c.item_id ORDER BY c.item_id`,
    )
    .all(projectId) as {
    item_id: number;
    name: string;
    unit: string;
    ids: string;
    quantity: number;
    costCents: number;
    missing: number;
  }[];
}
