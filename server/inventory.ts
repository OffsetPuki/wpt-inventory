import type { Express } from "express";
import { and, sql, eq, asc, desc, getTableColumns } from "drizzle-orm";
import { db, sqlite, storage } from "./storage";
import { items } from "../shared/schema";
import { requireAuth, requireElevated } from "./auth";
import { escapeLike } from "./http-util";
import {
  inventoryOnce,
  reserveStock,
  releaseReservation,
  loanRows,
  reservationRows,
} from "./inventory-core";
import { z } from "zod";
import { audit } from "./audit";

const int = (v: unknown, fallback: number, max: number) =>
  Math.min(
    max,
    Math.max(0, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback),
  );
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 240) : "");
export function inventoryPage(query: Record<string, any>) {
  const conditions = [sql`${items.deletedAt} IS NULL`];
  const q = str(query.q).trim();
  if (q) {
    const location = sql`COALESCE(REPLACE(${items.area}, '_', ' '),'') || ' ' || CASE ${items.area} WHEN 'shipping_container_1' THEN 'electrical container' WHEN 'shipping_container_2' THEN 'plumbing container' ELSE '' END || ' rack ' || COALESCE(${items.rackLetter},'') || ' level ' || COALESCE(${items.rackLevel},'') || ' ' || COALESCE(${items.subLocation},'') || ' shelf ' || COALESCE(${items.shelf},'') || ' bin ' || COALESCE(${items.bin},'')`;
    for (const word of q.split(/\s+/).slice(0, 8)) {
      const pattern = `%${escapeLike(word)}%`;
      conditions.push(
        sql`(${items.name} LIKE ${pattern} ESCAPE '\\' OR ${items.partNumber} LIKE ${pattern} ESCAPE '\\' OR ${items.mfgPartNumber} LIKE ${pattern} ESCAPE '\\' OR ${location} LIKE ${pattern} ESCAPE '\\')`,
      );
    }
  }
  if (str(query.category)) conditions.push(eq(items.category, query.category));
  if (str(query.area)) conditions.push(eq(items.area, query.area));
  const available = sql`MAX(0,ROUND(${items.quantity}-${items.quantityReserved},4))`;
  const filter = query.lowStockOnly === "1" ? "low" : str(query.filter);
  if (filter === "low")
    conditions.push(
      sql`(${available} <= 0 OR (${items.lowStockThreshold}>0 AND ${available}<=${items.lowStockThreshold}))`,
    );
  if (filter === "out") conditions.push(sql`${available} <= 0`);
  if (filter === "loans")
    conditions.push(
      sql`EXISTS(SELECT 1 FROM inventory_loans l WHERE l.item_id=${items.id} AND l.quantity>l.returned_quantity)`,
    );
  const limit = Math.max(1, int(query.limit, 50, 100));
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(items)
    .where(and(...conditions))
    .get()!.n;
  const requestedPage = Math.max(1, int(query.page, 1, 1e7));
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / limit)));
  // Omit large photo arrays, custom attributes and notes from the list response.
  const { photos, customAttrs, notes, ...columns } = getTableColumns(items);
  const rows = db
    .select({
      ...columns,
      photoUrl: sql<string | null>`COALESCE(NULLIF(${items.photoUrl},''), CASE WHEN json_valid(${items.photos}) THEN (SELECT value FROM json_each(${items.photos}) WHERE type='text' AND value!='' LIMIT 1) END)`,
      available,
      onLoan: sql<number>`COALESCE((SELECT ROUND(SUM(l.quantity-l.returned_quantity),4) FROM inventory_loans l WHERE l.item_id=${items.id}),0)`,
    })
    .from(items)
    .where(and(...conditions))
    .orderBy(
      query.sort === "newest"
        ? desc(items.id)
        : sql`${items.name} COLLATE NOCASE ASC`,
      asc(items.id),
    )
    .limit(limit)
    .offset((page - 1) * limit)
    .all();
  return {
    items: rows,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function stockHistory(query: Record<string, any>) {
  const clauses: string[] = ["1=1"],
    args: any[] = [];
  if (str(query.q)) {
    const pattern = `%${escapeLike(str(query.q))}%`;
    clauses.push(
      "(i.name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR p.job_number LIKE ? ESCAPE '\\' OR h.notes LIKE ? ESCAPE '\\')",
    );
    args.push(pattern, pattern, pattern, pattern);
  }
  for (const [param, col] of [
    ["itemId", "h.item_id"],
    ["projectId", "h.project_id"],
  ])
    if (query[param]) {
      clauses.push(`${col}=?`);
      args.push(int(query[param], 0, 1e9));
    }
  if (["check_out", "check_in", "adjust"].includes(query.filter)) {
    clauses.push("h.kind=?");
    args.push(query.filter);
  }
  for (const [param, operator, end] of [
    ["from", ">=", false],
    ["to", "<=", true],
  ] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(str(query[param]))) {
      clauses.push(`h.at ${operator} ?`);
      args.push(
        new Date(
          `${query[param]}T${end ? "23:59:59.999" : "00:00:00"}`,
        ).getTime(),
      );
    }
  const union = `WITH h AS (
    SELECT id,item_id,user_id,project_id,type AS kind,CASE WHEN type='check_out' THEN -quantity ELSE quantity END AS delta,
      COALESCE(action,type) AS reason,notes,before_quantity,after_quantity,stock_unit,created_at AS at FROM transactions
    UNION ALL SELECT id,item_id,user_id,project_id,'adjust',delta,reason,notes,before_quantity,after_quantity,stock_unit,created_at FROM adjustments
  )`;
  const joined = `FROM h LEFT JOIN items i ON i.id=h.item_id LEFT JOIN users u ON u.id=h.user_id LEFT JOIN projects p ON p.id=h.project_id WHERE ${clauses.join(" AND ")}`;
  const total = (
    sqlite
      .prepare(`${union} SELECT count(*) AS n ${joined}`)
      .get(...args) as any
  ).n;
  const limit = Math.max(1, int(query.limit, 30, 100));
  const page = Math.min(
    Math.max(1, int(query.page, 1, 1e7)),
    Math.max(1, Math.ceil(total / limit)),
  );
  const rows = sqlite
    .prepare(
      `${union} SELECT h.id,h.kind,h.item_id AS itemId,i.name AS itemName,h.delta,h.reason,h.notes,u.name AS userName,
    h.project_id AS projectId,p.job_number AS jobNumber,h.before_quantity AS before,h.after_quantity AS after,COALESCE(h.stock_unit,i.unit,'each') AS unit,h.at
    ${joined} ORDER BY h.at DESC,h.kind,h.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, (page - 1) * limit);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
export function registerInventoryRoutes(app: Express) {
  app.get("/api/inventory/jobs", requireAuth, (req, res) => {
    const pattern = `%${escapeLike(str(req.query.q))}%`;
    res.json(
      sqlite
        .prepare(
          "SELECT id,job_number AS jobNumber,name,status FROM projects WHERE deleted_at IS NULL AND status!='done' AND (name LIKE ? ESCAPE '\\' OR job_number LIKE ? ESCAPE '\\') ORDER BY job_number LIMIT 30",
        )
        .all(pattern, pattern),
    );
  });
  app.get("/api/inventory/items", requireAuth, (req, res) =>
    res.json(inventoryPage(req.query)),
  );
  app.get("/api/inventory/history", requireAuth, (req, res) =>
    res.json(stockHistory(req.query)),
  );
  app.get("/api/inventory/map-items", requireAuth, (req, res) => {
    const conditions = [sql`${items.deletedAt} IS NULL`];
    if (str(req.query.area))
      conditions.push(eq(items.area, req.query.area as any));
    res.json(
      db
        .select({
          id: items.id,
          name: items.name,
          category: items.category,
          area: items.area,
          rackLetter: items.rackLetter,
          rackLevel: items.rackLevel,
          subLocation: items.subLocation,
          shelf: items.shelf,
          bin: items.bin,
          quantity: items.quantity,
          quantityReserved: items.quantityReserved,
          lowStockThreshold: items.lowStockThreshold,
          unit: items.unit,
        })
        .from(items)
        .where(and(...conditions))
        .all(),
    );
  });
  app.get("/api/inventory/duplicates", requireAuth, (req, res) => {
    const name = str(req.query.name).trim(),
      part = str(req.query.partNumber).trim();
    if (!name && !part) return res.json([]);
    res.json(
      db
        .select({
          id: items.id,
          name: items.name,
          area: items.area,
          rackLetter: items.rackLetter,
          unit: items.unit,
        })
        .from(items)
        .where(
          and(
            sql`${items.deletedAt} IS NULL`,
            sql`(${name} != '' AND LOWER(${items.name})=LOWER(${name}) OR ${part} != '' AND LOWER(${items.partNumber})=LOWER(${part}))`,
            sql`${items.id} != ${int(req.query.excludeId, 0, 1e9)}`,
          ),
        )
        .limit(8)
        .all(),
    );
  });
  app.get("/api/items/:id/availability", requireAuth, (req, res) => {
    const item = storage.getItemById(Number(req.params.id));
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json({
      reservations: reservationRows(sqlite, item.id),
      loans: loanRows(sqlite, item.id),
    });
  });
  app.post("/api/items/:id/reservations", requireElevated, (req, res) => {
    try {
      const data = z
        .object({
          projectId: z.number().int().positive(),
          quantity: z.number().positive(),
          requestKey: z.string().min(8).max(100),
        })
        .parse(req.body);
      const result = inventoryOnce(
        sqlite,
        req.user!.userId,
        data.requestKey,
        { action: "reserve", id: Number(req.params.id), ...data },
        () =>
          reserveStock(
            sqlite,
            Number(req.params.id),
            data.projectId,
            data.quantity,
          ),
      );
      audit(req, "inventory.reserve", {
        targetType: "item",
        targetId: Number(req.params.id),
        details: { projectId: data.projectId, quantity: data.quantity },
      });
      res.status(201).json({ id: result });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
  app.delete(
    "/api/items/:id/reservations/:reservationId",
    requireElevated,
    (req, res) => {
      const row = sqlite
        .prepare(
          "SELECT * FROM inventory_reservations WHERE id=? AND item_id=?",
        )
        .get(Number(req.params.reservationId), Number(req.params.id));
      if (!row)
        return res.status(404).json({ message: "Reservation not found" });
      releaseReservation(sqlite, Number(req.params.reservationId));
      res.json({ ok: true });
      audit(req, "inventory.release", {
        targetType: "item",
        targetId: Number(req.params.id),
        details: { reservationId: Number(req.params.reservationId) },
      });
    },
  );
  app.post("/api/items/:id/legacy-reservation", requireElevated, (req, res) => {
    try {
      const data = z
        .object({
          action: z.enum(["assign", "release"]),
          projectId: z.number().int().positive().optional(),
          quantity: z.number().finite().positive(),
          expectedVersion: z.number().int(),
          requestKey: z.string().min(8).max(100),
        })
        .parse(req.body);
      const id = Number(req.params.id);
      const result = inventoryOnce(
        sqlite,
        req.user!.userId,
        data.requestKey,
        { operation: "legacy-reservation", id, ...data },
        () => {
          const item = storage.getItemById(id);
          if (!item) throw new Error("Item not found.");
          if (item.stockVersion !== data.expectedVersion)
            throw new Error(
              "Stock changed. Reopen the reservation review and check again.",
            );
          const assigned = (
            sqlite
              .prepare(
                "SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_reservations WHERE item_id=?",
              )
              .get(id) as any
          ).n;
          if (
            data.quantity >
            Math.round((item.quantityReserved - assigned) * 10000) / 10000
          )
            throw new Error("That exceeds the unassigned reservation.");
          if (data.action === "assign") {
            if (
              !data.projectId ||
              !sqlite
                .prepare(
                  "SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND status!='done'",
                )
                .get(data.projectId)
            )
              throw new Error("Choose an open job.");
            sqlite
              .prepare(
                "INSERT INTO inventory_reservations(item_id,project_id,quantity) VALUES(?,?,?)",
              )
              .run(id, data.projectId, data.quantity);
            sqlite
              .prepare(
                "UPDATE items SET stock_version=stock_version+1 WHERE id=?",
              )
              .run(id);
          } else
            sqlite
              .prepare(
                "UPDATE items SET quantity_reserved=ROUND(quantity_reserved-?,4) WHERE id=?",
              )
              .run(data.quantity, id);
          return { ok: true };
        },
      );
      audit(req, "inventory.legacy_reservation_review", {
        targetType: "item",
        targetId: id,
        details: data,
      });
      res.json(result);
    } catch (e: any) {
      res.status(409).json({ message: e.message });
    }
  });
}
