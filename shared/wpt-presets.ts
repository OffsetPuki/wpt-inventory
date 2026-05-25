import type { CustomField, TemplateParam, TemplatePart, Category } from "./schema";

// ─── Equipment Preset Definition ─────────────────────────────────────────────

export interface EquipmentPresetSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  defaultCategory: Category;
  examples: string[];
  customFields: CustomField[];
}

export const DEFAULT_EQUIPMENT_PRESETS: EquipmentPresetSeed[] = [
  {
    key: "autoclave_consumable",
    label: "Autoclave consumables",
    blurb: "Vacuum bags, breather, release film, sealant tape, and other consumable materials used in autoclave curing cycles.",
    icon: "flame",
    defaultCategory: "raw_materials",
    examples: [
      "Vacuum bag film",
      "Breather cloth",
      "Release film",
      "Sealant tape",
      "Peel ply",
    ],
    customFields: [
      { key: "rollWidth", label: "Roll width", kind: "number", unit: "in" },
      { key: "rollLength", label: "Roll length", kind: "number", unit: "ft" },
      { key: "tempRating", label: "Temp rating", kind: "number", unit: "°F" },
      { key: "lotNumber", label: "Lot number", kind: "text" },
    ],
  },
  {
    key: "pressure_vessel_part",
    label: "Pressure-vessel parts",
    blurb: "Door seals, gaskets, thermocouples, RTDs, hoses, fittings, and other parts for ASME-coded pressure vessels.",
    icon: "gauge",
    defaultCategory: "raw_materials",
    examples: [
      "Door seal",
      "Thermocouple",
      "RTD probe",
      "High-pressure hose",
      "Vessel gasket",
    ],
    customFields: [
      {
        key: "subType",
        label: "Sub-type",
        kind: "select",
        options: [
          "Door seal",
          "Gasket",
          "Thermocouple",
          "RTD",
          "Hose",
          "Fitting",
          "Other",
        ],
      },
      {
        key: "tcType",
        label: "TC type",
        kind: "select",
        options: ["J", "K", "T", "E", "N", "PT100", "PT1000", "N/A"],
      },
      { key: "length", label: "Length", kind: "number", unit: "in" },
      { key: "diameter", label: "Diameter", kind: "number", unit: "in" },
      { key: "tempRating", label: "Temp rating", kind: "number", unit: "°F" },
    ],
  },
  {
    key: "burner_heating",
    label: "Burner / heating",
    blurb: "Gas and electric heating elements, burners, ignition modules, and heating system components.",
    icon: "thermometer",
    defaultCategory: "electric",
    examples: [
      "Natural gas burner",
      "Ignition module",
      "Heating element",
      "Gas valve",
      "Flame sensor",
    ],
    customFields: [
      {
        key: "fuelType",
        label: "Fuel type",
        kind: "select",
        options: ["NG", "Propane", "Electric", "Dual"],
      },
      { key: "btuRating", label: "BTU rating", kind: "number", unit: "BTU/hr" },
      {
        key: "noxClass",
        label: "NOx class",
        kind: "select",
        options: ["Ultra-low", "Low", "Standard", "N/A"],
      },
      { key: "voltage", label: "Voltage", kind: "number", unit: "V" },
    ],
  },
  {
    key: "hydraulic_press_part",
    label: "Hydraulic press parts",
    blurb: "Cylinders, seals, pumps, valves, and fittings for bonding presses and hydraulic systems.",
    icon: "arrow-down-up",
    defaultCategory: "raw_materials",
    examples: [
      "Hydraulic cylinder",
      "Seal kit",
      "Hydraulic pump",
      "Relief valve",
      "Pressure gauge",
    ],
    customFields: [
      {
        key: "subType",
        label: "Sub-type",
        kind: "select",
        options: [
          "Cylinder",
          "Seal",
          "Pump",
          "Valve",
          "Gauge",
          "Fitting",
          "Hose",
          "Other",
        ],
      },
      { key: "bore", label: "Bore", kind: "number", unit: "in" },
      { key: "stroke", label: "Stroke", kind: "number", unit: "in" },
      {
        key: "pressureRating",
        label: "Pressure rating",
        kind: "number",
        unit: "psi",
      },
      { key: "portSize", label: "Port size", kind: "text" },
    ],
  },
  {
    key: "pcs_control",
    label: "PCS / controls",
    blurb: "PLCs, I/O modules, HMIs, VFDs, contactors, relays, power supplies, and networking equipment.",
    icon: "cpu",
    defaultCategory: "it",
    examples: [
      "PLC module",
      "HMI panel",
      "VFD",
      "24V power supply",
      "Ethernet switch",
    ],
    customFields: [
      {
        key: "subType",
        label: "Sub-type",
        kind: "select",
        options: [
          "PLC",
          "IO",
          "HMI",
          "VFD",
          "Contactor",
          "Relay",
          "PSU",
          "Network",
          "Other",
        ],
      },
      { key: "vendor", label: "Vendor", kind: "text" },
      { key: "firmware", label: "Firmware", kind: "text" },
      { key: "voltage", label: "Voltage", kind: "number", unit: "V" },
      { key: "channels", label: "Channels", kind: "number" },
    ],
  },
  {
    key: "asme_repair",
    label: "ASME-rated fasteners & repair",
    blurb: "ASME-stamped bolts, studs, nuts, weld rod, and repair materials with heat/lot traceability.",
    icon: "shield-check",
    defaultCategory: "raw_materials",
    examples: [
      "B7 stud bolt",
      "2H heavy hex nut",
      "ER70S-6 weld wire",
      "Gasket sheet",
      "SA-516 plate",
    ],
    customFields: [
      { key: "asmeMarking", label: "ASME marking", kind: "text" },
      { key: "heatNumber", label: "Heat number", kind: "text" },
      {
        key: "stampType",
        label: "Stamp type",
        kind: "select",
        options: ["U", "R", "NB", "None"],
      },
      { key: "size", label: "Size", kind: "text" },
      { key: "material", label: "Material", kind: "text" },
    ],
  },
  {
    key: "field_service_kit",
    label: "Field service kit",
    blurb: "Pre-packed tool kits and supplies for on-site service calls and field dispatch.",
    icon: "truck",
    defaultCategory: "tools",
    examples: [
      "Autoclave service kit",
      "Press service kit",
      "Oven tune-up kit",
      "Controls swap kit",
    ],
    customFields: [
      { key: "truckId", label: "Truck ID", kind: "text" },
      {
        key: "kitFor",
        label: "Kit for",
        kind: "select",
        options: [
          "Autoclave",
          "Press",
          "Oven",
          "Controls",
          "General",
        ],
      },
      { key: "lastChecked", label: "Last checked", kind: "text", placeholder: "MM/DD/YYYY" },
    ],
  },
];

