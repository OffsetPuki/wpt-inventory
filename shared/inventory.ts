export const STOCK_UNITS = [
  "each",
  "stick",
  "sheet",
  "ft",
  "sq_ft",
  "bag",
  "box",
  "lb",
  "gal",
] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const UNIT_LABELS: Record<StockUnit, string> = {
  each: "pieces",
  stick: "sticks",
  sheet: "sheets",
  ft: "feet",
  sq_ft: "square feet",
  bag: "bags",
  box: "boxes",
  lb: "pounds",
  gal: "gallons",
};
export const fractionalUnit = (unit: string) =>
  ["ft", "sq_ft", "lb", "gal"].includes(unit);
export const stockRound = (n: number) =>
  Math.round((n + Number.EPSILON) * 10000) / 10000;
export const availableStock = (item: {
  quantity: number;
  quantityReserved?: number;
}) => Math.max(0, stockRound(item.quantity - (item.quantityReserved || 0)));
export const isTool = (item: { itemType?: string; category?: string }) =>
  item.itemType === "tool" ||
  (item.itemType === "stock" && item.category === "tools");
export function normalizeStockUnit(value: string | null | undefined): string {
  const s = String(value || "each")
    .trim()
    .toLowerCase();
  return (
    (
      {
        pcs: "each",
        pc: "each",
        piece: "each",
        pieces: "each",
        ea: "each",
        sticks: "stick",
        sheets: "sheet",
        feet: "ft",
        foot: "ft",
        lf: "ft",
        sqft: "sq_ft",
        sf: "sq_ft",
        "sq ft": "sq_ft",
        bags: "bag",
        boxes: "box",
        lbs: "lb",
        gallon: "gal",
        gallons: "gal",
      } as Record<string, string>
    )[s] || s
  );
}
export interface InventoryLoan {
  id: number;
  itemId: number;
  borrowerName: string;
  projectId: number | null;
  jobNumber: string | null;
  quantity: number;
  remaining: number;
  createdAt: number;
}
export interface InventoryReservation {
  id: number;
  projectId: number;
  jobNumber: string;
  projectName: string;
  quantity: number;
  checklistId: number | null;
}
export interface StockHistoryRow {
  id: number;
  kind: string;
  itemId: number;
  itemName: string;
  delta: number;
  reason: string;
  notes: string | null;
  userName: string;
  projectId: number | null;
  jobNumber: string | null;
  before: number | null;
  after: number | null;
  unit: string;
  at: number;
}
