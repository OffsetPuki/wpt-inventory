import assert from "node:assert/strict";
import {
  reportingAccessToken,
  reportingIdentity,
} from "../server/google-auth.ts";
delete process.env.GOOGLE_REPORTING_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_REPORTING_OAUTH_JSON;
assert.equal(reportingIdentity(), null);
await assert.rejects(reportingAccessToken(), /not configured/);
process.env.GOOGLE_REPORTING_OAUTH_JSON = JSON.stringify({
  type: "authorized_user",
  client_id: "fixture-client",
  client_secret: "fixture-secret",
  refresh_token: "fixture-refresh",
  account: "reporting@example.test",
});
assert.equal(reportingIdentity(), "reporting@example.test");
let calls = 0;
const transport = async (url, options) => {
  calls++;
  assert.equal(url, "https://oauth2.googleapis.com/token");
  const params = new URLSearchParams(options.body);
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "fixture-refresh");
  return new Response(
    JSON.stringify({ access_token: "fixture-access", expires_in: 3600 }),
  );
};
assert.deepEqual(
  await Promise.all([
    reportingAccessToken(transport),
    reportingAccessToken(transport),
  ]),
  ["fixture-access", "fixture-access"],
);
assert.equal(calls, 1, "Parallel report requests share one token refresh");
assert.equal(await reportingAccessToken(transport), "fixture-access");
assert.equal(calls, 1);
process.env.GOOGLE_REPORTING_OAUTH_JSON =
  process.env.GOOGLE_REPORTING_OAUTH_JSON.replace(
    "fixture-refresh",
    "revoked-refresh",
  );
await assert.rejects(
  reportingAccessToken(
    async () => new Response("private provider details", { status: 400 }),
  ),
  (error) =>
    error.message.includes("HTTP 400") &&
    !error.message.includes("private provider details"),
);
await assert.rejects(
  reportingAccessToken(async () => new Response("{}")),
  /did not provide/,
);
delete process.env.GOOGLE_REPORTING_OAUTH_JSON;
console.log(
  "Google reporting authentication checks passed: scoped token refresh, shared cache, credential rotation and safe errors.",
);
