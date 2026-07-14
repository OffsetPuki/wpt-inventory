import type { CustomField, TemplateParam, TemplatePart, Category } from "./schema";

// Seed-data shapes shared by the preset catalogs below. (These used to live in
// wpt-presets.ts alongside a legacy catalog that has since been removed; the
// two interfaces are now the only survivors, so they live here with their sole
// consumer.)

export interface EquipmentPresetSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  defaultCategory: Category;
  examples: string[];
  customFields: CustomField[];
}

export interface JobTemplateSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  params: TemplateParam[];
  parts: TemplatePart[];
}

// ─── CJM Metals seeds ────────────────────────────────────────────────────────
// Custom metalwork fabricator (Arlington, TX — DFW): gates (incl. automated),
// fences, carports, railings, and industrial furniture. These seed alongside
// the legacy WPT presets — inserted only when the key doesn't exist yet, so
// owner edits are never clobbered. Old presets can be disabled from
// Admin → Job Templates / Settings.

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

// ─── Job templates (project BOM generators) ──────────────────────────────────
// Quantity formulas only use numeric params (the evaluator resolves select
// values to 0), so style choices ride along as notes for the estimator.

export const DEFAULT_CJM_JOB_TEMPLATES: JobTemplateSeed[] = [
  {
    key: "fence_run",
    label: "Fence run",
    blurb: "Posts, rails, infill, and consumables for a straight fence run — slat, picket, or wood-hybrid styles.",
    icon: "hammer",
    params: [
      { key: "lengthFt", label: "Run length", kind: "number", unit: "ft", defaultValue: 100 },
      { key: "heightFt", label: "Height", kind: "number", unit: "ft", defaultValue: 6, helper: "Arlington: back yards to 8 ft; front yards 4 ft ornamental" },
      {
        key: "style",
        label: "Style",
        kind: "select",
        options: ["Horizontal slat steel", "Wrought iron picket", "Cedar + black steel", "Wood + metal mesh"],
        defaultValue: "Horizontal slat steel",
      },
    ],
    parts: [
      {
        label: "Fence posts 2-3/8in",
        category: "raw_materials",
        qty: "ceil(lengthFt / 8) + 1",
        unit: "each",
        notes: "8 ft spacing",
      },
      {
        label: "Concrete 60lb bags",
        category: "raw_materials",
        qty: "(ceil(lengthFt / 8) + 1) * 2",
        unit: "bags",
      },
      {
        label: "Rail — 1-1/2in square tube",
        category: "raw_materials",
        qty: "ceil(lengthFt * 3 / 20)",
        unit: "sticks",
        notes: "3 rails, 20 ft sticks",
      },
      {
        label: "Infill (slats / pickets / mesh)",
        category: "raw_materials",
        qty: "lengthFt * heightFt",
        unit: "sqft",
        notes: "Order per selected style",
      },
      {
        label: "Post caps",
        category: "raw_materials",
        qty: "ceil(lengthFt / 8) + 1",
        unit: "each",
      },
      {
        label: "Self-tapping screws",
        category: "raw_materials",
        qty: "ceil(lengthFt / 50)",
        unit: "boxes",
      },
      {
        label: "Primer + paint",
        category: "raw_materials",
        qty: "ceil(lengthFt / 100)",
        unit: "gal",
      },
    ],
  },
  {
    key: "driveway_gate",
    label: "Driveway gate build",
    blurb: "Frame, infill, and hanging hardware for a custom swing gate — single or double leaf.",
    icon: "shield-check",
    params: [
      { key: "widthFt", label: "Opening width", kind: "number", unit: "ft", defaultValue: 12 },
      { key: "heightFt", label: "Height", kind: "number", unit: "ft", defaultValue: 6 },
      { key: "leaves", label: "Leaves", kind: "number", defaultValue: 2, helper: "1 = single swing, 2 = double" },
    ],
    parts: [
      {
        label: "Frame — 2in square tube",
        category: "raw_materials",
        qty: "ceil((widthFt * 2 + heightFt * 4) / 20)",
        unit: "sticks",
        notes: "Perimeter + mid-brace, 20 ft sticks",
      },
      {
        label: "Infill pickets 3/4in",
        category: "raw_materials",
        qty: "ceil(widthFt * 2)",
        unit: "each",
        notes: "~6in spacing",
      },
      {
        label: "Heavy-duty hinges",
        category: "raw_materials",
        qty: "leaves * 2",
        unit: "each",
      },
      { label: "Gate posts 4in", category: "raw_materials", qty: "2", unit: "each" },
      { label: "Concrete 60lb bags", category: "raw_materials", qty: "8", unit: "bags" },
      { label: "Drop rod + latch", category: "raw_materials", qty: "1", unit: "set" },
      { label: "Primer + paint", category: "raw_materials", qty: "1", unit: "gal" },
    ],
  },
  {
    key: "gate_automation",
    label: "Gate automation add-on",
    blurb: "Operator kit and safety accessories to automate an existing or new gate.",
    icon: "zap",
    params: [
      { key: "operators", label: "Operators", kind: "number", defaultValue: 1, helper: "2 for dual-leaf swing gates" },
      { key: "runToPowerFt", label: "Run to power", kind: "number", unit: "ft", defaultValue: 50 },
    ],
    parts: [
      { label: "Gate operator kit", equipmentType: "gate_operator", category: "electric", qty: "operators", unit: "each" },
      { label: "Photo eye safety pair", equipmentType: "gate_operator", category: "electric", qty: "1", unit: "pair" },
      { label: "Wireless keypad", equipmentType: "gate_operator", category: "electric", qty: "1", unit: "each" },
      { label: "Exit wand / loop", equipmentType: "gate_operator", category: "electric", qty: "operators", unit: "each" },
      { label: "Conduit 3/4in", category: "electric", qty: "runToPowerFt", unit: "ft" },
      { label: "THHN wire (3 runs)", category: "electric", qty: "runToPowerFt * 3", unit: "ft" },
    ],
  },
  {
    key: "carport",
    label: "Steel carport",
    blurb: "Posts, trusses, purlins, and roof panels for an engineered steel carport.",
    icon: "truck",
    params: [
      { key: "widthFt", label: "Width", kind: "number", unit: "ft", defaultValue: 20 },
      { key: "lengthFt", label: "Length", kind: "number", unit: "ft", defaultValue: 20 },
      { key: "legHeightFt", label: "Leg height", kind: "number", unit: "ft", defaultValue: 8 },
    ],
    parts: [
      {
        label: "Posts — 2-1/2in square tube",
        category: "raw_materials",
        qty: "(ceil(lengthFt / 10) + 1) * 2",
        unit: "each",
        notes: "10 ft bays, both sides",
      },
      {
        label: "Trusses / bows",
        category: "raw_materials",
        qty: "ceil(lengthFt / 10) + 1",
        unit: "each",
      },
      {
        label: "Purlins — 1-1/2in square tube",
        category: "raw_materials",
        qty: "ceil(widthFt / 3) ",
        unit: "runs",
        notes: "3 ft spacing across the width",
      },
      {
        label: "Roof panels 3ft coverage",
        category: "raw_materials",
        qty: "ceil(widthFt / 3) * ceil(lengthFt / 21)",
        unit: "sheets",
        notes: "21 ft sheet length",
      },
      { label: "Base plates + anchors", category: "raw_materials", qty: "(ceil(lengthFt / 10) + 1) * 2", unit: "sets" },
      { label: "Concrete 60lb bags", category: "raw_materials", qty: "(ceil(lengthFt / 10) + 1) * 4", unit: "bags" },
      { label: "Panel screws w/ washers", category: "raw_materials", qty: "ceil(widthFt * lengthFt / 100)", unit: "boxes" },
    ],
  },
  {
    key: "railing_run",
    label: "Railing run",
    blurb: "Posts, top rail, and pickets for stair, balcony, or porch railing.",
    icon: "wrench",
    params: [
      { key: "lengthFt", label: "Total length", kind: "number", unit: "ft", defaultValue: 20 },
      {
        key: "mount",
        label: "Mount",
        kind: "select",
        options: ["Surface (base plates)", "Core-drilled", "Side / fascia"],
        defaultValue: "Surface (base plates)",
      },
    ],
    parts: [
      {
        label: "Posts — 1-1/2in square tube",
        category: "raw_materials",
        qty: "ceil(lengthFt / 5) + 1",
        unit: "each",
        notes: "5 ft spacing max",
      },
      { label: "Top rail / cap", category: "raw_materials", qty: "lengthFt", unit: "ft" },
      {
        label: "Pickets 1/2in",
        category: "raw_materials",
        qty: "ceil(lengthFt * 3)",
        unit: "each",
        notes: "<4in sphere code spacing",
      },
      { label: "Base plates or core mounts", category: "raw_materials", qty: "ceil(lengthFt / 5) + 1", unit: "each" },
      { label: "Anchors / epoxy", category: "raw_materials", qty: "ceil((ceil(lengthFt / 5) + 1) / 4)", unit: "packs" },
    ],
  },
];

