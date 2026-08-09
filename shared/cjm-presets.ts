import type { CustomField, Category } from "./schema";

export interface EquipmentPresetSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  defaultCategory: Category;
  examples: string[];
  customFields: CustomField[];
}

// ─── CJM Metals seeds ────────────────────────────────────────────────────────
// Custom metalwork fabricator (Arlington, TX — DFW). Inserted only when the
// key doesn't exist yet, so owner edits are never clobbered. (Job templates
// live in server/template-catalog.ts, which owns every catalog key.)

// ─── Equipment presets (inventory classification) ───────────────────────────

export const DEFAULT_CJM_EQUIPMENT_PRESETS: EquipmentPresetSeed[] = [
  {
    key: "steel_stock",
    label: "Steel stock",
    blurb: "Square/round tube, angle, flat bar, sheet, and pipe — the raw steel every job starts from.",
    icon: "package",
    defaultCategory: "raw_materials",
    examples: [
      "2in square tube 14ga",
      "1x1/8 flat bar",
      "3/4in picket tube",
      "14ga sheet 4x8",
      "2-3/8in fence post",
    ],
    customFields: [
      {
        key: "profile",
        label: "Profile",
        kind: "select",
        options: ["Square tube", "Round tube", "Pipe", "Angle", "Flat bar", "Channel", "Sheet", "Plate", "Other"],
      },
      { key: "size", label: "Size", kind: "text", placeholder: "2in x 2in" },
      { key: "wall", label: "Wall / gauge", kind: "text", placeholder: "14ga" },
      { key: "stickLength", label: "Stick length", kind: "number", unit: "ft" },
      {
        key: "finish",
        label: "Finish",
        kind: "select",
        options: ["Raw", "Primed", "Galvanized", "Powder-coated"],
      },
    ],
  },
  {
    key: "gate_operator",
    label: "Gate operators",
    blurb: "Swing and slide gate openers plus their accessories — photo eyes, keypads, remotes, loops.",
    icon: "zap",
    defaultCategory: "electric",
    examples: [
      "LiftMaster LA400 swing kit",
      "Nice Apollo slide operator",
      "Photo eye pair",
      "Wireless keypad",
      "Exit wand",
    ],
    customFields: [
      {
        key: "brand",
        label: "Brand",
        kind: "select",
        options: ["LiftMaster", "Nice/Apollo", "Viking", "DoorKing", "Ghost Controls", "Other"],
      },
      { key: "operatorType", label: "Type", kind: "select", options: ["Swing", "Slide", "Accessory"] },
      { key: "power", label: "Power", kind: "select", options: ["120V", "24V solar", "Battery", "N/A"] },
      { key: "gateWeightLb", label: "Max gate weight", kind: "number", unit: "lb" },
    ],
  },
];


