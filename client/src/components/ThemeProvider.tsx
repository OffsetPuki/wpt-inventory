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
  if (typeof document === "undefined") return "dark";
  const m = document.cookie.match(/(?:^|;\s*)wpt-theme=(dark|light)/);
  return (m?.[1] as Theme) || "dark";
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
  });

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const { accentHue: h, accentSat: s, accentLight: l } = settings;
    for (const v of ["--primary", "--accent", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"]) {
      root.style.setProperty(v, `${h} ${s}% ${l}%`);
    }
  }, [settings]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
  );
}
