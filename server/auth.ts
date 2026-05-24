import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── In-memory session store ─────────────────────────────────────────────────

interface SessionData {
  userId: number;
  role: string;
  name: string;
}

const sessions = new Map<string, SessionData>();

export function createSession(userId: number, role: string, name: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, role, name });
  return token;
}

export function getSession(token: string): SessionData | null {
  return sessions.get(token) ?? null;
}

export function destroySession(token: string): void {
  sessions.delete(token);
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

export function requireManager(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "manager") {
      res.status(403).json({ message: "Manager access required" });
      return;
    }
    next();
  });
}
