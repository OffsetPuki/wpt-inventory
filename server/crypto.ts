import crypto from "crypto";
import fs from "fs";
import path from "path";

// ─── At-rest secret encryption (AES-256-GCM) ─────────────────────────────────
// Used to encrypt QuickBooks OAuth tokens + realm id before they're written to
// SQLite. Intuit's security requirements call for refresh tokens and the realm
// id to be encrypted at rest, not stored in plaintext.
//
// Key resolution, in order:
//   1. QB_ENCRYPTION_KEY / DATA_ENCRYPTION_KEY env var (32-byte hex or base64,
//      or any passphrase — derived via scrypt). Best for production.
//   2. A random key auto-generated and persisted to data/.secret-key (0600).
//      Keeps it working out of the box for self-hosted installs; a warning
//      nudges operators toward the env var.

const PREFIX = "enc:v1:";

function loadKey(): Buffer {
  const env = process.env.QB_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY;
  if (env) {
    if (/^[0-9a-fA-F]{64}$/.test(env)) return Buffer.from(env, "hex");
    const b64 = Buffer.from(env, "base64");
    if (b64.length === 32) return b64;
    // Any other passphrase → derive a 32-byte key deterministically.
    return crypto.scryptSync(env, "wpt-inventory-secret-key", 32);
  }

  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), "data");
  const keyPath = path.join(dataDir, ".secret-key");
  try {
    if (fs.existsSync(keyPath)) {
      const k = fs.readFileSync(keyPath);
      if (k.length === 32) return k;
    }
  } catch {
    /* fall through to regenerate */
  }
  const key = crypto.randomBytes(32);
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    console.warn(
      "[crypto] Generated a local encryption key at data/.secret-key. " +
        "For production, set QB_ENCRYPTION_KEY in the environment instead so the " +
        "key lives outside the data directory."
    );
  } catch (e) {
    console.error("[crypto] Could not persist encryption key — encrypted secrets won't survive a restart", e);
  }
  return key;
}

let KEY: Buffer | null = null;
function key(): Buffer {
  if (!KEY) KEY = loadKey();
  return KEY;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

// Tolerant of legacy plaintext: a value without the version prefix is returned
// as-is, so a pre-encryption row keeps working and gets encrypted on next save.
export function decryptSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    console.error("[crypto] Failed to decrypt a stored secret (wrong or rotated key?)", e);
    return "";
  }
}
