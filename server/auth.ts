import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";

// ─── Session config ──────────────────────────────────────────────────────────

// Sign in again after 12 hours, including sessions created before this limit.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
  if (row.expiresAt < Date.now() || row.createdAt + SESSION_TTL_MS < Date.now() || !storage.userCanSignIn(row.userId)) {
    storage.deleteSession(token);
    return null;
  }
  // Absolute lifetime also expires sessions created before the shorter limit.
  const user = storage.getUserById(row.userId)!;
  return { userId: user.id, role: user.role, name: user.name };
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
  const user = storage.getUserById(session.userId)!;
  if (process.env.NODE_ENV === "production" && user.role !== "worker" && user.credentialType !== "password"
    && !req.path.startsWith("/api/security/") && !["/api/auth/me","/api/auth/logout"].includes(req.path)) {
    res.status(428).json({message:"Set your owner password before using the suite.",securitySetupRequired:true}); return;
  }
  next();
}

// Elevated endpoints — the owner. Legacy 'manager'/'technician' roles are
// still accepted for older accounts. Roles are refreshed from the user record
// on every authenticated request.
export function requireElevated(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const role = req.user?.role;
    if (role !== "owner" && role !== "manager" && role !== "technician") {
      res.status(403).json({ message: "Owner access required" });
      return;
    }
    next();
  });
}
