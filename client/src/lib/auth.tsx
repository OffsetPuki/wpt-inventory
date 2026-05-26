import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { PublicUser } from "@shared/schema";
import { apiRequest, getAuthToken, queryClient, setAuthToken } from "./queryClient";

// ─── Context shape ──────────────────────────────────────────────────────────

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isManager: boolean;
  login: (name: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = getAuthToken();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(initialToken);
  // If we found a saved token, we're "loading" until we've validated it.
  const [isLoading, setIsLoading] = useState<boolean>(!!initialToken);

  // Rehydrate the session on first mount: if a token was saved last time,
  // ask the server who it belongs to. A 401 (e.g. server restarted) clears it.
  useEffect(() => {
    if (!initialToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        const me = (await res.json()) as PublicUser;
        if (cancelled) return;
        setUser(me);
      } catch {
        if (cancelled) return;
        setAuthToken(null);
        setToken(null);
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // initialToken is captured once at mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to mid-session token invalidations (apiRequest dispatches this on 401).
  useEffect(() => {
    const onInvalidated = () => {
      setToken(null);
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener("auth-invalidated", onInvalidated);
    return () => window.removeEventListener("auth-invalidated", onInvalidated);
  }, []);

  const login = useCallback(async (name: string, pin: string) => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login", { name, pin });
      const data = await res.json();
      const newToken: string = data.token;
      const loggedInUser: PublicUser = data.user;

      setAuthToken(newToken); // also persists to localStorage
      setToken(newToken);
      setUser(loggedInUser);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Even if server logout fails, clear client state
    }
    setAuthToken(null); // also clears localStorage
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, []);

  const isAuthenticated = !!user;
  const isManager = user?.role === "manager";

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated,
        isManager,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
