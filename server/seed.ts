import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { storage, db } from "./storage";
import { DEFAULT_EQUIPMENT_PRESETS, DEFAULT_JOB_TEMPLATES } from "../shared/wpt-presets";
import {
  DEFAULT_CJM_EQUIPMENT_PRESETS,
  DEFAULT_CJM_JOB_TEMPLATES,
  CJM_SERVICE_CATALOG,
} from "../shared/cjm-presets";
import { products } from "../shared/crm-schema";

const BCRYPT_ROUNDS = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$/;

function randomPin(): string {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

/**
 * The old "manager" role was the operational power user (edit items, adjust
 * stock, edit map). It's been renamed to "technician". The new "manager" role
 * is high-level oversight (dashboard / projects / users) with a simpler UI.
 *
 * Anyone who had the old role keeps the same powers under the new name.
 */
function migrateManagerToTechnician(): void {
  const moved = storage.renameManagerRoleToTechnician();
  if (moved > 0) console.log(`[seed] Migrated ${moved} user(s) from manager → technician`);
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
    const managerPin = isProd ? randomPin() : "5678";
    const techPin = isProd ? randomPin() : "1234";
    const workerPin = isProd ? randomPin() : "0000";
    console.log("[seed] Creating default Manager user");
    storage.createUser({
      name: "Manager",
      pin: bcrypt.hashSync(managerPin, BCRYPT_ROUNDS),
      role: "manager",
    });
    console.log("[seed] Creating default Technician user");
    storage.createUser({
      name: "Technician",
      pin: bcrypt.hashSync(techPin, BCRYPT_ROUNDS),
      role: "technician",
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
      console.log(`[seed]    Manager    / ${managerPin}`);
      console.log(`[seed]    Technician / ${techPin}`);
      console.log(`[seed]    Worker     / ${workerPin}`);
      console.log("[seed] ────────────────────────────────────────────────");
    }
  } else {
    migrateManagerToTechnician();
    migratePlaintextPins();
    const cleaned = storage.stripTemplateAuditFromProjectNotes();
    if (cleaned > 0) console.log(`[seed] Cleaned template/params block from ${cleaned} project(s)`);
  }

  // ── Settings ───────────────────────────────────────────────────────────
  const s = storage.getSettings(); // creates singleton row if missing
  // One-time rebrand chain. The app started as WPT's inventory tool, briefly
  // carried the "Flipnob" name, and now belongs to the owner's real business,
  // CJM Metals (cjmmetals.com). Only rows still holding a known earlier
  // default move — hand-edited names/taglines stay put.
  if (
    s.companyName === "Webber Pressure Technologies" ||
    s.companyName === "WPT" ||
    s.companyName === "Flipnob"
  ) {
    const taglineIsDefault =
      !s.companyTagline ||
      s.companyTagline === "Business Suite" ||
      s.companyTagline === "ASME Certified Pressure Equipment";
    storage.updateSettings({
      companyName: "CJM Metals",
      ...(taglineIsDefault ? { companyTagline: "Custom metalwork. No shortcuts." } : {}),
    });
    console.log(`[seed] Rebranded settings: ${s.companyName} → CJM Metals`);
  }
  // Accent chain: the interim blue (first rebrand) and the dashboard green
  // (restyle) both give way to the CJM brand ink. Dark mode inverts near-black
  // accents to cream at render time (ThemeProvider), matching the website.
  const legacyAccent =
    (s.accentHue === 221 && s.accentSat === 83 && s.accentLight === 53) ||
    (s.accentHue === 142 && s.accentSat === 72 && s.accentLight === 33);
  if (legacyAccent) {
    storage.updateSettings({ accentHue: 0, accentSat: 0, accentLight: 9 });
    console.log("[seed] Accent migrated to CJM ink");
  }

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

  // ── CJM Metals seeds ───────────────────────────────────────────────────
  // Key-idempotent (not count-gated): existing installs that already carry
  // the WPT presets still gain the metalwork ones on upgrade, and owner edits
  // are never overwritten.
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
  DEFAULT_CJM_JOB_TEMPLATES.forEach((tpl, idx) => {
    if (storage.getTemplateByKey(tpl.key)) return;
    storage.createTemplate({
      key: tpl.key,
      label: tpl.label,
      blurb: tpl.blurb,
      icon: tpl.icon,
      params: tpl.params,
      parts: tpl.parts,
      orderIndex: 100 + idx,
      enabled: true,
    });
    cjmAdded++;
  });
  if (cjmAdded > 0) console.log(`[seed] Added ${cjmAdded} CJM metalwork preset(s)/template(s)`);

  // Service catalog → CRM products, only on an empty catalog so the picker on
  // estimates starts populated. Prices start at $0 for the owner to fill in.
  const productCount = db.select({ n: sql<number>`count(*)` }).from(products).get()?.n ?? 0;
  if (productCount === 0) {
    for (const svc of CJM_SERVICE_CATALOG) {
      db.insert(products).values({
        name: svc.name,
        category: svc.category,
        unit: svc.unit,
        description: svc.description,
        unitPriceCents: 0,
        costCents: 0,
        active: true,
      }).run();
    }
    console.log(`[seed] Seeded ${CJM_SERVICE_CATALOG.length} CJM services into the product catalog`);
  }

  console.log("[seed] Defaults verified");
}
