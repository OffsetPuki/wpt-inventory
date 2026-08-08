// =============================================================================
//  Feet / inches / fractions — shop language, in and out.
//
//  Every dimension in a configurator state stays a plain decimal number in the
//  control's own unit ('ft' or 'in'), exactly as the estimators and previews
//  already expect. This module is only the translation layer at the edges:
//
//    parseMeasure(`6' 4-1/2"`, 'ft')  →  6.375
//    formatMeasure(6.375, 'ft')       →  "6 ft 4-1/2 in"
//
//  So the owner types what they measured on site and the math never changes.
//  Everything snaps to the nearest 1/16 in — finer than anyone tapes, and it
//  keeps 1/3 of a foot from turning into 0.33333333333333331 in the payload.
// =============================================================================

const SIXTEENTHS = 16;

/** Units that mean a physical length. Anything else (%, bags, °) stays a plain number. */
export function isMeasureUnit(unit) {
  return unit === 'ft' || unit === 'in' || unit === '"';
}

/** Normalize a control's unit to 'ft' or 'in'. */
export function measureUnit(unit) {
  return unit === 'ft' ? 'ft' : 'in';
}

/** "4", "4.5", "4 1/2", "4-1/2", "1/2" → a number. null when it isn't one. */
function parseQuantity(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  // whole + fraction: "4 1/2" or "4-1/2"
  let m = /^(\d+(?:\.\d+)?)[\s-]+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) {
    const den = Number(m[3]);
    return den > 0 ? Number(m[1]) + Number(m[2]) / den : null;
  }
  // bare fraction: "1/2"
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) {
    const den = Number(m[2]);
    return den > 0 ? Number(m[1]) / den : null;
  }
  // plain decimal
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Round to the nearest 1/16 in, expressed back in `unit`. */
function snap(value, unit) {
  const inches = unit === 'ft' ? value * 12 : value;
  const snapped = Math.round(inches * SIXTEENTHS) / SIXTEENTHS;
  return unit === 'ft' ? snapped / 12 : snapped;
}

/**
 * Parse anything a fabricator would write into a number in `unit`.
 *
 *   6            → 6 (already in the field's unit)
 *   6.375        → 6.375
 *   6'           → 6 ft
 *   6' 4"        → 6.333… ft
 *   6'4-1/2"     → 6.375 ft
 *   6 ft 4 1/2 in → 6.375 ft
 *   76-1/2"      → 6.375 ft   (or 76.5 when the field is in inches)
 *   4 1/2        → 4.5 in the field's unit
 *
 * Returns null when there's nothing usable, so callers can leave the old value
 * alone instead of writing NaN into the design.
 */
export function parseMeasure(input, unit = 'ft') {
  if (input == null) return null;
  const u = measureUnit(unit);
  const s = String(input)
    .toLowerCase()
    .replace(/[′’]/g, "'")   // ′ ’ → '
    .replace(/[″”]/g, '"')   // ″ ” → "
    // No leading \b — "6ft4in" has no gap between the digit and the unit.
    // The lookahead keeps us from eating the front of a longer word.
    .replace(/\s*(?:feet|foot|ft)\.?(?![a-z])/g, "'")
    .replace(/\s*(?:inches|inch|in)\.?(?![a-z])/g, '"')
    .trim();
  if (!s) return null;

  const tick = s.indexOf("'");
  if (tick !== -1) {
    const feet = parseQuantity(s.slice(0, tick));
    if (feet == null) return null;
    const after = s.slice(tick + 1).replace(/"/g, '').trim();
    let inches = 0;
    if (after) {
      inches = parseQuantity(after);
      if (inches == null) return null;
    }
    return snap(u === 'ft' ? feet + inches / 12 : feet * 12 + inches, u);
  }

  if (s.includes('"')) {
    const inches = parseQuantity(s.replace(/"/g, '').trim());
    if (inches == null) return null;
    return snap(u === 'ft' ? inches / 12 : inches, u);
  }

  // No unit marker — a bare number is already in the field's own unit.
  const bare = parseQuantity(s);
  return bare == null ? null : snap(bare, u);
}

/** 4.5 → "4-1/2", 4 → "4", 0.5 → "1/2". Assumes a non-negative inch count. */
function inchStr(inches) {
  const whole = Math.floor(inches + 1e-9);
  let num = Math.round((inches - whole) * SIXTEENTHS);
  let den = SIXTEENTHS;
  if (num >= SIXTEENTHS) return String(whole + 1);
  if (num === 0) return String(whole);
  while (num % 2 === 0) { num /= 2; den /= 2; }
  return whole ? `${whole}-${num}/${den}` : `${num}/${den}`;
}

/**
 * A number back into shop language, in the field's own unit:
 *   formatMeasure(6.375, 'ft') → "6 ft 4-1/2 in"
 *   formatMeasure(40.5, 'in')  → "40-1/2 in"
 * An inches field never grows feet — a 36 in railing reads "36 in", not "3 ft".
 */
export function formatMeasure(value, unit = 'ft') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const u = measureUnit(unit);
  const sign = n < 0 ? '-' : '';
  const totalIn = Math.round(Math.abs(u === 'ft' ? n * 12 : n) * SIXTEENTHS) / SIXTEENTHS;

  if (u === 'in') return `${sign}${inchStr(totalIn)} in`;

  const ft = Math.floor(totalIn / 12 + 1e-9);
  const rem = totalIn - ft * 12;
  if (rem < 1 / 32) return `${sign}${ft} ft`;
  if (ft === 0) return `${sign}${inchStr(rem)} in`;
  return `${sign}${ft} ft ${inchStr(rem)} in`;
}

/** Compact form for tight spots (preview dimension labels): 6'4-1/2" / 40-1/2". */
export function formatTick(value, unit = 'ft') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const u = measureUnit(unit);
  const totalIn = Math.round(Math.abs(u === 'ft' ? n * 12 : n) * SIXTEENTHS) / SIXTEENTHS;
  const sign = n < 0 ? '-' : '';
  if (u === 'in') return `${sign}${inchStr(totalIn)}"`;
  const ft = Math.floor(totalIn / 12 + 1e-9);
  const rem = totalIn - ft * 12;
  if (rem < 1 / 32) return `${sign}${ft}'`;
  if (ft === 0) return `${sign}${inchStr(rem)}"`;
  return `${sign}${ft}'${inchStr(rem)}"`;
}
