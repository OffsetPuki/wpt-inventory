import { sqlite } from "./storage";

export function insertNumbered<T>(
  table: string,
  prefix: string,
  doInsert: (num: string) => T,
  opts: { seed?: () => number; attempts?: number } = {},
): T {
  const base = opts.seed
    ? opts.seed()
    : (
        sqlite
          .prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`)
          .get() as { m: number }
      ).m + 1;
  const year = new Date().getFullYear();
  const attempts = opts.attempts ?? 25;
  for (let i = 0; i < attempts; i++) {
    const num = `${prefix}-${year}-${String(base + i).padStart(4, "0")}`;
    try {
      return doInsert(num);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("UNIQUE")) continue;
      throw e;
    }
  }
  throw new Error(`Could not allocate a unique ${prefix} number`);
}
