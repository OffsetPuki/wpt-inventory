// Shared Tailwind class-constant strings, lifted verbatim from the per-page
// copies so every CRUD page renders identical inputs, buttons, tables, and
// pills. Kept as plain string exports (not components) so they drop into
// className={...} and cn(...) exactly where the inline copies used to sit.

// Form controls / buttons (from the finance pages).
export const inputCls =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60 outline-none focus:border-primary focus:ring-2 focus:ring-ring";

export const primaryBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm transition-colors hover:brightness-95 active:scale-[0.98] focus-ring disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground bg-card transition-colors hover:bg-accent hover:border-input active:scale-[0.98] focus-ring disabled:cursor-not-allowed disabled:opacity-60";

// Table cells + generic pill (from the marketing/report tables). Kept here so
// the remaining page directories can share the same header/cell/chip strings.
export const thCls =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";

export const tdCls = "px-3 py-2.5";

export const chipCls =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
