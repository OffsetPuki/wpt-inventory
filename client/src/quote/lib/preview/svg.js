// Shared SVG helpers for the preview renderers (carport, pergola).
// Hoisted verbatim from the per-renderer copies so a single edit fixes both.

/**
 * Shift a hex color toward white (amount > 0) or black (amount < 0).
 * amount is a fraction in roughly [-1, 1].
 */
export function shade(hex, amount) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const mix = (c) => (amount >= 0 ? Math.round(c + (255 - c) * amount) : Math.round(c * (1 + amount)));
  const to = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return '#' + to(mix(r)) + to(mix(g)) + to(mix(b));
}

/** Build an SVG points string from an array of [x, y] pairs. */
export function pts(arr) {
  return arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

/**
 * A repeating <linearGradient> def that shades a vertical-rib corrugated-metal
 * sheet: each `pitchPx`-wide period runs valley → lit flank → specular crest →
 * shadow flank → valley, so a filled rect reads as rounded, light-catching ribs
 * (light from the upper-left) instead of flat lines. Fill the sheet rect with
 * `fill="url(#<id>)"`. `x0` anchors the rib phase (use the sheet's left edge).
 */
export function corrugatedGradient(id, color, pitchPx, x0 = 0) {
  const valley = shade(color, -0.45);
  const flankL = shade(color, 0.16);
  const crest = shade(color, 0.62);
  const flankR = shade(color, -0.26);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" spreadMethod="repeat" `
    + `x1="${x0.toFixed(2)}" y1="0" x2="${(x0 + pitchPx).toFixed(2)}" y2="0">`
    + `<stop offset="0" stop-color="${valley}"/>`
    + `<stop offset="0.2" stop-color="${flankL}"/>`
    + `<stop offset="0.31" stop-color="${crest}"/>`
    + `<stop offset="0.45" stop-color="${color}"/>`
    + `<stop offset="0.72" stop-color="${flankR}"/>`
    + `<stop offset="1" stop-color="${valley}"/>`
    + `</linearGradient>`;
}

/** Rib pitch in px for corrugated metal (~3.5" corrugation) given px-per-foot. */
export function corrugatedPitch(pxPerFt) {
  return Math.max(6, 3.5 * (pxPerFt / 12));
}
