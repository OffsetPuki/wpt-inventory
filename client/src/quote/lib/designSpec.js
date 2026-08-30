// =============================================================================
//  Design-spec parser — turns a website lead back into configurator state.
//
//  The website configurators serialize a human-readable spec (buildDetails()
//  in src/pages/customize/*.astro) like:
//
//      Custom design — Horizontal Slat
//      Style: Flat
//      Height: 6 ft
//      Panel width: 6 ft
//      Slat spacing: 1"
//      Finish: Matte Black
//      Posts: Flat
//
//  This module reverses that, tolerating both languages (fence + carport specs
//  are localized; gate + railing specs are always English) and partial matches
//  — anything it can't read is reported as a warning and left at the default.
// =============================================================================

import { defaultState } from '../data/configurators.js';
import { refTool } from './refs.js';

/** Lowercase, strip accents, collapse whitespace — so 'Elevación ' matches 'elevacion'. */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstNumber(s) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(s || '').replace(',', '.'));
  return m ? Number(m[0]) : undefined;
}

/** Build a matcher that maps any of the given phrases (EN/ES) to a value. */
function oneOf(map) {
  const table = Object.entries(map).flatMap(([value, phrases]) => phrases.map((p) => [norm(p), value]));
  return (raw) => {
    const n = norm(raw);
    for (const [phrase, value] of table) {
      if (n === phrase || n.startsWith(phrase)) return value;
    }
    return undefined;
  };
}

const COLOR = oneOf({
  '#0A0A0A': ['matte black', 'negro mate'],
  '#5C4A3A': ['bronze', 'bronce'],
  '#8A8A85': ['raw steel', 'acero crudo'],
  '#E8E6E0': ['white', 'blanco'], // railing's 4th swatch (carport roof handled separately)
});

// ---------------------------------------------------------------------------
//  Per-tool field tables: state key → accepted labels + value parser.
//  `head` parses the first spec line ("<prefix> — <headline>").
// ---------------------------------------------------------------------------

const FENCE_TYPE = oneOf({
  'horizontal-slat': ['horizontal slat', 'lineas horizontales', 'líneas horizontales'],
  'wood-mesh': ['wood + metal mesh', 'madera + malla'],
  'corrugated': ['corrugated metal', 'corrugated', 'metal corrugado', 'corrugado'],
});

// One entry per design in the website's TABLES list (customize/table.astro).
const TABLE_TYPE = oneOf({
  bar: ['bar table', 'mesa alta', 'bar'],
});

