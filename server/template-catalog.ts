import type { TemplateParam, TemplatePart } from "../shared/schema";

// ─── CJM Metals job-template catalog ─────────────────────────────────────────
// One high-quality template per service on www.cjmmetals.com:
//   fences, custom gates, automated gates, gate installation, carports,
//   pergolas, railings, metal furniture.
//
// storage.ts syncs this into job_templates at boot, guarded by
// settings.template_catalog_version — so the owner's later edits in
// Admin → Templates survive restarts until TEMPLATE_CATALOG_VERSION is
// bumped deliberately in code. Owner-created templates (other keys) are
// never touched; the pre-CJM industrial templates get disabled, not deleted.
//
// Part quantities are expr.ts formulas over the params (+ - * /, ceil, floor,
// round, min, max, abs, sqrt). There are NO conditionals, so quantities scale
// linearly and the notes say when to skip or adjust a line.

export const TEMPLATE_CATALOG_VERSION = 2;

// The app's pre-CJM industrial templates — hidden from the picker, kept in
// the table (and restorable from Admin → Templates) in case they're wanted.
export const LEGACY_TEMPLATE_KEYS = [
  "new_oven_build",
  "new_autoclave_build",
  "annual_door_safety_check",
  "field_dispatch",
];

export interface CatalogTemplate {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  params: TemplateParam[];
  parts: TemplatePart[];
}

