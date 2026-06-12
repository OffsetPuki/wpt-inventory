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
      // Mutations invalidate the relevant query keys themselves, so we don't
      // need a global poll — that was firing every 15s on every page and was
      // by far the largest source of wasted requests. A generous staleTime
      // keeps the cache warm between navigations; refetchOnWindowFocus stays
      // on so a tab that was away for a while still gets fresh data, but only
      // for queries whose staleTime has elapsed (the React Query default).
      staleTime: 60_000,
      refetchInterval: false,
      refetchOnWindowFocus: true,
    },
  },
});