// ─── Service catalog (CRM products — estimate/invoice line-item picker) ──────
// Prices deliberately start at $0: the owner sets real numbers in
// CRM → Products. Units drive the qty column on estimates.

export interface ServiceCatalogSeed {
  name: string;
  category: string;
  unit: string;
  description?: string;
}

export const CJM_SERVICE_CATALOG: ServiceCatalogSeed[] = [
  // Gates
  { name: "Custom driveway gate — single swing", category: "Gates", unit: "each" },
  { name: "Custom driveway gate — double swing", category: "Gates", unit: "each" },
  { name: "Sliding gate", category: "Gates", unit: "each" },
  { name: "Pedestrian / walk gate", category: "Gates", unit: "each" },
  { name: "Gate automation (operator installed)", category: "Gates", unit: "each" },
  { name: "Gate repair service call", category: "Gates", unit: "each" },
  // Fencing (per linear foot, priced by style)
  { name: "Horizontal slat steel fence", category: "Fencing", unit: "ft" },
  { name: "Wrought iron / picket fence", category: "Fencing", unit: "ft" },
  { name: "Cedar + black steel fence", category: "Fencing", unit: "ft" },
  { name: "Wood + metal mesh fence", category: "Fencing", unit: "ft" },
  // Carports
  { name: "Steel carport — 1 car", category: "Carports", unit: "each" },
  { name: "Steel carport — 2 car", category: "Carports", unit: "each" },
  { name: "Custom carport / cover", category: "Carports", unit: "sqft" },
  // Railings
  { name: "Stair railing", category: "Railings", unit: "ft" },
  { name: "Balcony railing", category: "Railings", unit: "ft" },
  { name: "Porch / deck railing", category: "Railings", unit: "ft" },
  // Furniture
  { name: "Custom dining table", category: "Furniture", unit: "each" },
  { name: "Console table", category: "Furniture", unit: "each" },
  { name: "Workbench", category: "Furniture", unit: "each" },
  // Labor & finishing
  { name: "Welding / fabrication labor", category: "Labor", unit: "hour" },
  { name: "Installation labor", category: "Labor", unit: "hour" },
  { name: "Design & CAD", category: "Labor", unit: "hour" },
  { name: "Powder-coat finish", category: "Labor", unit: "sqft" },
  { name: "Site consultation & quote", category: "Labor", unit: "each", description: "Free — included with every project" },
];
