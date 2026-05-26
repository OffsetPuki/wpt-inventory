import { QueryClient } from "@tanstack/react-query";

// ─── Persisted auth token ───────────────────────────────────────────────────
// Stored in localStorage so a page refresh keeps the user signed in.

const TOKEN_KEY = "wpt-auth-token";

let authToken: string | null =
  typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  return authToken;
}

// ─── API request helper ─────────────────────────────────────────────────────

export async function apiRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (authToken) {
    headers["X-Auth"] = authToken;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // Server says the token is gone/invalid (e.g. server was restarted): drop the
    // local token and let AuthProvider react so the user sees the login screen
    // instead of an endless stream of 401s from background polling.
    if (res.status === 401 && authToken) {
      setAuthToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth-invalidated"));
      }
    }
    let message = res.statusText;
    try {
      const errorBody = await res.json();
      message = errorBody.message || errorBody.error || message;
    } catch {
      // response wasn't JSON, keep statusText
    }
    throw new Error(message);
  }

  return res;
}

// ─── Query client ───────────────────────────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      // Live updates: poll every 15s while the tab is visible, and refetch
      // immediately when the user comes back to the tab. Small staleTime keeps
      // mutations' invalidations responsive without thrashing the network.
      staleTime: 10_000,
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    },
  },
});
