import { storage } from "./storage";
import { DEFAULT_EQUIPMENT_PRESETS, DEFAULT_JOB_TEMPLATES } from "../shared/wpt-presets";

/**
 * Seed default data on first run.
 * Only inserts if the corresponding table is empty, so manager edits are never clobbered.
 */
export function seedDefaults(): void {
  // ── Users ──────────────────────────────────────────────────────────────
  if (storage.getUserCount() === 0) {
    console.log("[seed] Creating default Manager user");
    storage.createUser({ name: "Manager", pin: "1234", role: "manager" });
    console.log("[seed] Creating default Worker user");
    storage.createUser({ name: "Worker", pin: "0000", role: "worker" });
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
