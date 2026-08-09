import bcrypt from "bcryptjs";
import { storage, sqlite } from "./storage";
import { DEFAULT_CJM_EQUIPMENT_PRESETS } from "../shared/cjm-presets";

const BCRYPT_ROUNDS = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$/;

function randomPin(): string {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

/**
 * One-time silent migration: existing installs stored PINs as plaintext. Hash
 * any user whose `pin` doesn't look like a bcrypt digest. Login then works
 * unchanged — the user types their PIN, we bcrypt.compare against the hash.
 */
function migratePlaintextPins(): void {
  const all = storage.getAllUsersWithPin();
  let migrated = 0;
  for (const u of all) {
    if (!BCRYPT_PREFIX.test(u.pin)) {
      storage.setUserPin(u.id, bcrypt.hashSync(u.pin, BCRYPT_ROUNDS));
      migrated++;
    }
  }
  if (migrated > 0) console.log(`[seed] Hashed ${migrated} plaintext PIN(s)`);
}

/**
 * Seed default data on first run.
 * Only inserts if the corresponding table is empty, so manager edits are never clobbered.
 */
export function seedDefaults(): void {
  // ── Role collapse (Package E) ──────────────────────────────────────────
  // manager/technician → owner. The 3-role split only hid screens from the
  // solo owner. Idempotent; outstanding sessions keep their old role string
  // until expiry (requireElevated tolerates the legacy names).
  try {
    const r = sqlite.prepare(
      "UPDATE users SET role = 'owner' WHERE role IN ('manager', 'technician')",
    ).run();
    if (r.changes > 0) console.log(`[seed] Collapsed ${r.changes} manager/technician user(s) to owner`);
  } catch (e) {
    console.error("[seed] role collapse failed", e);
  }

  // ── Users ──────────────────────────────────────────────────────────────
  if (storage.getUserCount() === 0) {
    // In production, seed with a random PIN and log it ONCE so the operator
    // can sign in — never bake the publicly-known dev default into prod.
    const isProd = process.env.NODE_ENV === "production";
    const ownerPin = isProd ? randomPin() : "1234";
    console.log("[seed] Creating default Owner user");
    storage.createUser({
      name: "Owner",
      pin: bcrypt.hashSync(ownerPin, BCRYPT_ROUNDS),
      role: "owner",
    });
    if (isProd) {
      console.log("[seed] ────────────────────────────────────────────────");
      console.log("[seed]  First-run credentials — SAVE THESE NOW:");
      console.log(`[seed]    Owner / ${ownerPin}`);
      console.log("[seed] ────────────────────────────────────────────────");
    }
  } else {
    migratePlaintextPins();
    const cleaned = storage.stripTemplateAuditFromProjectNotes();
    if (cleaned > 0) console.log(`[seed] Cleaned template/params block from ${cleaned} project(s)`);
  }

  // ── Settings ───────────────────────────────────────────────────────────
  storage.getSettings(); // creates singleton row if missing

  // ── Map Layouts ────────────────────────────────────────────────────────
  // One default floor for fresh installs; more are added from the Map page.
  // Key-idempotent, so existing DBs (whatever floors they carry) are never
  // touched. (The old six-layout seed was the PREVIOUS business's floor plan.)
  if (!storage.getMapLayoutByKey("main_shop")) {
    console.log("[seed] Creating map layout: main_shop");
    storage.createMapLayout({ key: "main_shop", label: "Main Shop", area: "main_shop", orderIndex: 0, nodes: [] });
  }

  // ── CJM Metals seeds ───────────────────────────────────────────────────
  // Key-idempotent (not count-gated): existing installs still gain the
  // metalwork presets on upgrade, and owner edits are never overwritten.
  // (Job templates are owned by server/template-catalog.ts, synced at boot.)
  let cjmAdded = 0;
  DEFAULT_CJM_EQUIPMENT_PRESETS.forEach((preset, idx) => {
    if (storage.getPresetByKey(preset.key)) return;
    storage.createPreset({
      key: preset.key,
      label: preset.label,
      blurb: preset.blurb,
      icon: preset.icon,
      defaultCategory: preset.defaultCategory,
      examples: preset.examples,
      customFields: preset.customFields,
      orderIndex: 100 + idx, // after whatever is already there
      enabled: true,
    });
    cjmAdded++;
  });
  if (cjmAdded > 0) console.log(`[seed] Added ${cjmAdded} CJM metalwork preset(s)`);

  console.log("[seed] Defaults verified");
}
