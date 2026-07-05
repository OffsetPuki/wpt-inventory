// =============================================================================
//  Configurator option schemas — fence / gate / carport / railing.
//
//  These mirror the "Design your own" configurators on the CJM website so the
//  shop tool speaks the exact same language the customer used. Each control is
//  declarative so the UI renders generically and the SAME `state` object drives
//  both the live SVG preview (lib/preview/*) and the price estimate (lib/estimate).
//
//  Control shape:
//    { kind, name, label, visibleWhen?(state), ...kindFields }
//      kind 'segment' : options:[{value,label}], cols
//      kind 'swatch'  : options:[{value,label}]  (value is a hex color)
//      kind 'range'   : min, max, step, display(value,state)
//      kind 'number'  : min, max, step, unit
// =============================================================================

// Frame / metal finishes (shared by all three types).
export const FINISHES = [
  { value: '#0A0A0A', label: 'Matte Black' },
  { value: '#5C4A3A', label: 'Bronze' },
  { value: '#8A8A85', label: 'Raw Steel' },
];

// Roof finishes (carport only).
export const ROOF_FINISHES = [
  { value: '#A7A8A4', label: 'Galvalume' },
  { value: '#1C1C1A', label: 'Matte Black' },
  { value: '#E9E7E1', label: 'White' },
];

// Railing finishes — the website's railing tool adds White to the shared three.
export const RAILING_FINISHES = [
  ...FINISHES,
  { value: '#E8E6E0', label: 'White' },
];

export function finishLabel(hex) {
  return (FINISHES.find((f) => f.value === hex)
    || ROOF_FINISHES.find((f) => f.value === hex)
    || RAILING_FINISHES.find((f) => f.value === hex)
    || { label: hex }).label;
}

// Rough car capacity from span (matches the website readout).
export function carCount(w) {
  if (w < 16) return 1;
  if (w < 28) return 2;
  return 3;
}

// -----------------------------------------------------------------------------
//  Build types
// -----------------------------------------------------------------------------

export const TYPES = [
  { key: 'fence',   label: 'Fence',   tagline: 'Perimeter fencing, by the run' },
  { key: 'gate',    label: 'Gate',    tagline: 'Swing or sliding entry gate' },
  { key: 'carport', label: 'Carport', tagline: 'Free-standing or attached cover' },
  { key: 'railing', label: 'Railing', tagline: 'Stairs, balconies & handrails' },
];

const ftDisplay = (v) => `${v} ft`;

