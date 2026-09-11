import { setMediaCookie } from "./media";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { sqlite, storage, toPublicUser } from "./storage";
import { requireAuth, createSession, getSession } from "./auth";
import { auditQuiet as audit } from "./audit";

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false });
export function strongPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && Buffer.byteLength(value, "utf8") <= 72;
}

export function registerSecurityRoutes(app: Express) {
  app.post("/api/security/password", limiter, requireAuth, async (req, res, next) => {
    try {
      const user = storage.getUserById(req.user!.userId)!;
      const currentPassword = req.body?.currentPassword;
      if (typeof currentPassword !== "string" || currentPassword.length > 128
        || !(await bcrypt.compare(currentPassword, user.pin))) {
        return res.status(403).json({ message: "Check your current password or PIN." });
      }
      if (!strongPassword(req.body?.password)) {
        return res.status(400).json({ message: "Use at least 12 characters (at most 72 UTF-8 bytes) for your password." });
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      const session = sqlite.transaction(() => {
        const current = storage.getUserById(user.id);
        // Recheck after hashing so a simultaneous reset or deactivation wins
        // over a request using an old password or a revoked session.
        if (!current || current.pin !== user.pin || !getSession(req.user!.token)) return null;
        sqlite.prepare("UPDATE users SET pin=?,credential_type='password',totp_secret=NULL WHERE id=?").run(hash, user.id);
        sqlite.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        return createSession(current.id, current.role, current.name);
      })();
      if (!session) return res.status(409).json({ message: "Your account changed. Sign in again before updating your password." });
      audit(req, "auth.password_changed", { targetType: "user", targetId: user.id });
      res.setHeader("Cache-Control", "no-store");
      setMediaCookie(req, res, session);
      res.json({ token: session, user: toPublicUser(storage.getUserById(user.id)!) });
    } catch (error) { next(error); }
  });
  // Already-open old clients receive a clear upgrade path.
  app.post(["/api/security/enroll", "/api/security/complete"], requireAuth, (_req, res) => {
    res.status(410).json({ message: "Authenticator setup has been removed. Reload the suite to update your password." });
  });
  app.get("/api/security/sessions", requireAuth, (req, res) => {
    res.json(sqlite.prepare("SELECT substr(token,1,12) AS id,created_at,expires_at FROM sessions WHERE user_id=? ORDER BY created_at DESC").all(req.user!.userId));
  });
  app.post("/api/security/revoke-sessions", requireAuth, (req, res) => {
    sqlite.prepare("DELETE FROM sessions WHERE user_id=? AND token != ?").run(req.user!.userId, req.user!.token);
    audit(req, "auth.other_sessions_revoked");
    res.json({ ok: true });
  });
}