// ─── Job Template Definition ─────────────────────────────────────────────────

export interface JobTemplateSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  params: TemplateParam[];
  parts: TemplatePart[];
}

export const DEFAULT_JOB_TEMPLATES: JobTemplateSeed[] = [
  {
    key: "new_oven_build",
    label: "New oven build",
    blurb: "Complete BOM for a new industrial oven build including structure, insulation, heating, and controls.",
    icon: "flame",
    params: [
      { key: "length", label: "Length", kind: "number", unit: "ft", defaultValue: 10 },
      { key: "width", label: "Width", kind: "number", unit: "ft", defaultValue: 8 },
      { key: "height", label: "Height", kind: "number", unit: "ft", defaultValue: 8 },
      {
        key: "heatSource",
        label: "Heat source",
        kind: "select",
        options: ["NG", "Propane", "Electric", "Dual"],
        defaultValue: "NG",
      },
    ],
    parts: [
      {
        label: "1.5in square tubing (20ft lengths)",
        equipmentType: undefined,
        category: "raw_materials",
        qty: "ceil((length+width+height)*4/20)",
        unit: "lengths",
        notes: "Structural frame",
      },
      {
        label: "Wall panels (4×8 sheets)",
        category: "raw_materials",
        qty: "ceil((length*height*2 + width*height*2) / 32)",
        unit: "sheets",
        notes: "Exterior skin — 4×8ft = 32 sq ft per sheet",
      },
      {
        label: "Insulation batts (4×8 sheets)",
        category: "raw_materials",
        qty: "ceil((length*height*2 + width*height*2 + length*width) / 32)",
        unit: "sheets",
        notes: "Walls + ceiling",
      },
      {
        label: "Floor grating (4×8 panels)",
        category: "raw_materials",
        qty: "ceil(length*width / 32)",
        unit: "panels",
      },
      {
        label: "Circulation fan",
        equipmentType: "burner_heating",
        category: "electric",
        qty: "max(1, ceil(length*width*height / 500))",
        unit: "ea",
      },
      {
        label: "Burner assembly",
        equipmentType: "burner_heating",
        category: "electric",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Thermocouple (type J)",
        equipmentType: "pressure_vessel_part",
        category: "raw_materials",
        qty: "max(2, ceil(length/3))",
        unit: "ea",
      },
      {
        label: "PLC controller",
        equipmentType: "pcs_control",
        category: "it",
        qty: 1,
        unit: "ea",
      },
      {
        label: "HMI panel",
        equipmentType: "pcs_control",
        category: "it",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Door hardware set",
        category: "raw_materials",
        qty: 1,
        unit: "set",
      },
    ],
  },
  {
    key: "new_autoclave_build",
    label: "New autoclave build",
    blurb: "BOM for a new ASME-coded autoclave including vessel, door, heating, controls, and safety systems.",
    icon: "gauge",
    params: [
      { key: "diameter", label: "Diameter", kind: "number", unit: "ft", defaultValue: 6 },
      { key: "length", label: "Length", kind: "number", unit: "ft", defaultValue: 12 },
      {
        key: "workingPressure",
        label: "Working pressure",
        kind: "number",
        unit: "psi",
        defaultValue: 150,
      },
      {
        key: "maxTemp",
        label: "Max temperature",
        kind: "number",
        unit: "°F",
        defaultValue: 450,
      },
    ],
    parts: [
      {
        label: "Pressure vessel shell",
        category: "raw_materials",
        qty: 1,
        unit: "ea",
        notes: "SA-516 Gr70 rolled & welded",
      },
      {
        label: "Dished head (front)",
        category: "raw_materials",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Dished head (rear)",
        category: "raw_materials",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Quick-opening door mechanism",
        category: "raw_materials",
        qty: 1,
        unit: "set",
      },
      {
        label: "Door seal (silicone)",
        equipmentType: "pressure_vessel_part",
        category: "raw_materials",
        qty: 2,
        unit: "ea",
        notes: "1 installed + 1 spare",
      },
      {
        label: "B7 stud bolts",
        equipmentType: "asme_repair",
        category: "raw_materials",
        qty: "ceil(diameter * 6)",
        unit: "ea",
        notes: "Flange ring fasteners",
      },
      {
        label: "2H heavy hex nuts",
        equipmentType: "asme_repair",
        category: "raw_materials",
        qty: "ceil(diameter * 12)",
        unit: "ea",
        notes: "2 per stud",
      },
      {
        label: "Thermocouple (type J/K)",
        equipmentType: "pressure_vessel_part",
        category: "raw_materials",
        qty: "max(4, ceil(length / 2))",
        unit: "ea",
      },
      {
        label: "Pressure transducer",
        equipmentType: "pcs_control",
        category: "it",
        qty: 2,
        unit: "ea",
      },
      {
        label: "Safety relief valve",
        category: "raw_materials",
        qty: 2,
        unit: "ea",
        notes: "ASME UV stamped",
      },
      {
        label: "Vacuum pump",
        category: "electric",
        qty: 1,
        unit: "ea",
      },
      {
        label: "PLC controller",
        equipmentType: "pcs_control",
        category: "it",
        qty: 1,
        unit: "ea",
      },
      {
        label: "HMI panel",
        equipmentType: "pcs_control",
        category: "it",
        qty: 1,
        unit: "ea",
      },
    ],
  },
  {
    key: "annual_door_safety_check",
    label: "Annual door & safety check",
    blurb: "Yearly inspection and replacement checklist for autoclave/vessel doors, interlocks, and safety systems.",
    icon: "shield-check",
    params: [
      {
        key: "vesselSize",
        label: "Vessel size",
        kind: "select",
        options: ["Small (≤4ft)", "Medium (5–8ft)", "Large (>8ft)"],
        defaultValue: "Medium (5–8ft)",
      },
    ],
    parts: [
      {
        label: "Door seal (replacement)",
        equipmentType: "pressure_vessel_part",
        category: "raw_materials",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Door interlock switch",
        category: "electric",
        qty: 2,
        unit: "ea",
      },
      {
        label: "Limit switch",
        category: "electric",
        qty: 2,
        unit: "ea",
      },
      {
        label: "Pressure relief valve (inspect/replace)",
        category: "raw_materials",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Door hinge pins (inspect/replace)",
        category: "raw_materials",
        qty: 2,
        unit: "ea",
      },
      {
        label: "Safety signage set",
        category: "tools",
        qty: 1,
        unit: "set",
      },
    ],
  },
  {
    key: "field_dispatch",
    label: "Field service dispatch",
    blurb: "Pre-trip checklist for dispatching a service truck for on-site repairs.",
    icon: "truck",
    params: [
      {
        key: "issueType",
        label: "Issue type",
        kind: "select",
        options: [
          "Autoclave repair",
          "Oven repair",
          "Controls fault",
          "Press service",
          "Inspection",
          "General",
        ],
        defaultValue: "General",
      },
      { key: "truckId", label: "Truck ID", kind: "text", defaultValue: "" },
    ],
    parts: [
      {
        label: "Field service kit",
        equipmentType: "field_service_kit",
        category: "tools",
        qty: 1,
        unit: "kit",
      },
      {
        label: "Safety PPE set",
        category: "tools",
        qty: 1,
        unit: "set",
      },
      {
        label: "Multimeter",
        category: "tools",
        qty: 1,
        unit: "ea",
      },
      {
        label: "Torque wrench set",
        category: "tools",
        qty: 1,
        unit: "set",
      },
      {
        label: "Spare fuses (assorted)",
        category: "electric",
        qty: 1,
        unit: "pack",
      },
      {
        label: "Report forms / tablet",
        category: "tools",
        qty: 1,
        unit: "ea",
      },
    ],
  },
];
