import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { setDraftUser } from "../quote/lib/store.js";
import type { PublicUser } from "@shared/schema";
import { apiRequest, getAuthToken, queryClient, setAuthToken } from "./queryClient";

// ─── Context shape ──────────────────────────────────────────────────────────

interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  // Owner and manager access to management screens.
  isElevated: boolean;
  recoveryError: string | null;
  retrySession: () => void;
  login: (name: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = getAuthToken();
  const [user, setUser] = useState<PublicUser | null>(null);
  // If we found a saved token, we're "loading" until we've validated it.
  const [isLoading, setIsLoading] = useState<boolean>(!!initialToken);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retrySession = useCallback(() => setAttempt(n => n + 1), []);

  // Rehydrate the session on first mount: if a token was saved last time,
  // ask the server who it belongs to. A 401 (e.g. server restarted) clears it.
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setIsLoading(true);
    setRecoveryError(null);
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me", undefined, { signal: controller.signal });
        const me = (await res.json()) as PublicUser;
        if (cancelled || getAuthToken() !== token) return;
        setDraftUser(me.id);
        setUser(me);
      } catch (error: any) {
        if (cancelled) return;
        if (error.status === 401 || getAuthToken() !== token) return;
        setRecoveryError("We couldn’t reconnect. Your sign-in and saved drafts are still here.");
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
    // initialToken is captured once at mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    const online = () => { if (recoveryError) retrySession(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [recoveryError, retrySession]);

  // React to mid-session token invalidations (apiRequest dispatches this on 401).
  useEffect(() => {
    const onInvalidated = () => {
      setRecoveryError(null);
      setDraftUser(null);
        sessionStorage.removeItem("cjm.quote.prefillLead");
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
      setDraftUser(loggedInUser.id);
      setUser(loggedInUser);
      setRecoveryError(null);
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
    setRecoveryError(null);
    setDraftUser(null);
        sessionStorage.removeItem("cjm.quote.prefillLead");
        setUser(null);
    queryClient.clear();
  }, []);

  const isAuthenticated = !!user;
  // Only owners and managers can enter management screens.
  const isElevated = !!user && ["owner","manager"].includes(user.role);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isElevated,
        recoveryError,
        retrySession,
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
