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
import { refTool } from './leads.js';

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
      { key: 'infill', labels: ['style'], parse: oneOf({ 'horizontal-slat': ['horizontal slat'], 'metal-wood': ['metal + wood'] }) },
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
    // Headline: "<prefix> — <Rectangular|Hexagonal> Pergola" (localized, either
    // word order). The Style line below is authoritative; this is a fallback.
    head: (headline) => {
      const n = norm(headline);
      return { style: n.includes('hexagon') ? 'hexagonal' : n.includes('rectangul') ? 'rectangular' : undefined };
    },
    fields: [
      { key: 'style', labels: ['style', 'estilo'], parse: oneOf({ hexagonal: ['hexagonal'], rectangular: ['rectangular'] }) },
      // Website labels: 'Standard'/'Designer'/'Side Screens' (EN),
      // 'Estándar'/'De diseño'/'Con laterales' (ES)
      { key: 'legs', labels: ['legs', 'patas'], parse: oneOf({ sides: ['side screens', 'con laterales', 'sides'], designer: ['designer', 'de diseno', 'diseno'], standard: ['standard', 'estandar'] }) },
      {
        key: 'width', labels: ['size', 'tamano'], parse: firstNumber,
        also: (raw, state) => {
          const nums = String(raw).match(/\d+(?:\.\d+)?/g) || [];
          if (nums[1] != null) state.depth = Number(nums[1]); // "12 ft × 10 ft" (hex specs carry one number)
        },
      },
      { key: 'height', labels: ['head clearance', 'clearance', 'altura libre'], parse: firstNumber },
      { key: 'shade', labels: ['roof', 'techo'], parse: oneOf({ open: ['open', 'rejilla'], panels: ['shade', 'panel'] }) },
      { key: 'color', labels: ['frame finish', 'acabado estructura'], parse: COLOR },
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
});

/** Which configurator a lead belongs to — from source, then ref, then service. */
export function leadTool(lead) {
  const m = /^configurator-(\w+)/.exec(lead?.source || '');
  if (m && TOOLS[m[1]]) return m[1];
  const fromRef = refTool(lead?.ref);
  if (fromRef) return fromRef;
  return SERVICE_TO_TOOL(lead?.service) || null;
}

/**
 * Parse a lead into { type, state, warnings, hasSpec }.
 * - type: 'fence' | 'gate' | 'carport' | 'railing' | null (can't tell)
 * - state: defaultState(type) overlaid with everything the spec yielded
 * - warnings: spec lines that were present but couldn't be read
 * Returns null when the lead can't be mapped to a configurator at all.
 */
export function parseLead(lead) {
  const type = leadTool(lead);
  if (!type) return null;

  const tool = TOOLS[type];
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