export const CONFIG = {
  // ---- Fence ----------------------------------------------------------------
  fence: {
    defaults: {
      totalLengthFt: 40,
      type: 'horizontal-slat',
      height: 6,
      panelWidth: 6,
      slatSpacing: 1,
      style: 'flat',
      meshRatio: 25,
      color: '#0A0A0A',
      topEdge: 'flat',
    },
    controls: [
      { kind: 'number', name: 'totalLengthFt', label: 'Total run length', unit: 'ft', min: 4, max: 1000, step: 1 },
      {
        kind: 'segment', name: 'type', label: 'Type', cols: 2,
        options: [
          { value: 'horizontal-slat', label: 'Horizontal Slat' },
          { value: 'wood-mesh', label: 'Wood + Metal Mesh' },
        ],
      },
      { kind: 'range', name: 'height', label: 'Height', min: 3, max: 8, step: 1, display: ftDisplay },
      {
        kind: 'segment', name: 'panelWidth', label: 'Panel width', cols: 3,
        options: [4, 6, 8].map((w) => ({ value: w, label: `${w} ft` })),
      },
      {
        kind: 'number', name: 'slatSpacing', label: 'Slat spacing', unit: '"', min: 0.5, max: 12, step: 0.25,
        visibleWhen: (s) => s.type === 'horizontal-slat',
      },
      {
        kind: 'segment', name: 'style', label: 'Top profile', cols: 2,
        options: [{ value: 'flat', label: 'Flat' }, { value: 'arched', label: 'Arched' }],
        visibleWhen: (s) => s.type === 'wood-mesh',
      },
      {
        kind: 'range', name: 'meshRatio', label: 'Mesh portion', min: 25, max: 75, step: 5,
        display: (v) => `${v}% mesh · ${100 - v}% wood`,
        visibleWhen: (s) => s.type === 'wood-mesh',
      },
      { kind: 'swatch', name: 'color', label: 'Finish', options: FINISHES },
      {
        kind: 'segment', name: 'topEdge', label: 'Top edge', cols: 2,
        options: [{ value: 'flat', label: 'Flat' }, { value: 'capped', label: 'Capped' }],
      },
    ],
  },

  // ---- Gate -----------------------------------------------------------------
  gate: {
    defaults: {
      type: 'single',
      infill: 'horizontal-slat',
      arch: 'flat',
      mesh: 'no',
      woodDir: 'horizontal',
      height: 6,
      width: 10,
      meshRatio: 25,
      color: '#0A0A0A',
      topEdge: 'flat',
    },
    controls: [
      {
        kind: 'segment', name: 'type', label: 'Gate type', cols: 3,
        options: [
          { value: 'single', label: 'Single Swing' },
          { value: 'double', label: 'Double Swing' },
          { value: 'slide', label: 'Sliding' },
        ],
      },
      {
        kind: 'segment', name: 'infill', label: 'Style', cols: 2,
        options: [
          { value: 'horizontal-slat', label: 'Horizontal Slat' },
          { value: 'metal-wood', label: 'Metal + Wood' },
        ],
      },
      {
        kind: 'segment', name: 'arch', label: 'Top shape', cols: 2,
        options: [{ value: 'flat', label: 'Flat' }, { value: 'arched', label: 'Arched' }],
      },
      { kind: 'range', name: 'height', label: 'Height', min: 4, max: 10, step: 1, display: ftDisplay },
      { kind: 'range', name: 'width', label: 'Width', min: 3, max: 20, step: 1, display: ftDisplay },
      {
        kind: 'segment', name: 'woodDir', label: 'Wood grain', cols: 2,
        options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }],
        visibleWhen: (s) => s.infill === 'metal-wood',
      },
      {
        kind: 'segment', name: 'mesh', label: 'Add mesh', cols: 2,
        options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
        visibleWhen: (s) => s.infill === 'metal-wood',
      },
      {
        kind: 'range', name: 'meshRatio', label: 'Mesh portion', min: 25, max: 75, step: 5,
        display: (v) => `${v}% mesh · ${100 - v}% wood`,
        visibleWhen: (s) => s.infill === 'metal-wood' && s.mesh === 'yes',
      },
      { kind: 'swatch', name: 'color', label: 'Finish', options: FINISHES },
      {
        kind: 'segment', name: 'topEdge', label: 'Top edge', cols: 2,
        options: [{ value: 'flat', label: 'Flat' }, { value: 'capped', label: 'Capped' }],
      },
    ],
  },

  // ---- Carport --------------------------------------------------------------
  carport: {
    defaults: {
      roof: 'gable',
      mounting: 'freestanding',
      width: 20,
      depth: 20,
      height: 9,
      pitch: 3,
      elevation: 15,
      panel: 'corrugated',
      sides: 'open',
      sidePos: 'right',
      gutters: 'no',
      color: '#0A0A0A',
      roofColor: '#A7A8A4',
    },
    controls: [
      {
        kind: 'segment', name: 'roof', label: 'Roof style', cols: 3,
        options: [
          { value: 'gable', label: 'Gable' },
          { value: 'flat', label: 'Flat' },
          { value: 'lean-to', label: 'Lean-to' },
        ],
      },
      {
        kind: 'segment', name: 'mounting', label: 'Mounting', cols: 2,
        options: [
          { value: 'freestanding', label: 'Free-standing' },
          { value: 'attached', label: 'Attached' },
        ],
      },
      {
        kind: 'range', name: 'width', label: 'Width (span)', min: 10, max: 40, step: 1,
        display: (v) => `${v} ft · ${carCount(v)} ${carCount(v) === 1 ? 'car' : 'cars'}`,
      },
      { kind: 'range', name: 'depth', label: 'Depth', min: 16, max: 40, step: 2, display: ftDisplay },
      { kind: 'range', name: 'height', label: 'Clearance', min: 7, max: 14, step: 1, display: ftDisplay },
      {
        kind: 'range', name: 'pitch', label: 'Roof pitch', min: 1, max: 6, step: 1,
        display: (v) => `${v}:12`, visibleWhen: (s) => s.roof === 'gable',
      },
      {
        kind: 'range', name: 'elevation', label: 'Roof elevation', min: 5, max: 30, step: 1,
        display: (v) => `${v}°`, visibleWhen: (s) => s.roof === 'lean-to',
      },
      {
        kind: 'segment', name: 'panel', label: 'Roof panel', cols: 3,
        options: [
          { value: 'corrugated', label: 'Corrugated' },
          { value: 'standing-seam', label: 'Standing Seam' },
          { value: 'polycarbonate', label: 'Polycarbonate' },
        ],
      },
      {
        kind: 'segment', name: 'sides', label: 'Sides', cols: 3,
        options: [
          { value: 'open', label: 'Open' },
          { value: 'one', label: 'One side' },
          { value: 'two', label: 'Two sides' },
        ],
      },
      {
        kind: 'segment', name: 'sidePos', label: 'Side position', cols: 2,
        options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
        visibleWhen: (s) => s.sides === 'one',
      },
      {
        kind: 'segment', name: 'gutters', label: 'Gutters', cols: 2,
        options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
      },
      { kind: 'swatch', name: 'color', label: 'Frame finish', options: FINISHES },
      { kind: 'swatch', name: 'roofColor', label: 'Roof finish', options: ROOF_FINISHES },
    ],
  },

  // ---- Railing ----------------------------------------------------------------
  // The website's railing tool has no length input ("measured on site walkthrough")
  // and previews a representative 12 ft. Here the run length is a pricing input;
  // it defaults to 12 so a looked-up design first renders exactly what the
  // customer saw.
  railing: {
    defaults: {
      lengthFt: 12,
      app: 'balcony',
      infill: 'pickets',
      spacing: 'standard',
      toprail: 'flat',
      height: 36,
      mounting: 'surface',
      color: '#0A0A0A',
    },
    controls: [
      { kind: 'number', name: 'lengthFt', label: 'Total run length', unit: 'ft', min: 3, max: 500, step: 1 },
      {
        kind: 'segment', name: 'app', label: 'Application', cols: 3,
        options: [
          { value: 'balcony', label: 'Balcony · Deck' },
          { value: 'stairs', label: 'Stairs' },
          { value: 'handrail', label: 'Wall handrail' },
        ],
      },
      {
        kind: 'segment', name: 'infill', label: 'Infill', cols: 3,
        options: [
          { value: 'pickets', label: 'Pickets' },
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'cable', label: 'Cable-look' },
          { value: 'glass', label: 'Glass' },
          { value: 'ornamental', label: 'Ornamental' },
        ],
        visibleWhen: (s) => s.app !== 'handrail',
      },
      {
        kind: 'segment', name: 'spacing', label: 'Baluster spacing', cols: 2,
        options: [
          { value: 'standard', label: 'Standard (4")' },
          { value: 'wide', label: 'Wide (5")' },
        ],
        visibleWhen: (s) => s.app !== 'handrail' && s.infill === 'pickets',
      },
      {
        kind: 'segment', name: 'toprail', label: 'Top rail', cols: 3,
        options: [
          { value: 'flat', label: 'Flat bar' },
          { value: 'round', label: 'Round' },
          { value: 'wood', label: 'Wood cap' },
        ],
      },
      { kind: 'range', name: 'height', label: 'Height', min: 34, max: 48, step: 1, display: (v) => `${v} in` },
      {
        kind: 'segment', name: 'mounting', label: 'Mounting', cols: 2,
        options: [
          { value: 'surface', label: 'Surface' },
          { value: 'fascia', label: 'Side / fascia' },
        ],
        visibleWhen: (s) => s.app !== 'handrail',
      },
      { kind: 'swatch', name: 'color', label: 'Finish', options: RAILING_FINISHES },
    ],
  },
};

