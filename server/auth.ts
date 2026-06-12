import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";

// ─── Session config ──────────────────────────────────────────────────────────

// 30-day sliding TTL: every authenticated request bumps the expiry, so a token
// that's actively used keeps working; a token that's idle for 30 days expires
// and the user has to sign in again.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionData {
  userId: number;
  role: string;
  name: string;
}

// ─── Session API (persisted to SQLite) ───────────────────────────────────────

export function createSession(userId: number, role: string, name: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  storage.insertSession(token, userId, role, name, expiresAt);
  return token;
}

export function getSession(token: string): SessionData | null {
  const row = storage.getSession(token);
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    storage.deleteSession(token);
    return null;
  }
  // Sliding TTL — bump expiry so an active session never abruptly times out.
  storage.touchSession(token, Date.now() + SESSION_TTL_MS);
  return { userId: row.userId, role: row.role, name: row.name };
}

export function destroySession(token: string): void {
  storage.deleteSession(token);
}

// Hard-purge soft-deleted items / projects after this long. 30 days gives
// enough runway for "oops, I deleted the wrong thing yesterday" without
// letting the trash grow forever.
const SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Run hourly to drop expired rows (sessions, stale lockout entries) and
// hard-purge soft-deleted items/projects past retention.
export function startSessionReaper(): void {
  const tick = () => {
    const now = Date.now();
    storage.purgeExpiredSessions(now);
    storage.purgeStaleLoginAttempts(now);
    const cutoff = now - SOFT_DELETE_RETENTION_MS;
    const purgedItems = storage.purgeOldDeletedItems(cutoff);
    const purgedProjects = storage.purgeOldDeletedProjects(cutoff);
    if (purgedItems || purgedProjects) {
      console.log(`[reaper] Hard-purged ${purgedItems} item(s), ${purgedProjects} project(s) past 30-day retention`);
    }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}

// ─── Express request extension ───────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: SessionData & { token: string };
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-auth"] as string | undefined;
  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const session = getSession(token);
  if (!session) {
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }
  req.user = { ...session, token };
  next();
}

// Technical/operational endpoints — only technicians get through.
// (Item edit/delete, stock adjustments, map layouts, settings, templates.)
export function requireTechnician(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "technician") {
      res.status(403).json({ message: "Technician access required" });
      return;
    }
    next();
  });
}

// Managerial endpoints — manager OR technician. Used for things both should
// be able to do (dashboard stats, user CRUD, project CRUD, AI identify).
export function requireElevated(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const role = req.user?.role;
    if (role !== "manager" && role !== "technician") {
      res.status(403).json({ message: "Manager or technician access required" });
      return;
    }
    next();
  });
}
