// Weight helper for the "by weight" material method in lib/calc.js.
// L, W, T are in inches; density is lb/in^3, passed in by the caller.

/**
 * Compute weight in pounds from rectangular stock dimensions.
 * Returns 0 if any value is invalid.
 */
export function weightLb({ lengthIn, widthIn, thicknessIn, densityLbPerIn3 }) {
  const vol = (lengthIn || 0) * (widthIn || 0) * (thicknessIn || 0);
  return Math.max(0, vol * (densityLbPerIn3 || 0));
}
