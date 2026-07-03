import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Settings } from "@shared/schema";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);

// Persisted in a cookie (localStorage/sessionStorage are blocked by the sandbox).
const COOKIE = "wpt-theme";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const m = document.cookie.match(/(?:^|;\s*)wpt-theme=(dark|light)/);
  // Light is the default for the minimal restyle; dark stays one click away.
  return (m?.[1] as Theme) || "light";
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    document.cookie = `${COOKIE}=${theme}; path=/; max-age=31536000`;
  }, [theme]);

  // Apply the manager-configured accent color over whichever theme is active.
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await apiRequest("GET", "/api/settings")).json(),
    staleTime: 60_000,
    refetchInterval: false,
  });

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const { accentHue: h, accentSat: s, accentLight: l } = settings;
    const dark = theme === "dark";
    // Near-black brand accents (CJM ink) invert to cream on the navy dark
    // theme — ink-on-cream by day, cream-on-ink by night, like the website.
    // Colorful accents instead get a lightness lift so they stay vibrant.
    const invert = dark && l < 20;
    const accent = invert
      ? "40 30% 92%"
      : `${h} ${s}% ${dark ? Math.min(l + 12, 62) : l}%`;
    const accentFg = invert ? "0 0% 8%" : l < 20 && !dark ? "40 30% 96%" : "0 0% 100%";
    // --accent deliberately NOT overridden: it's the neutral hover/selection
    // wash, and tinting it with the brand color made every hover state shout.
    for (const v of ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"]) {
      root.style.setProperty(v, accent);
    }
    for (const v of ["--primary-foreground", "--sidebar-primary-foreground"]) {
      root.style.setProperty(v, accentFg);
    }
  }, [settings, theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
  );
}
