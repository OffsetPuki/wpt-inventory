import type { Request } from "express";
import { storage } from "./storage";

// ─── Shared audit-log helpers ────────────────────────────────────────────────
// One home for the fire-and-forget audit writer that used to be copy-pasted
// into every route module. Imports nothing but storage — safe to import from
// anywhere without cycles.

// Express's req.ip falls back to the socket address. Behind a proxy
// (Railway / nginx), trust-proxy must be enabled in index.ts so this is
// the real client IP, not the proxy's.
export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "?") as string;
}

type AuditExtras = {
  targetType?: string | null;
  targetId?: number | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
};

// Snapshot the request-derived fields synchronously — req may be recycled by
// the time setImmediate fires — then defer the actual DB insert off the
// response path. Audit is a forensic, best-effort log: shaving the INSERT
// off the request latency is worth the (vanishingly small) risk that a
// hard process crash between response and write loses one entry.
function buildEntry(req: Request, action: string, extras: AuditExtras, ip: string | null) {
  return {
    userId: req.user?.userId ?? null,
    userName: req.user?.name ?? null,
    role: req.user?.role ?? null,
    action,
    targetType: extras.targetType ?? null,
    targetId: extras.targetId ?? null,
    targetName: extras.targetName ?? null,
    ip,
    details: extras.details ?? null,
  };
}

// Variant used by routes.ts / crm.ts / quotes.ts: socket-fallback IP, logs
// write failures.
export function audit(req: Request, action: string, extras: AuditExtras = {}): void {
  const entry = buildEntry(req, action, extras, clientIp(req));
  setImmediate(() => {
    try {
      storage.appendAudit(entry);
    } catch (e) {
      console.error("[audit] failed to write entry", e);
    }
  });
}

// Variant used by pm.ts / hr.ts / finance.ts: ip from req.ip alone (null when
// absent, no socket fallback), write failures swallowed. Kept as-is so the
// consolidation is behavior-identical to the copies it replaced.
export function auditQuiet(req: Request, action: string, extras: AuditExtras = {}): void {
  const entry = buildEntry(req, action, extras, req.ip ?? null);
  setImmediate(() => {
    try {
      storage.appendAudit(entry);
    } catch {}
  });
}