const TOOLS = {
  fence: {
    head: (headline) => ({ type: FENCE_TYPE(headline) }),
    fields: [
      { key: 'totalLengthFt', labels: ['total run length', 'largo total'], parse: firstNumber },
      { key: 'style', labels: ['style', 'estilo'], parse: oneOf({ flat: ['flat', 'plano'], arched: ['arched', 'arqueado'] }) },
      { key: 'height', labels: ['height', 'altura'], parse: firstNumber },
      { key: 'panelWidth', labels: ['panel width', 'ancho de panel'], parse: firstNumber },
      { key: 'meshRatio', labels: ['mesh / wood', 'malla / madera'], parse: firstNumber },
      { key: 'meshMaterial', labels: ['upper infill', 'relleno superior'], parse: oneOf({ corrugated: ['corrugated', 'corrugado'], mesh: ['metal mesh', 'mesh', 'malla'] }) },
      { key: 'slatSpacing', labels: ['slat spacing', 'espacio entre lamas'], parse: firstNumber },
      { key: 'color', labels: ['finish', 'acabado'], parse: COLOR },
      { key: 'topEdge', labels: ['posts', 'postes'], parse: oneOf({ flat: ['flat', 'plano'], capped: ['capped', 'con tapa'] }) },
    ],
  },

  gate: {
    // Gate specs are always English ("Custom design — Custom Gate").
    head: () => ({}),
    fields: [
      { key: 'type', labels: ['type'], parse: oneOf({ single: ['single swing'], double: ['double swing'], slide: ['sliding'] }) },
      { key: 'infill', labels: ['style'], parse: oneOf({ 'horizontal-slat': ['horizontal slat'], 'metal-wood': ['metal + wood'], 'corrugated': ['corrugated metal', 'corrugated', 'metal corrugado', 'corrugado'] }) },
      {
        key: 'mesh', labels: ['mesh'],
        parse: (raw) => (norm(raw).startsWith('yes') ? 'yes' : norm(raw).startsWith('no') ? 'no' : undefined),
        also: (raw, state) => { if (norm(raw).startsWith('yes')) { const n = firstNumber(raw); if (n != null) state.meshRatio = n; } },
      },
      { key: 'woodDir', labels: ['wood grain'], parse: oneOf({ horizontal: ['horizontal'], vertical: ['vertical'] }) },
      { key: 'arch', labels: ['top shape'], parse: oneOf({ arched: ['arched'], flat: ['straight', 'flat'] }) },
      {
        key: 'width', labels: ['size'], parse: firstNumber,
        also: (raw, state) => {
          const nums = String(raw).match(/\d+(?:\.\d+)?/g) || [];
          if (nums[1] != null) state.height = Number(nums[1]); // "10 ft wide × 6 ft tall"
        },
      },
      { key: 'color', labels: ['finish'], parse: COLOR },
      { key: 'topEdge', labels: ['top edge'], parse: oneOf({ flat: ['flat top', 'flat'], capped: ['capped top', 'capped'] }) },
      // Website upsell: 'Initials "JMR"' / 'Custom image (...)' — the letters
      // themselves stay visible in the lead's raw spec text.
      { key: 'personalization', labels: ['personalization'], parse: oneOf({ initials: ['initials'], image: ['custom image', 'image'], none: ['none'] }) },
    ],
  },

  carport: {
    // Headline: "<prefix> — <Gable|Flat|Lean-to> Carport" (localized).
    head: (headline) => ({
      roof: oneOf({
        gable: ['gable', 'dos aguas'],
        'lean-to': ['lean-to', 'un agua'],
        flat: ['flat', 'plano'],
      })(headline),
    }),
    fields: [
      { key: 'mounting', labels: ['mounting', 'montaje'], parse: oneOf({ freestanding: ['free-standing', 'freestanding', 'independiente'], attached: ['attached', 'adosada'] }) },
      {
        key: 'width', labels: ['size', 'tamano'], parse: firstNumber,
        also: (raw, state) => {
          const nums = String(raw).match(/\d+(?:\.\d+)?/g) || [];
          if (nums[1] != null) state.depth = Number(nums[1]); // "20 ft wide × 20 ft deep"
        },
      },
      { key: 'height', labels: ['clearance', 'altura libre'], parse: firstNumber },
      { key: 'pitch', labels: ['roof pitch', 'pendiente'], parse: firstNumber },
      { key: 'elevation', labels: ['roof elevation', 'elevacion'], parse: firstNumber },
      { key: 'panel', labels: ['panel'], parse: oneOf({ corrugated: ['corrugated', 'corrugado'], 'standing-seam': ['standing seam', 'junta alzada'], polycarbonate: ['polycarbonate', 'policarbonato'] }) },
      {
        key: 'sides', labels: ['sides', 'laterales'],
        parse: oneOf({ open: ['open', 'abierto'], one: ['one side', 'un lado'], two: ['two sides', 'dos lados'] }),
        also: (raw, state) => {
          const pos = oneOf({ left: ['left', 'izquierdo'], right: ['right', 'derecho'] })(String(raw).replace(/^[^(]*\(/, '').replace(/\)\s*$/, ''));
          if (pos) state.sidePos = pos;
        },
      },
      { key: 'gutters', labels: ['gutters', 'canaletas'], parse: oneOf({ yes: ['yes', 'si'], no: ['no'] }) },
      { key: 'color', labels: ['frame finish', 'acabado estructura'], parse: COLOR },
      {
        key: 'roofColor', labels: ['roof finish', 'acabado techo'],
        parse: oneOf({ '#A7A8A4': ['galvalume', 'galvanizado'], '#1C1C1A': ['matte black', 'negro mate'], '#E9E7E1': ['white', 'blanco'] }),
      },
    ],
  },

  pergola: {
    head: () => ({}), // rectangular only — nothing to read from the headline
    fields: [
      // Website labels: 'Standard'/'Designer'/'Side Screens' (EN),
      // 'Estándar'/'De diseño'/'Con laterales' (ES)
      { key: 'legs', labels: ['legs', 'patas'], parse: oneOf({ sides: ['side screens', 'con laterales', 'sides'], designer: ['designer', 'de diseno', 'diseno'], standard: ['standard', 'estandar'] }) },
      {
        key: 'width', labels: ['size', 'tamano'], parse: firstNumber,
        also: (raw, state) => {
          const nums = String(raw).match(/\d+(?:\.\d+)?/g) || [];
          if (nums[1] != null) state.depth = Number(nums[1]); // "12 ft × 10 ft"
        },
      },
      { key: 'height', labels: ['head clearance', 'clearance', 'altura libre'], parse: firstNumber },
      { key: 'shade', labels: ['roof', 'techo'], parse: oneOf({ open: ['open', 'rejilla'], panels: ['shade', 'panel'] }) },
      { key: 'color', labels: ['frame finish', 'acabado estructura'], parse: COLOR },
    ],
  },

  // Website spec (customize/table.astro), EN + ES:
  //   Custom design — Table: Bar Table (frame only)
  //   Type: Bar Table                  |  Tipo: Mesa Alta
  //   Top size: 6 ft × 24 in           |  Cubierta: 6 ft × 24 in
  //   Steel base: 6 ft 2 in × 27 in    |  Base de acero: …      (derived — skipped)
  //   Height: 42 in overall · 40 in frame | Altura: 42 in en total · base de 40 in
  //   Finish: Matte Black              |  Acabado: Negro Mate
  //   Scope: Customer supplies the wood top
  table: {
    // Headline: "Table: Bar Table (frame only)" / "Mesa: Mesa Alta (solo la base)".
    // Strip the leading noun and the trailing scope note down to the design
    // name itself, since oneOf() only matches from the start of the string.
    head: (headline) => {
      const name = String(headline).split(':').slice(1).join(':').replace(/\(.*$/, '').trim();
      return { tableType: TABLE_TYPE(name || headline) };
    },
    fields: [
      { key: 'tableType', labels: ['type', 'tipo'], parse: TABLE_TYPE },
      {
        key: 'lengthFt', labels: ['top size', 'cubierta'], parse: firstNumber,
        also: (raw, state) => {
          const nums = String(raw).match(/\d+(?:\.\d+)?/g) || [];
          if (nums[1] != null) state.widthIn = Number(nums[1]); // "6 ft × 24 in"
        },
      },
      {
        key: 'frameHeightIn', labels: ['height', 'altura'],
        // "42 in overall · 40 in frame" — the FRAME number is what we build to,
        // not the leading overall figure firstNumber would grab.
        parse: (raw) => {
          const n = norm(raw);
          const m = /(\d+(?:\.\d+)?)\s*in\s*frame/.exec(n) || /base de\s*(\d+(?:\.\d+)?)/.exec(n);
          return m ? Number(m[1]) : firstNumber(raw);
        },
        also: (raw, state) => {
          // overall − frame = the top thickness the customer is planning on
          const nums = (String(raw).match(/\d+(?:\.\d+)?/g) || []).map(Number);
          if (nums.length >= 2) {
            const thick = Math.max(...nums) - Number(state.frameHeightIn);
            if (thick > 0 && thick <= 6) state.topThicknessIn = thick;
          }
        },
      },
      { key: 'color', labels: ['finish', 'acabado'], parse: COLOR },
    ],
  },

  railing: {
    // Railing specs are always English ("Custom design — Custom Railing").
    head: () => ({}),
    fields: [
      {
        key: 'app', labels: ['application'],
        parse: oneOf({ stairs: ['stair railing'], balcony: ['balcony, deck or porch railing', 'balcony'], handrail: ['wall handrail'] }),
      },
      {
        key: 'infill', labels: ['infill'],
        parse: oneOf({ pickets: ['vertical pickets'], horizontal: ['horizontal bars'], cable: ['cable-look'], glass: ['glass panels'], ornamental: ['ornamental'] }),
      },
      { key: 'spacing', labels: ['baluster spacing'], parse: oneOf({ wide: ['wide'], standard: ['standard'] }) },
      { key: 'toprail', labels: ['top rail'], parse: oneOf({ flat: ['flat bar'], round: ['round'], wood: ['wood cap'] }) },
      { key: 'height', labels: ['height'], parse: firstNumber },
      // Newer website specs carry a real "Length: 24 ft"; older leads say
      // "Length: To be determined on site walkthrough" — no number → the line
      // surfaces as a warning, which is exactly the "measure on site" reminder.
      { key: 'lengthFt', labels: ['length'], parse: firstNumber },
      { key: 'mounting', labels: ['mounting'], parse: oneOf({ surface: ['surface'], fascia: ['side / fascia', 'fascia'] }) },
      { key: 'color', labels: ['finish'], parse: COLOR },
    ],
  },
};

const SERVICE_TO_TOOL = oneOf({
  fence: ['fence', 'cerca'],
  gate: ['gate', 'porton', 'portón'],
  carport: ['carport', 'cochera'],
  railing: ['railing', 'barandal'],
  pergola: ['pergola'], // norm() strips the accent, so 'Pérgola' matches too
  table: ['table', 'mesa'],
  // Sister-shop service words. Listed AFTER the metals entries so a shared
  // prefix always resolves to the metals tool first (oneOf matches in order).
  concrete: ['concrete', 'driveway', 'patio', 'walkway', 'slab', 'flatwork', 'concreto', 'losa', 'banqueta', 'entrada de auto'],
  insulation: ['insulation', 'pipe', 'tank', 'autoclave', 'blanket', 'aislamiento', 'aislante', 'tuberia', 'tubería'],
});

// ---------------------------------------------------------------------------
//  Sister-site designState envelopes. The concrete/insulation calculators send
//  their estimateState VERBATIM ('{"type":"concrete-calculator","ref":"CJC-…",
//  "state":{…},"result":{…}}'); the trades planner sends its planState
//  ('{"type":"trades-planner","ref":"CJT-…","ids":[…],…}'). Each maps onto a
//  suite build type with invalid values clamped to the configurator defaults.
// ---------------------------------------------------------------------------

/** Number in range, else undefined (→ the default survives the overlay). */
function inRange(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}
const pick = (list, v) => (list.includes(v) ? v : undefined);
const yesNo = (v) => (v === true || v === 'yes' ? 'yes' : v === false || v === 'no' ? 'no' : undefined);

/** Overlay only the defined entries of `patch` onto the type's defaults. */
function overlayDefaults(type, patch) {
  const state = defaultState(type);
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) state[k] = v;
  return state;
}

function concreteFromEnvelope(s) {
  return overlayDefaults('concrete', {
    project: pick(['driveway', 'patio', 'slab', 'walkway'], s.project),
    lengthFt: inRange(s.lengthFt, 1, 500),
    widthFt: inRange(s.widthFt, 1, 500),
    thickness: pick([4, 5, 6, 8], Number(s.thickness)),
    finish: pick(['broom', 'smooth', 'aggregate', 'stamped', 'stained', 'salt'], s.finish),
    demo: yesNo(s.demo),
    rebar: yesNo(s.rebar),
  });
}

function insulationFromEnvelope(s) {
  return overlayDefaults('insulation', {
    system: pick(['pipe', 'tank', 'autoclave', 'blanket'], s.system),
    tempF: inRange(s.tempF, 120, 1200),
    nps: pick(['1', '2', '3', '4', '6', '8', '12'], String(s.nps)),
    lengthFt: inRange(s.lengthFt, 1, 5000),
    diaFt: inRange(s.diaFt, 1, 40),
    // The site's client state calls the vessel shell dimension shellFt.
    heightFt: inRange(s.heightFt ?? s.shellFt, 2, 200),
    count: inRange(s.count, 1, 500),
    thickness: pick([1, 1.5, 2, 3, 4], Number(s.thickness)),
    material: pick(['fiberglass', 'mineralwool', 'calsil', 'aerogel'], s.material),
    jacket: pick(['aluminum', 'stainless', 'pvc', 'none'], s.jacket),
  });
}

/** Which configurator a lead belongs to — from source, then ref, then service. */
export function leadTool(lead) {
  const m = /^configurator-(\w+)/.exec(lead?.source || '');
  if (m && TOOLS[m[1]]) return m[1];
  const fromRef = refTool(lead?.ref);
  if (fromRef) return fromRef;
  return SERVICE_TO_TOOL(lead?.service) || null;
}

/**
 * Parse a lead into { type, state, warnings, hasSpec, notes? }.
 * - type: any QUOTE_TYPES member (concrete/insulation from the sister sites'
 *   envelopes; a trades plan lands as 'custom') — or null (can't tell)
 * - state: defaultState(type) overlaid with everything the spec yielded
 * - warnings: spec lines that were present but couldn't be read
 * - notes: text the builder should seed the session notes with (trades plans)
 * Returns null when the lead can't be mapped to a configurator at all.
 */
export function parseLead(lead) {
  // Preferred path: the website now sends the configurator's raw state as
  // JSON ('{"type":"fence","state":{...}}') alongside the prose spec — same
  // object its live-ballpark POST uses, so no reverse-parsing and no
  // localization drift. Overlaid on defaults so missing fields stay sane.
  // The prose parser below remains the fallback for pre-designState rows.
  const rawState = String(lead?.designState || '').trim();
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState);
      if (parsed && TOOLS[parsed.type] && parsed.state && typeof parsed.state === 'object') {
        return {
          type: parsed.type,
          state: { ...defaultState(parsed.type), ...parsed.state },
          warnings: [],
          hasSpec: true,
        };
      }
      // Sister-site envelopes: the concrete/insulation calculators' verbatim
      // estimateState, and the trades planner's planState.
      if (parsed && parsed.type === 'concrete-calculator' && parsed.state && typeof parsed.state === 'object') {
        return { type: 'concrete', state: concreteFromEnvelope(parsed.state), warnings: [], hasSpec: true };
      }
      if (parsed && parsed.type === 'insulation-calculator' && parsed.state && typeof parsed.state === 'object') {
        return { type: 'insulation', state: insulationFromEnvelope(parsed.state), warnings: [], hasSpec: true };
      }
      if (parsed && parsed.type === 'trades-planner') {
        // A trades plan is a multi-trade scope and the parent site publishes
        // no prices — Custom is the honest type. The plan's prose spec rides
        // into the session notes so the scope lands on the quote screen.
        const title = `Multi-trade plan${typeof parsed.ref === 'string' && parsed.ref ? ` — ${parsed.ref}` : ''}`;
        return {
          type: 'custom',
          state: { ...defaultState('custom'), title },
          warnings: [],
          hasSpec: false,
          notes: String(lead?.designSpec || '').trim(),
        };
      }
    } catch {
      /* malformed JSON — fall through to the prose parser */
    }
  }

  const type = leadTool(lead);
  if (!type) return null;

  const tool = TOOLS[type];
  // Sister-shop leads (concrete/insulation via ref or service words) have no
  // prose field table — their real import path is the designState envelope
  // above. Without one, start the right build type at its defaults.
  if (!tool) return { type, state: defaultState(type), warnings: [], hasSpec: false };
  const state = defaultState(type);
  const warnings = [];
  const spec = String(lead?.designSpec || '').trim();

  if (spec) {
    const lines = spec.split('\n').map((l) => l.trim()).filter(Boolean);

    // Headline: "Custom design — Horizontal Slat" / "Diseño personalizado — ..."
    const headIdx = lines.findIndex((l) => l.includes('—'));
    if (headIdx !== -1) {
      const headline = lines[headIdx].split('—').slice(1).join('—').trim();
      const patch = tool.head(headline) || {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) state[k] = v;
        else warnings.push(`Couldn't read “${lines[headIdx]}”`);
      }
    }

    for (const line of lines) {
      const ci = line.indexOf(':');
      if (ci === -1) continue;
      const label = norm(line.slice(0, ci));
      const raw = line.slice(ci + 1).trim();
      const field = tool.fields.find((f) => f.labels.some((l) => norm(l) === label));
      if (!field) {
        // Lines the app doesn't price from (e.g. carport "Capacity", railing "Length: TBD") are fine.
        continue;
      }
      const value = field.parse(raw);
      if (value !== undefined) {
        state[field.key] = value;
        if (field.also) field.also(raw, state);
      } else {
        warnings.push(`Couldn't read “${line}”`);
      }
    }
  }

  return { type, state, warnings, hasSpec: Boolean(spec) };
}
