import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { DEFAULT_EQUIPMENT_PRESETS, DEFAULT_JOB_TEMPLATES } from "../shared/wpt-presets";

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
  // ── Users ──────────────────────────────────────────────────────────────
  if (storage.getUserCount() === 0) {
    // In production, seed with random PINs and log them ONCE so the operator
    // can sign in — never bake the publicly-known dev defaults into prod.
    const isProd = process.env.NODE_ENV === "production";
    const managerPin = isProd ? randomPin() : "1234";
    const workerPin = isProd ? randomPin() : "0000";
    console.log("[seed] Creating default Manager user");
    storage.createUser({
      name: "Manager",
      pin: bcrypt.hashSync(managerPin, BCRYPT_ROUNDS),
      role: "manager",
    });
    console.log("[seed] Creating default Worker user");
    storage.createUser({
      name: "Worker",
      pin: bcrypt.hashSync(workerPin, BCRYPT_ROUNDS),
      role: "worker",
    });
    if (isProd) {
      console.log("[seed] ────────────────────────────────────────────────");
      console.log("[seed]  First-run credentials — SAVE THESE NOW:");
      console.log(`[seed]    Manager / ${managerPin}`);
      console.log(`[seed]    Worker  / ${workerPin}`);
      console.log("[seed] ────────────────────────────────────────────────");
    }
  } else {
    migratePlaintextPins();
  }

  // ── Settings ───────────────────────────────────────────────────────────
  storage.getSettings(); // creates singleton row if missing

  // ── Map Layouts ────────────────────────────────────────────────────────
  // Idempotent: ensure a layout exists for each area, creating only the missing
  // ones so new areas appear on restart without clobbering manager edits.
  const desiredLayouts: { key: string; label: string; area: string }[] = [
    { key: "main_shop", label: "Main Shop", area: "main_shop" },
    { key: "machine_shop", label: "Machine Shop", area: "machine_shop" },
    { key: "panel_shop", label: "Panel Shop", area: "panel_shop" },
    { key: "concrete_pad", label: "Concrete Pad", area: "concrete_pad" },
    { key: "shipping_container_1", label: "Electrical Container", area: "shipping_container_1" },
    { key: "shipping_container_2", label: "Plumbing Container", area: "shipping_container_2" },
  ];
  desiredLayouts.forEach((l, idx) => {
    if (!storage.getMapLayoutByKey(l.key)) {
      console.log(`[seed] Creating map layout: ${l.key}`);
      storage.createMapLayout({ key: l.key, label: l.label, area: l.area, orderIndex: idx, nodes: [] });
    }
  });

  // ── Equipment Presets ──────────────────────────────────────────────────
  if (storage.getPresetCount() === 0) {
    console.log("[seed] Seeding equipment presets");
    DEFAULT_EQUIPMENT_PRESETS.forEach((preset, idx) => {
      storage.createPreset({
        key: preset.key,
        label: preset.label,
        blurb: preset.blurb,
        icon: preset.icon,
        defaultCategory: preset.defaultCategory,
        examples: preset.examples,
        customFields: preset.customFields,
        orderIndex: idx,
        enabled: true,
      });
    });
  }

  // ── Job Templates ─────────────────────────────────────────────────────
  if (storage.getTemplateCount() === 0) {
    console.log("[seed] Seeding job templates");
    DEFAULT_JOB_TEMPLATES.forEach((tpl, idx) => {
      storage.createTemplate({
        key: tpl.key,
        label: tpl.label,
        blurb: tpl.blurb,
        icon: tpl.icon,
        params: tpl.params,
        parts: tpl.parts,
        orderIndex: idx,
        enabled: true,
      });
    });
  }

  console.log("[seed] Defaults verified");
}
