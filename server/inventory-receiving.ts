import { receiveStockCost } from './stock-cost';
import type { Express } from "express";
import { z } from "zod";
import { sqlite } from "./storage";
import { requireElevated } from "./auth";
import {
  activeItem,
  inventoryOnce,
  validateQuantity,
  adjustStock,
} from "./inventory-core";
import { normalizeStockUnit, stockRound } from "../shared/inventory";
import { parseLineItems } from "../shared/biz-common";
import { insertNumbered } from "./numbering";
import { db } from "./storage";
import { purchaseOrders } from "../shared/finance-schema";

const receiptSchema = z.object({
  requestKey: z.string().min(8).max(100),
  lines: z
    .array(
      z.object({
        lineIndex: z.number().int().nonnegative(),
        quantity: z.number().positive().finite(),
        itemId: z.number().int().positive().nullable(),
        stockQuantity: z.number().nonnegative().finite(),
        conversionNote: z.string().max(240).optional(),
      }),
    )
    .min(1)
    .max(200),
});
function getPo(id: number): any {
  const po = sqlite
    .prepare(
      "SELECT * FROM fin_purchase_orders WHERE id=? AND deleted_at IS NULL",
    )
    .get(id);
  if (!po) throw new Error("Purchase order not found.");
  return po;
}
export function poReceiving(id: number) {
  const po = getPo(id);
  return {
    id,
    number: po.number,
    status: po.status,
    lines: parseLineItems(po.items).map((line, index) => {
      const received = (
        sqlite
          .prepare(
            "SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_receipts WHERE po_id=? AND line_index=?",
          )
          .get(id, index) as any
      ).n;
      const matches = (line as any).inventoryItemId
        ? sqlite
            .prepare(
              "SELECT id,name,unit,area,rack_letter AS rackLetter,shelf,bin FROM items WHERE id=? AND deleted_at IS NULL",
            )
            .all((line as any).inventoryItemId)
        : line.materialKey
          ? sqlite
              .prepare(
                "SELECT id,name,unit,area,rack_letter AS rackLetter,shelf,bin FROM items WHERE material_key=? AND deleted_at IS NULL LIMIT 20",
              )
              .all(line.materialKey)
          : [];
      return {
        ...line,
        lineIndex: index,
        received,
        remaining:
          po.status === "received" ? 0 : stockRound(line.qty - received),
        matches,
      };
    }),
  };
}
export function receivePo(id: number, userId: number, raw: unknown) {
  const input = receiptSchema.parse(raw);
  return inventoryOnce(
    sqlite,
    userId,
    input.requestKey,
    { action: "receive-po", id, ...input },
    () => {
      const po = getPo(id);
      if (po.status !== "open")
        throw new Error("This purchase order is no longer open.");
      const lines = parseLineItems(po.items);
      const priorReceipts = sqlite
        .prepare(
          "SELECT line_index,SUM(quantity) AS qty FROM inventory_receipts WHERE po_id=? GROUP BY line_index",
        )
        .all(id) as any[];
      const expectedPriorExpense = priorReceipts.reduce(
        (sum, row) =>
          sum + Math.round(row.qty * lines[row.line_index].unitPriceCents),
        0,
      );
      const expenseLink = sqlite
        .prepare("SELECT expense_id FROM inventory_po_expenses WHERE po_id=?")
        .get(id) as any;
      const linkedExpense = expenseLink
        ? (sqlite
            .prepare(
              "SELECT id,amount_cents,deleted_at FROM fin_expenses WHERE id=?",
            )
            .get(expenseLink.expense_id) as any)
        : null;
      if (
        expenseLink &&
        (!linkedExpense ||
          linkedExpense.deleted_at != null ||
          linkedExpense.amount_cents !== expectedPriorExpense)
      )
        throw new Error(
          "The expense for an earlier delivery was changed or deleted. Review and restore its received amount before recording another delivery.",
        );
      const seen = new Set<number>();
      for (const receipt of input.lines) {
        if (seen.has(receipt.lineIndex))
          throw new Error("Receive each order line only once per delivery.");
        seen.add(receipt.lineIndex);
        const line = lines[receipt.lineIndex];
        if (!line) throw new Error("Order line not found.");
        const received = (
          sqlite
            .prepare(
              "SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_receipts WHERE po_id=? AND line_index=?",
            )
            .get(id, receipt.lineIndex) as any
        ).n;
        if (stockRound(received + receipt.quantity) > line.qty)
          throw new Error(
            `Only ${stockRound(line.qty - received)} remains to receive for ${line.description}.`,
          );
        if (stockRound(receipt.quantity) !== receipt.quantity)
          throw new Error("Use up to four decimal places.");
        if (receipt.itemId) {
          const item = activeItem(sqlite, receipt.itemId);
          validateQuantity(receipt.stockQuantity, item.unit);
          const sameUnit = normalizeStockUnit(line.unit) === item.unit;
          if (sameUnit && receipt.stockQuantity !== receipt.quantity)
            throw new Error(
              "The purchase and stock units match; received quantities must match too.",
            );
          if (!sameUnit && !receipt.conversionNote?.trim())
            throw new Error(
              "Describe the conversion from purchase units to stock units.",
            );
          adjustStock(sqlite, item.id, userId, {
            delta: receipt.stockQuantity,
            reason: "purchased",
            projectId: po.project_id,
            notes: `${po.number}: ${receipt.quantity} ${line.unit || "each"} received${receipt.conversionNote ? "; " + receipt.conversionNote : ""}`,
          });
          const cost = Math.max(
            0,
            Math.round(
              (receipt.quantity * line.unitPriceCents) / receipt.stockQuantity,
            ),
          );
          sqlite
            .prepare(
              "UPDATE items SET supplier=?,last_cost_cents=?,detail_version=detail_version+1 WHERE id=?",
            )
            .run(po.vendor, cost, item.id);
        } else if (receipt.stockQuantity !== 0)
          throw new Error("Select the destination inventory item.");
        const receivedRow=sqlite
          .prepare(
            "INSERT INTO inventory_receipts(po_id,line_index,quantity,item_id,stock_quantity,user_id) VALUES(?,?,?,?,?,?)",
          )
          .run(
            id,
            receipt.lineIndex,
            receipt.quantity,
            receipt.itemId,
            receipt.stockQuantity,
            userId,
          );
        if(receipt.itemId)receiveStockCost(sqlite,Number(receivedRow.lastInsertRowid),receipt.itemId,receipt.stockQuantity,Math.max(0,receipt.quantity*line.unitPriceCents),po.vendor);
      }
      const totals = sqlite
        .prepare(
          "SELECT line_index,SUM(quantity) AS qty FROM inventory_receipts WHERE po_id=? GROUP BY line_index",
        )
        .all(id) as any[];
      const receivedByLine = new Map<number, number>(
        totals.map((r) => [r.line_index, r.qty]),
      );
      const expenseCents = lines.reduce(
        (sum, line, index) =>
          sum +
          Math.round((receivedByLine.get(index) || 0) * line.unitPriceCents),
        0,
      );
      if (expenseCents < 0)
        throw new Error(
          "Receive discount lines together with the items they discount.",
        );
      const expense = linkedExpense;
      if (expense)
        sqlite
          .prepare("UPDATE fin_expenses SET amount_cents=? WHERE id=?")
          .run(expenseCents, expense.id);
      else if (expenseCents > 0) {
        const insertedExpense = sqlite
          .prepare(
            "INSERT INTO fin_expenses(date,vendor,category,amount_cents,payment_method,project_id,billable,notes) VALUES(date('now','localtime'),?,'materials',?,'other',?,0,?)",
          )
          .run(
            po.vendor,
            expenseCents,
            po.project_id,
            `auto:po:${id}; — ${po.number} received`,
          );
        sqlite
          .prepare(
            "INSERT INTO inventory_po_expenses(po_id,expense_id) VALUES(?,?)",
          )
          .run(id, Number(insertedExpense.lastInsertRowid));
      }
      const complete = lines.every(
        (line, index) => stockRound(receivedByLine.get(index) || 0) >= line.qty,
      );
      if (complete)
        sqlite
          .prepare(
            "UPDATE fin_purchase_orders SET status='received' WHERE id=?",
          )
          .run(id);
      return {
        ok: true,
        status: complete ? "received" : "open",
        partial: !complete,
      };
    },
  );
}
// Compatibility for older clients: only unambiguous, same-unit material links
// may auto-receive. The new dialog handles partial deliveries and conversions.
export function receivePoRemaining(id: number, userId: number) {
  const detail = poReceiving(id);
  const lines = detail.lines
    .filter((l) => l.remaining > 0)
    .map((l) => {
      const matches = l.matches as any[];
      if (
        (l.materialKey || (l as any).inventoryItemId) &&
        (matches.length !== 1 || matches[0].unit !== normalizeStockUnit(l.unit))
      )
        throw new Error(
          "Open Receive delivery to choose the inventory destination and confirm units.",
        );
      const item = matches[0];
      return {
        lineIndex: l.lineIndex,
        quantity: l.remaining,
        itemId: item?.id ?? null,
        stockQuantity: item ? l.remaining : 0,
      };
    });
  return receivePo(id, userId, { requestKey: `receive-all-${id}`, lines });
}
export function registerReceivingRoutes(app: Express) {
  app.get(
    "/api/finance/purchase-orders/:id/receiving",
    requireElevated,
    (req, res) => {
      try {
        res.json(poReceiving(Number(req.params.id)));
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    },
  );
  app.post(
    "/api/finance/purchase-orders/:id/receive",
    requireElevated,
    (req, res) => {
      try {
        res.json(receivePo(Number(req.params.id), req.user!.userId, req.body));
      } catch (e: any) {
        res.status(409).json({ message: e.message });
      }
    },
  );
  app.post("/api/inventory/restock", requireElevated, (req, res) => {
    try {
      const input = z
        .object({
          requestKey: z.string().min(8).max(100),
          vendor: z.string().trim().min(1).max(200),
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
      const result = inventoryOnce(
        sqlite,
        req.user!.userId,
        input.requestKey,
        { action: "restock", ...input },
        () => {
          const lines = input.lines.map((l) => {
            const item = activeItem(sqlite, l.itemId);
            validateQuantity(l.quantity, item.unit);
            return {
              description: item.name,
              qty: l.quantity,
              unit: item.unit,
              unitPriceCents: l.unitCostCents,
              inventoryItemId: item.id,
              ...(item.material_key ? { materialKey: item.material_key } : {}),
            };
          });
          return insertNumbered("fin_purchase_orders", "PO", (number) =>
            db
              .insert(purchaseOrders)
              .values({
                number,
                vendor: input.vendor,
                status: "open",
                items: JSON.stringify(lines),
                totalCents: lines.reduce(
                  (n, l) => n + Math.round(l.qty * l.unitPriceCents),
                  0,
                ),
                notes: "Inventory restock",
              })
              .returning()
              .get(),
          );
        },
      );
      res.status(201).json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
}
