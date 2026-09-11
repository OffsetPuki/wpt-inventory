import { createHash, createSign } from "node:crypto";

const scopes =
  "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";
type Credentials =
  | {
      type: "authorized_user";
      client_id: string;
      client_secret: string;
      refresh_token: string;
      account?: string;
    }
  | { type: "service_account"; client_email: string; private_key: string };
function credentials(): Credentials | null {
  try {
    const c = JSON.parse(
      process.env.GOOGLE_REPORTING_OAUTH_JSON ||
        process.env.GOOGLE_REPORTING_SERVICE_ACCOUNT_JSON ||
        "{}",
    );
    if (
      c.type === "authorized_user" &&
      [c.client_id, c.client_secret, c.refresh_token].every(
        (v) => typeof v === "string" && v.length > 0,
      )
    )
      return c;
    if (
      c.type === "service_account" &&
      typeof c.client_email === "string" &&
      typeof c.private_key === "string" &&
      c.private_key.length > 0
    )
      return c;
  } catch {}
  return null;
}
export function reportingIdentity(): string | null {
  const c = credentials();
  return c
    ? c.type === "service_account"
      ? c.client_email
      : c.account || "Google read-only connection"
    : null;
}
let cached: { fingerprint: string; value: string; expires: number } | undefined;
let pending: { fingerprint: string; promise: Promise<string> } | undefined;
export async function reportingAccessToken(
  transport: typeof fetch = fetch,
): Promise<string> {
  const c = credentials();
  if (!c) throw new Error("Google reporting connection is not configured");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(c))
    .digest("hex");
  if (cached?.fingerprint === fingerprint && cached.expires > Date.now())
    return cached.value;
  if (pending?.fingerprint === fingerprint) return pending.promise;
  const promise = (async () => {
    let body: URLSearchParams;
    if (c.type === "authorized_user") {
      body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: c.client_id,
        client_secret: c.client_secret,
        refresh_token: c.refresh_token,
      });
    } else {
      const now = Math.floor(Date.now() / 1000),
        encode = (v: unknown) =>
          Buffer.from(JSON.stringify(v)).toString("base64url");
      const unsigned =
        encode({ alg: "RS256", typ: "JWT" }) +
        "." +
        encode({
          iss: c.client_email,
          scope: scopes,
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        });
      const signature = createSign("RSA-SHA256")
        .update(unsigned)
        .sign(c.private_key)
        .toString("base64url");
      body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: unsigned + "." + signature,
      });
    }
    const response = await transport("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Google authentication returned HTTP ${response.status}; reconnect Google if access was revoked`,
      );
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token)
      throw new Error("Google did not provide a reporting token");
    cached = {
      fingerprint,
      value: data.access_token,
      expires:
        Date.now() +
        Math.max(0, Math.min(Number(data.expires_in) || 3600, 3600) - 60) *
          1000,
    };
    return cached.value;
  })();
  pending = { fingerprint, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = undefined;
  }
}
