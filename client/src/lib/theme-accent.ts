// Keep the settings preview and saved application theme in sync.
export function applySuiteAccent(h: number, s: number, l: number, dark = document.documentElement.classList.contains("dark")) {
  const standard = (h === 0 && s === 0 && l === 9) || (h === 211 && s === 100 && l === 43);
  const invert = dark && l < 20;
  const accent = standard ? (dark ? "211 100% 65%" : "211 100% 43%") : invert
    ? "240 10% 94%" : `${h} ${s}% ${dark ? Math.min(l + 12, 62) : l}%`;
  const foreground = standard ? (dark ? "240 6% 10%" : "0 0% 100%") : invert ? "0 0% 8%" : "0 0% 100%";
  for (const name of ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"]) {
    document.documentElement.style.setProperty(name, accent);
  }
  for (const name of ["--primary-foreground", "--sidebar-primary-foreground"]) {
    document.documentElement.style.setProperty(name, foreground);
  }
}
