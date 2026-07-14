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