export function typeLabel(type) {
  return (TYPES.find((t) => t.key === type) || {}).label || 'Custom';
}

/** The visible label for a control option value (e.g. 'single' → 'Single Swing'). */
export function optionLabel(type, name, value) {
  const ctrl = (CONFIG[type]?.controls || []).find((c) => c.name === name);
  if (!ctrl || !ctrl.options) return String(value ?? '');
  const opt = ctrl.options.find((o) => String(o.value) === String(value));
  return opt ? opt.label : String(value ?? '');
}

/** Default state for a build type (a fresh copy). */
export function defaultState(type) {
  return { ...(CONFIG[type]?.defaults || {}) };
}

/** Controls visible for the given state (respects visibleWhen). */
export function visibleControls(type, state) {
  return (CONFIG[type]?.controls || []).filter((c) => !c.visibleWhen || c.visibleWhen(state));
}

/** One-line human summary of a configuration (preview header + PDF spec line). */
export function summaryLine(type, s) {
  const fin = finishLabel(s.color);
  if (type === 'fence') {
    const t = optionLabel('fence', 'type', s.type);
    const arch = s.type === 'wood-mesh' && s.style === 'arched' ? '⌒ ' : '';
    return `${t} · ${s.totalLengthFt} ft run · ${arch}${s.height} ft tall · ${fin}`;
  }
  if (type === 'gate') {
    const t = optionLabel('gate', 'type', s.type);
    const inf = optionLabel('gate', 'infill', s.infill);
    const meshTag = s.infill === 'metal-wood' && s.mesh === 'yes' ? ' + mesh' : '';
    const arch = s.arch === 'arched' ? '⌒ ' : '';
    return `${t} · ${inf}${meshTag} · ${arch}${s.width}×${s.height} ft · ${fin}`;
  }
  if (type === 'railing') {
    const app = optionLabel('railing', 'app', s.app);
    const inf = s.app === 'handrail' ? '' : ` · ${optionLabel('railing', 'infill', s.infill)}`;
    return `${app}${inf} · ${s.lengthFt} ft · ${s.height} in · ${fin}`;
  }
  // carport
  const roof = optionLabel('carport', 'roof', s.roof);
  return `${roof} · ${s.width}×${s.depth} ft · ${s.height} ft clearance · ${fin}`;
}

