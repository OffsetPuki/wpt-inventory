// Money formatting helpers. Currency rounding is done at the math level
// (not just at display) so totals are deterministic and reviewable.

/**
 * Round to 2 decimals using "round half away from zero" (standard accounting).
 * Avoids JS's banker's-rounding quirks with Number.prototype.toFixed.
 */
export function round2(n) {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100) / 100;
}

/** Format a number as USD-style "1,234.56". No currency symbol — caller adds it. */
export function fmtMoney(n) {
  const v = round2(Number(n) || 0);
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
