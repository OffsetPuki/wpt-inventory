import { QueryClient } from "@tanstack/react-query";

// ─── Module-level auth token ────────────────────────────────────────────────
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
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
      refetchOnWindowFocus: false,
    },
  },
});
