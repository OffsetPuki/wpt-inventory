import type { Express, Request, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./storage";

// ─── Shared HTTP / route helpers ─────────────────────────────────────────────
// One home for the tiny request/formatting helpers that used to be copy-pasted
// into every route module, plus two registration helpers for the copy-pasted
// soft-delete and get-by-id route bodies. Every export here is behaviour-
// identical to the per-module copies it replaces.

/** Express types `req.params.*` as `string | string[]`; narrow to a number. */
export const pid = (v: string | string[]): number => parseInt(v as string, 10);

/** Express types `req.query.*` loosely; narrow to a non-empty string. */
export const qstr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

// Local calendar date "YYYY-MM-DD" — invoices/payroll/tasks/etc. are dated in
// the shop's wall-clock timezone, so comparing against UTC would flip the
// answer near midnight.
export function ymdLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today as a local "YYYY-MM-DD". */
export const todayLocal = (): string => ymdLocal(Date.now());

/**
 * Roles allowed to do "elevated" things: the owner. The legacy 'manager' and
 * 'technician' roles are still accepted — sessions persist in SQLite and
 * outstanding rows carry the old role strings until they expire (30 days).
 */
export function isElevated(req: Request): boolean {
  const role = req.user?.role;
  return role === "owner" || role === "manager" || role === "technician";
}
// hr.ts historically named this `elevatedRole` — same check, kept as an alias
// so its call sites can import it under the old name.
export const elevatedRole = isElevated;

/** Integer cents → "$x.xx". */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** Integer cents → whole dollars when clean ("$40"), cents otherwise ("$39.50"). */
export function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

// Escape LIKE metacharacters (\, %, _) in a user-supplied search term so they
// match literally instead of acting as wildcards. Backslash must be escaped
// first. Pair with `ESCAPE '\'` on every LIKE clause that uses the result.
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ─── Route-registration helpers ──────────────────────────────────────────────

type AuditFn = (
  req: Request,
  action: string,
  extras: {
    targetType?: string | null;
    targetId?: number | null;
    targetName?: string | null;
    details?: Record<string, unknown> | null;
  },
) => void;

// The copy-pasted soft-delete route body: load by id (excluding already-deleted
// rows) → 404 → stamp deletedAt → audit → { ok: true }. `audit` is passed in so
// each module keeps its own variant (socket-fallback `audit` vs quiet). Only
// used for routes whose bodies were byte-identical modulo these parameters.
export function registerSoftDelete(
  app: Express,
  path: string,
  middleware: RequestHandler,
  opts: {
    table: any;
    notFound: string;
    action: string;
    targetType: string;
    name: (row: any) => string | null;
    audit: AuditFn;
  },
): void {
  app.delete(path, middleware, (req, res) => {
    const id = pid(req.params.id);
    const row = db.select().from(opts.table)
      .where(and(eq(opts.table.id, id), isNull(opts.table.deletedAt)))
      .get();
    if (!row) return res.status(404).json({ message: opts.notFound });
    db.update(opts.table).set({ deletedAt: Date.now() }).where(eq(opts.table.id, id)).run();
    opts.audit(req, opts.action, {
      targetType: opts.targetType, targetId: id, targetName: opts.name(row),
    });
    res.json({ ok: true });
  });
}

// The copy-pasted create route body: schema.parse → insert → audit → 201 row,
// the whole thing in one try/catch → 400 (a constraint violation reads as a
// bad request, same as a parse failure). Only used for routes with no logic
// beyond the audit call — anything with derived columns, side effects or
// injected fields stays hand-written.
export function registerCreate(
  app: Express,
  path: string,
  middleware: RequestHandler,
  opts: {
    table: any;
    schema: { parse: (body: unknown) => any };
    action: string;
    targetType: string;
    name: (row: any) => string | null;
    details?: (row: any) => Record<string, unknown>;
    audit: AuditFn;
  },
): void {
  app.post(path, middleware, (req, res) => {
    try {
      const data = opts.schema.parse(req.body);
      const row = db.insert(opts.table).values(data).returning().get();
      opts.audit(req, opts.action, {
        targetType: opts.targetType, targetId: row.id, targetName: opts.name(row),
        details: opts.details?.(row) ?? null,
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
}

// The copy-pasted get-by-id route body: load by id (excluding already-deleted
// rows) → 404 → json(row). Only used for routes whose bodies were byte-
// identical modulo (table, notFound message, middleware).
export function registerGetById(
  app: Express,
  path: string,
  middleware: RequestHandler,
  table: any,
  notFound: string,
): void {
  app.get(path, middleware, (req, res) => {
    const row = db.select().from(table)
      .where(and(eq(table.id, pid(req.params.id)), isNull(table.deletedAt)))
      .get();
    if (!row) return res.status(404).json({ message: notFound });
    res.json(row);
  });
}