export const TEMPLATE_CATALOG: CatalogTemplate[] = [
  // ── Fences ─────────────────────────────────────────────────────────────────
  {
    key: "fence_run",
    label: "Fence build & install",
    blurb: "Posts, rails, infill, concrete, and consumables for a fence run — slat, picket, or wood-hybrid.",
    icon: "fence",
    params: [
      { key: "lengthFt", label: "Total run", kind: "number", unit: "ft", defaultValue: 100, helper: "All sides added together, including corners" },
      { key: "heightFt", label: "Height", kind: "number", unit: "ft", defaultValue: 6 },
      { key: "postSpacingFt", label: "Post spacing", kind: "number", unit: "ft", defaultValue: 8, helper: "8 ft typical; drop to 6 ft for privacy panels or windy spots" },
      { key: "walkGates", label: "Walk gates", kind: "number", defaultValue: 0, helper: "Gates hung inside this run" },
    ],
    parts: [
      { label: "Line posts — 2 in sq tube or 2⅜ in pipe", category: "raw_materials", qty: "ceil(lengthFt/postSpacingFt)+1", unit: "posts", notes: "Add 1 per extra corner or end past the first" },
      { label: "Post concrete — 80 lb bags", category: "raw_materials", qty: "(ceil(lengthFt/postSpacingFt)+1)*2", unit: "bags", notes: "2 bags per post, ~2 ft deep" },
      { label: "Rails — 1½ in sq tube, 20 ft sticks", category: "raw_materials", qty: "ceil(lengthFt*2/20)", unit: "sticks", notes: "Top + bottom run; add a third run over 6 ft tall" },
      { label: "Infill — slats / pickets", category: "raw_materials", qty: "ceil(lengthFt*3)", unit: "pickets", notes: "≈4 in on-center; SKIP for wood-hybrid (customer wood goes in)" },
      { label: "Post caps", category: "raw_materials", qty: "ceil(lengthFt/postSpacingFt)+1", unit: "caps" },
      { label: "Walk gate kit — hinges + latch", category: "raw_materials", qty: "walkGates", unit: "kits" },
      { label: "Welding wire — .035 spool", category: "welder", qty: "ceil(lengthFt/150)", unit: "spools" },
      { label: "Cutoff + flap disc pack", category: "welder", qty: "ceil(lengthFt/100)", unit: "packs" },
      { label: "Primer + paint", category: "raw_materials", qty: "ceil(lengthFt*heightFt/350)", unit: "gal", notes: "Two coats, both faces" },
    ],
  },

  // ── Custom gates ───────────────────────────────────────────────────────────
  {
    key: "driveway_gate",
    label: "Custom gate build",
    blurb: "Frame, infill, posts, and hanging hardware for a custom swing gate — single or double leaf.",
    icon: "door-open",
    params: [
      { key: "widthFt", label: "Opening width", kind: "number", unit: "ft", defaultValue: 12 },
      { key: "heightFt", label: "Height", kind: "number", unit: "ft", defaultValue: 6 },
      { key: "leaves", label: "Leaves", kind: "number", defaultValue: 2, helper: "1 = single swing, 2 = double" },
    ],
    parts: [
      { label: "Frame — 2 in sq tube, 20 ft sticks", category: "raw_materials", qty: "ceil((widthFt+heightFt)*2.6/20)", unit: "sticks", notes: "Perimeter + mid-bracing, all leaves" },
      { label: "Infill — sheet metal (4×8)", category: "raw_materials", qty: "ceil(widthFt*heightFt/32)", unit: "sheets", notes: "For solid infill; picket infill instead ≈ ceil(widthFt*3) pickets" },
      { label: "Gate posts — 4 in sq tube", category: "raw_materials", qty: "2", unit: "posts", notes: "Upsize to 6 in for leaves over 8 ft" },
      { label: "Post concrete — 80 lb bags", category: "raw_materials", qty: "8", unit: "bags", notes: "4 per post, 3 ft deep — gates take the abuse" },
      { label: "Heavy-duty hinges", category: "raw_materials", qty: "leaves*2", unit: "sets", notes: "J-bolt or bearing hinges sized to leaf weight" },
      { label: "Drop rod + ground sleeve", category: "raw_materials", qty: "max(0, leaves-1)", unit: "kits", notes: "Doubles only" },
      { label: "Latch", category: "raw_materials", qty: "1", unit: "kit" },
      { label: "Primer + paint", category: "raw_materials", qty: "ceil(widthFt*heightFt/150)", unit: "qt", notes: "Two coats" },
      { label: "Welding consumables kit — wire + discs", category: "welder", qty: "1", unit: "kit" },
    ],
  },

  // ── Automated gates ────────────────────────────────────────────────────────
  {
    key: "gate_automation",
    label: "Automated gate system",
    blurb: "Operator, safety devices, access control, and wiring to automate a new or existing gate.",
    icon: "zap",
    params: [
      { key: "leaves", label: "Leaves to automate", kind: "number", defaultValue: 2, helper: "Swing: one operator per leaf. Slide: use 1." },
      { key: "powerRunFt", label: "Power run", kind: "number", unit: "ft", defaultValue: 50, helper: "Panel/outlet to the operator" },
      { key: "access", label: "Access control", kind: "select", options: ["Keypad", "Remote only", "Keypad + phone app"], defaultValue: "Keypad" },
    ],
    parts: [
      { label: "Gate operator kit", category: "electric", qty: "leaves", unit: "units", notes: "One arm per swing leaf; slide gates need only 1 — drop the extra" },
      { label: "Photo-eye safety sensors (pair)", category: "electric", qty: "1", unit: "pair", notes: "UL 325 — never skip" },
      { label: "Exit wand or ground loop", category: "electric", qty: "1", unit: "unit" },
      { label: "Keypad", category: "electric", qty: "1", unit: "unit", notes: "SKIP for remote-only setups" },
      { label: "Remotes", category: "electric", qty: "2", unit: "units" },
      { label: "Battery backup (or solar panel kit)", category: "electric", qty: "1", unit: "kit", notes: "Solar where no hardline power exists" },
      { label: "THHN wire", category: "electric", qty: "powerRunFt*3", unit: "ft", notes: "Hot / neutral / ground" },
      { label: "Conduit — ¾ in, 10 ft sticks", category: "electric", qty: "ceil(powerRunFt/10)", unit: "sticks" },
      { label: "Warning signs", category: "raw_materials", qty: "2", unit: "signs", notes: "Required with automated gates" },
    ],
  },

  // ── Gate installation ──────────────────────────────────────────────────────
  {
    key: "gate_install",
    label: "Gate installation (hang only)",
    blurb: "Posts, concrete, and hanging hardware to install a gate that's already built.",
    icon: "wrench",
    params: [
      { key: "leaves", label: "Leaves", kind: "number", defaultValue: 1, helper: "1 = single swing, 2 = double" },
      { key: "heightFt", label: "Gate height", kind: "number", unit: "ft", defaultValue: 6 },
    ],
    parts: [
      { label: "Gate posts — 4 in sq tube", category: "raw_materials", qty: "2", unit: "posts", notes: "Upsize for heavy or long leaves" },
      { label: "Post concrete — 80 lb bags", category: "raw_materials", qty: "6", unit: "bags", notes: "3 ft deep minimum" },
      { label: "Hinges", category: "raw_materials", qty: "leaves*2", unit: "sets" },
      { label: "Latch / drop rod", category: "raw_materials", qty: "1", unit: "kit" },
      { label: "Shims + hardware pack", category: "raw_materials", qty: "1", unit: "pack" },
      { label: "Touch-up paint", category: "raw_materials", qty: "1", unit: "qt" },
    ],
  },

  // ── Carports ───────────────────────────────────────────────────────────────
  {
    key: "carport",
    label: "Steel carport",
    blurb: "Columns, trusses, purlins, roof panels, and anchoring for an engineered steel carport.",
    icon: "car",
    params: [
      { key: "widthFt", label: "Width", kind: "number", unit: "ft", defaultValue: 20, helper: "Truss span" },
      { key: "lengthFt", label: "Length", kind: "number", unit: "ft", defaultValue: 20 },
      { key: "legHeightFt", label: "Leg height", kind: "number", unit: "ft", defaultValue: 8 },
    ],
    parts: [
      { label: "Columns — 4 in sq tube", category: "raw_materials", qty: "(ceil(lengthFt/10)+1)*2", unit: "posts", notes: "10 ft bays, both sides" },
      { label: "Trusses / roof bows", category: "raw_materials", qty: "ceil(lengthFt/10)+1", unit: "trusses", notes: "One per column pair, spanning the width" },
      { label: "Purlins — 2×4 14 ga, 20 ft sticks", category: "raw_materials", qty: "ceil(ceil(widthFt/2.5)*lengthFt/20)", unit: "sticks", notes: "Rows every 2½ ft across the width" },
      { label: "Roof panels — 26 ga R-panel (3 ft coverage)", category: "raw_materials", qty: "ceil(widthFt/3)", unit: "panels", notes: "Order at length + 1 ft overhang" },
      { label: "Trim + ridge pack", category: "raw_materials", qty: "1", unit: "pack" },
      { label: "Self-drilling screws", category: "raw_materials", qty: "ceil(widthFt*lengthFt/150)", unit: "bags" },
      { label: "Base plates + anchor bolts", category: "raw_materials", qty: "(ceil(lengthFt/10)+1)*2", unit: "sets", notes: "4 wedge anchors per plate on slab; J-bolts for new footings" },
      { label: "Concrete — footings, 80 lb bags", category: "raw_materials", qty: "(ceil(lengthFt/10)+1)*4", unit: "bags", notes: "SKIP when anchoring to an existing slab" },
      { label: "Primer + paint for frame", category: "raw_materials", qty: "ceil((widthFt+lengthFt)/20)", unit: "gal" },
      { label: "Welding consumables kit — wire + discs", category: "welder", qty: "1", unit: "kit" },
    ],
  },

  // ── Pergolas ───────────────────────────────────────────────────────────────
  {
    key: "pergola",
    label: "Pergola build & install",
    blurb: "Posts, beams, rafters, and optional shade panels for a rectangular steel pergola — matches the website designer.",
    icon: "sun",
    params: [
      { key: "widthFt", label: "Width", kind: "number", unit: "ft", defaultValue: 12, helper: "Rafter span" },
      { key: "depthFt", label: "Depth", kind: "number", unit: "ft", defaultValue: 16 },
      { key: "headClearanceFt", label: "Head clearance", kind: "number", unit: "ft", defaultValue: 8 },
      { key: "roof", label: "Roof", kind: "select", options: ["Open rafters", "Shade panels"], defaultValue: "Open rafters" },
    ],
    parts: [
      { label: "Posts — 4 in sq tube", category: "raw_materials", qty: "(ceil(depthFt/8)+1)*2", unit: "posts", notes: "≈8 ft spacing down each side" },
      { label: "Post concrete — 80 lb bags", category: "raw_materials", qty: "((ceil(depthFt/8)+1)*2)*3", unit: "bags", notes: "SKIP if anchoring to slab — use base plates below" },
      { label: "Base plates + wedge anchors", category: "raw_materials", qty: "(ceil(depthFt/8)+1)*2", unit: "sets", notes: "Slab installs only" },
      { label: "Beams — 2×6 tube, 20 ft sticks", category: "raw_materials", qty: "ceil(depthFt*2/20)", unit: "sticks", notes: "Doubled beam down each side" },
      { label: "Rafters — 2×4 tube, 20 ft sticks", category: "raw_materials", qty: "ceil((ceil(depthFt/2)+1)*(widthFt+2)/20)", unit: "sticks", notes: "One rafter every 2 ft, cut at width + 2 ft overhang" },
      { label: "Shade panels (4×8)", category: "raw_materials", qty: "ceil(widthFt*depthFt/32)", unit: "sheets", notes: "SKIP for open rafters" },
      { label: "Primer + paint", category: "raw_materials", qty: "ceil(widthFt*depthFt/200)", unit: "gal", notes: "Two coats" },
      { label: "Welding consumables kit — wire + discs", category: "welder", qty: "1", unit: "kit" },
    ],
  },

  // ── Railings ───────────────────────────────────────────────────────────────
  {
    key: "railing_run",
    label: "Railing run",
    blurb: "Posts, top rail, pickets, and anchoring for stair, porch, or balcony railing.",
    icon: "ruler",
    params: [
      { key: "lengthFt", label: "Total run", kind: "number", unit: "ft", defaultValue: 20 },
      { key: "heightIn", label: "Height", kind: "number", unit: "in", defaultValue: 36, helper: "36 in residential / 42 in commercial guard" },
      { key: "mount", label: "Mount", kind: "select", options: ["Surface (base plate)", "Core drill", "Side mount"], defaultValue: "Surface (base plate)" },
    ],
    parts: [
      { label: "Posts — 1½ in sq tube", category: "raw_materials", qty: "ceil(lengthFt/4)+1", unit: "posts", notes: "4 ft max spacing" },
      { label: "Base plates + anchors", category: "raw_materials", qty: "ceil(lengthFt/4)+1", unit: "sets", notes: "SKIP for core-drill mounts" },
      { label: "Top rail — 20 ft sticks", category: "raw_materials", qty: "ceil(lengthFt/20)", unit: "sticks" },
      { label: "Pickets — ½ in sq bar", category: "raw_materials", qty: "ceil(lengthFt*3.2)", unit: "pickets", notes: "Keeps gaps under the 4 in code sphere" },
      { label: "Handrail brackets / returns", category: "raw_materials", qty: "ceil(lengthFt/4)", unit: "pcs", notes: "Stair sections only" },
      { label: "Paint", category: "raw_materials", qty: "ceil(lengthFt/50)", unit: "qt" },
      { label: "Welding consumables kit — wire + discs", category: "welder", qty: "1", unit: "kit" },
    ],
  },

  // ── Metal furniture ────────────────────────────────────────────────────────
  {
    key: "metal_furniture",
    label: "Custom furniture piece",
    blurb: "Stock allowance, tops, hardware, and finish for custom metal furniture — tables, benches, shelving, fire pits.",
    icon: "armchair",
    params: [
      { key: "pieces", label: "Pieces", kind: "number", defaultValue: 1 },
      { key: "pieceType", label: "Type", kind: "select", options: ["Dining table", "Coffee table", "Bench", "Shelving unit", "Fire pit", "Other"], defaultValue: "Dining table" },
      { key: "top", label: "Top / insert", kind: "select", options: ["Wood — customer supplies", "Wood — we supply", "Steel plate", "Glass — customer supplies", "None"], defaultValue: "Wood — we supply" },
    ],
    parts: [
      { label: "Frame stock — tube / flat bar per drawing", category: "raw_materials", qty: "pieces", unit: "lots", notes: "Pull from rack against the shop drawing" },
      { label: "Top / insert material", category: "raw_materials", qty: "pieces", unit: "pcs", notes: "SKIP when the customer supplies it" },
      { label: "Leveling feet / glides", category: "raw_materials", qty: "pieces*4", unit: "pcs" },
      { label: "Hardware pack — fasteners, brackets", category: "raw_materials", qty: "pieces", unit: "packs" },
      { label: "Finish — clear coat or paint", category: "raw_materials", qty: "ceil(pieces/2)", unit: "qt" },
      { label: "Abrasives + welding kit", category: "welder", qty: "1", unit: "kit" },
    ],
  },
];