/** Spec rows for the printable quote (label / value pairs). */
export function specRows(type, s) {
  const fin = finishLabel(s.color);
  if (type === 'fence') {
    const rows = [
      ['Style', optionLabel('fence', 'type', s.type)],
      ['Total run length', `${s.totalLengthFt} ft`],
      ['Height', `${s.height} ft`],
      ['Panel width', `${s.panelWidth} ft`],
    ];
    if (s.type === 'horizontal-slat') rows.push(['Slat spacing', `${s.slatSpacing}"`]);
    if (s.type === 'wood-mesh') {
      rows.push(['Top profile', optionLabel('fence', 'style', s.style)]);
      rows.push(['Mesh / wood', `${s.meshRatio}% / ${100 - s.meshRatio}%`]);
    }
    rows.push(['Finish', fin]);
    rows.push(['Posts', optionLabel('fence', 'topEdge', s.topEdge) + ' top']);
    return rows.map(([label, value]) => ({ label, value }));
  }
  if (type === 'gate') {
    const rows = [
      ['Type', optionLabel('gate', 'type', s.type)],
      ['Style', optionLabel('gate', 'infill', s.infill)],
      ['Top shape', optionLabel('gate', 'arch', s.arch)],
      ['Size', `${s.width} ft wide × ${s.height} ft tall`],
    ];
    if (s.infill === 'metal-wood') {
      rows.push(['Wood grain', optionLabel('gate', 'woodDir', s.woodDir)]);
      rows.push(['Mesh', s.mesh === 'yes' ? `Yes — ${s.meshRatio}% / ${100 - s.meshRatio}%` : 'No']);
    }
    rows.push(['Finish', fin]);
    rows.push(['Top edge', optionLabel('gate', 'topEdge', s.topEdge)]);
    return rows.map(([label, value]) => ({ label, value }));
  }
  if (type === 'railing') {
    const isHand = s.app === 'handrail';
    const rows = [
      ['Application', optionLabel('railing', 'app', s.app)],
      ['Total run length', `${s.lengthFt} ft`],
      ['Height', `${s.height} in`],
    ];
    if (!isHand) {
      rows.push(['Infill', optionLabel('railing', 'infill', s.infill)]);
      if (s.infill === 'pickets') rows.push(['Baluster spacing', optionLabel('railing', 'spacing', s.spacing)]);
      rows.push(['Mounting', optionLabel('railing', 'mounting', s.mounting)]);
    }
    rows.push(['Top rail', optionLabel('railing', 'toprail', s.toprail)]);
    rows.push(['Finish', fin]);
    return rows.map(([label, value]) => ({ label, value }));
  }
  // carport
  const cars = carCount(s.width);
  const rows = [
    ['Roof', optionLabel('carport', 'roof', s.roof)],
    ['Mounting', optionLabel('carport', 'mounting', s.mounting)],
    ['Size', `${s.width} ft wide × ${s.depth} ft deep`],
    ['Capacity', `${cars} ${cars === 1 ? 'car' : 'cars'}`],
    ['Clearance', `${s.height} ft`],
  ];
  if (s.roof === 'gable') rows.push(['Roof pitch', `${s.pitch}:12`]);
  if (s.roof === 'lean-to') rows.push(['Roof elevation', `${s.elevation}°`]);
  rows.push(['Roof panel', optionLabel('carport', 'panel', s.panel)]);
  const sides = optionLabel('carport', 'sides', s.sides);
  rows.push(['Sides', s.sides === 'one' ? `${sides} (${optionLabel('carport', 'sidePos', s.sidePos)})` : sides]);
  rows.push(['Gutters', s.gutters === 'yes' ? 'Yes' : 'No']);
  rows.push(['Frame finish', fin]);
  rows.push(['Roof finish', finishLabel(s.roofColor)]);
  return rows.map(([label, value]) => ({ label, value }));
}
