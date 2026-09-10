import { setMediaCookie } from "./media";
import type { Express } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import rateLimit from "express-rate-limit";
import { sqlite, storage, toPublicUser } from "./storage";
import { requireAuth, createSession } from "./auth";
import { auditQuiet as audit } from "./audit";

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS auth_enrollment (user_id INTEGER PRIMARY KEY, secret TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS auth_totp_used (user_id INTEGER NOT NULL, counter INTEGER NOT NULL, PRIMARY KEY(user_id,counter));
  CREATE TABLE IF NOT EXISTS auth_recovery_codes (user_id INTEGER NOT NULL, code_hash TEXT NOT NULL, PRIMARY KEY(user_id,code_hash));
`);
const limiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
});
const recoveryHash = (id: number, code: string) =>
  crypto
    .createHash("sha256")
    .update(`${id}:${code.trim().toLowerCase()}`)
    .digest("hex");
export function strongPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    Buffer.byteLength(value, "utf8") <= 72
  );
}
export function verifySecondFactor(
  userId: number,
  secret: string | null,
  token: string | undefined,
): boolean {
  if (!secret) return true;
  if (!token) return false;
  if (!/^\d{6}$/.test(token)) {
    return (
      sqlite
        .prepare(
          "DELETE FROM auth_recovery_codes WHERE user_id=? AND code_hash=?",
        )
        .run(userId, recoveryHash(userId, token)).changes === 1
    );
  }
  const delta = new TOTP({ secret, digits: 6, period: 30 }).validate({
    token,
    window: 1,
  });
  if (delta == null) return false;
  const counter = Math.floor(Date.now() / 30_000) + delta;
  sqlite
    .prepare("DELETE FROM auth_totp_used WHERE counter < ?")
    .run(counter - 3);
  return (
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO auth_totp_used (user_id,counter) VALUES (?,?)",
      )
      .run(userId, counter).changes === 1
  );
}

export function registerSecurityRoutes(app: Express) {
  app.post(
    "/api/security/enroll",
    limiter,
    requireAuth,
    async (req, res, next) => {
      try {
        const user = storage.getUserById(req.user!.userId)!;
        if (
          !(await bcrypt.compare(
            String(req.body?.currentPassword ?? ""),
            user.pin,
          )) ||
          !verifySecondFactor(user.id, user.totpSecret, req.body?.otp)
        )
          return res
            .status(403)
            .json({
              message:
                "Confirm your current password/PIN and, if enabled, authenticator code.",
            });
        const secret = new Secret({ size: 20 });
        const totp = new TOTP({
          issuer: "CJM Trades",
          label: user.name,
          secret,
          period: 30,
          digits: 6,
        });
        sqlite
          .prepare(
            "INSERT INTO auth_enrollment (user_id,secret,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at",
          )
          .run(user.id, secret.base32, Date.now() + 10 * 60_000);
        res.setHeader("Cache-Control", "no-store");
        res.json({
          secret: secret.base32,
          qr: await QRCode.toDataURL(totp.toString()),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/security/complete",
    limiter,
    requireAuth,
    async (req, res, next) => {
      try {
        const user = storage.getUserById(req.user!.userId)!;
        const pending = sqlite
          .prepare("SELECT * FROM auth_enrollment WHERE user_id=?")
          .get(user.id) as any;
        if (!pending || pending.expires_at < Date.now())
          return res
            .status(409)
            .json({ message: "Setup expired. Start again." });
        if (!strongPassword(req.body?.password))
          return res
            .status(400)
            .json({
              message:
                "Use at least 12 characters (at most 72 UTF-8 bytes) for your password.",
            });
        const token = String(req.body?.otp ?? "");
        if (
          !/^\d{6}$/.test(token) ||
          new TOTP({ secret: pending.secret }).validate({ token, window: 1 }) ==
            null
        )
          return res
            .status(400)
            .json({
              message:
                "Enter the current six-digit code from your authenticator.",
            });
        const hash = await bcrypt.hash(req.body.password, 12);
        const codes = Array.from({ length: 10 }, () =>
          crypto
            .randomBytes(12)
            .toString("hex")
            .match(/.{1,4}/g)!
            .join("-"),
        );
        const session = sqlite.transaction(() => {
          const current = sqlite
            .prepare(
              "SELECT secret,expires_at FROM auth_enrollment WHERE user_id=?",
            )
            .get(user.id) as any;
          if (
            !current ||
            current.secret !== pending.secret ||
            current.expires_at < Date.now() ||
            !storage.userCanSignIn(user.id)
          )
            throw new Error("Setup expired. Sign in and try again.");
          sqlite
            .prepare(
              "UPDATE users SET pin=?,credential_type='password',totp_secret=? WHERE id=?",
            )
            .run(hash, pending.secret, user.id);
          sqlite.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
          sqlite
            .prepare("DELETE FROM auth_enrollment WHERE user_id=?")
            .run(user.id);
          sqlite
            .prepare("DELETE FROM auth_recovery_codes WHERE user_id=?")
            .run(user.id);
          sqlite
            .prepare("DELETE FROM auth_totp_used WHERE user_id=?")
            .run(user.id);
          for (const code of codes)
            sqlite
              .prepare(
                "INSERT INTO auth_recovery_codes (user_id,code_hash) VALUES (?,?)",
              )
              .run(user.id, recoveryHash(user.id, code));
          verifySecondFactor(user.id, pending.secret, token);
          return createSession(user.id, user.role, user.name);
        })();
        audit(req, "auth.security_enrolled", {
          targetType: "user",
          targetId: user.id,
        });
        res.setHeader("Cache-Control", "no-store");
        setMediaCookie(req, res, session);
        res.json({
          token: session,
          user: toPublicUser(storage.getUserById(user.id)!),
          recoveryCodes: codes,
        });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/api/security/sessions", requireAuth, (req, res) => {
    res.json(
      sqlite
        .prepare(
          "SELECT substr(token,1,12) AS id,created_at,expires_at FROM sessions WHERE user_id=? ORDER BY created_at DESC",
        )
        .all(req.user!.userId),
    );
  });
  app.post("/api/security/revoke-sessions", requireAuth, (req, res) => {
    sqlite
      .prepare("DELETE FROM sessions WHERE user_id=? AND token != ?")
      .run(req.user!.userId, req.user!.token);
    audit(req, "auth.other_sessions_revoked");
    res.json({ ok: true });
  });
}
