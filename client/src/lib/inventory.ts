import type { QueryClient } from "@tanstack/react-query";
export {
  availableStock,
  isTool,
  fractionalUnit,
  UNIT_LABELS,
  STOCK_UNITS,
  stockRound,
} from "@shared/inventory";
export function invalidateInventory(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (q) =>
      [
        "items",
        "item",
        "item-detail",
        "inventory",
        "transactions",
        "adjustments",
        "checklist",
        "project-usage",
        "project",
        "projects",
        "stats",
        "dashboard",
        "dashboard-stats",
        "finance-pos",
        "finance-stats",
        "finance-expenses",
        "finance-reports",
        "dashboard-attention",
        "attention",
      ].includes(String(q.queryKey[0])),
  });
}
export function inventoryReturnPath() {
  try {
    const path = sessionStorage.getItem("cjm.inventory.return");
    return path?.startsWith("/home") ? path : "/home";
  } catch {
    return "/home";
  }
}
export const stockLabel = (quantity: number, unit: string) =>
  `${quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${unit.replace("sq_ft", "sq ft")}`;
