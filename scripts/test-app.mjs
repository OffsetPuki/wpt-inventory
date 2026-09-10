// Isolated HTTP test fixture. No real accounts, databases, mail, or Stripe requests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import express from "express";

export async function testApp({ serve = false } = {}) {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cjm-release-"));
  for (const key of [
    "RESEND_API_KEY",
    "MAIL_FROM",
    "SMTP_USER",
    "SMTP_HOST",
    "OWNER_EMAIL",
    "BACKUP_UPLOAD_URL",
    "BACKUP_S3_BUCKET",
  ])
    process.env[key] = "";
  Object.assign(process.env, {
    NODE_ENV: "development",
    TZ: "America/Chicago",
    LEAD_INTAKE_KEY: "test-intake-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "test-webhook-secret",
  });
  const realFetch = globalThis.fetch;
  const sessions = new Map(),
    requests = new Map();
  const stripeCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const address = new URL(String(url));
    if (address.hostname === "127.0.0.1") return realFetch(url, init);
    if (address.hostname !== "api.stripe.com")
      throw new Error(`Blocked external test request: ${address.hostname}`);
    stripeCalls.push({ path: address.pathname, method: init.method || "GET" });
    const path = address.pathname;
    let result;
    if (path === "/v1/checkout/sessions") {
      const key = new Headers(init.headers).get("Idempotency-Key");
      if (!key) throw new Error("Checkout must send an idempotency key");
      const prior = requests.get(key);
      if (prior) result = sessions.get(prior);
      else {
        const id = "cs_test_" + sessions.size;
        const fields = new URLSearchParams(init.body);
        result = {
          id,
          url: "https://checkout.stripe.test/" + id,
          status: "open",
          expires_at: Math.floor(Date.now() / 1000) + 86400,
          payment_status: "unpaid",
          currency: "usd",
          amount_total: Number(
            fields.get("line_items[0][price_data][unit_amount]"),
          ),
          metadata: {
            invoiceId: fields.get("metadata[invoiceId]"),
            which: fields.get("metadata[which]"),
          },
        };
        sessions.set(id, result);
        requests.set(key, id);
      }
    } else {
      const parts = path.split("/");
      result = sessions.get(parts[4]);
      if (!result) throw new Error("Unknown mock Checkout Session");
      if (parts[5] === "expire") {
        if (result.status !== "open")
          return new Response(
            JSON.stringify({ error: { message: "Cannot expire" } }),
            { status: 400 },
          );
        result.status = "expired";
        result.url = null;
      }
    }
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const { registerRoutes } = await import("../server/routes.ts");
  const { registerAttentionRoute } = await import("../server/automations.ts");
  const { seedDefaults } = await import("../server/seed.ts");
  const { sqlite, uploadsDir, storage } = await import("../server/storage.ts");
  seedDefaults();
  const app = express();
  app.use(
    "/api/public/stripe/webhook",
    express.raw({ type: "application/json" }),
  );
  app.use(express.json({ limit: "6mb" }));
  registerRoutes(app);
  registerAttentionRoute(app);
  if (serve) {
    const { serveStatic } = await import("../server/static.ts");
    serveStatic(app);
  }
  app.use((error, _req, res, _next) =>
    res.status(500).json({ message: error.message }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function api(path, method = "GET", body, token, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Auth": token } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }
  async function event(
    object,
    type = "checkout.session.completed",
    eventId = crypto.randomUUID(),
  ) {
    const body = JSON.stringify({ id: eventId, type, data: { object } });
    const t = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${t}.${body}`)
      .digest("hex");
    const response = await fetch(base + "/api/public/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${t},v1=${signature}`,
      },
      body,
    });
    return { status: response.status, data: await response.json() };
  }
  const login = await api("/api/auth/login", "POST", {
    name: "Owner",
    pin: "1234",
  });
  if (login.status !== 200) throw new Error("Fixture login failed");
  return {
    sqlite,
    storage,
    uploadsDir,
    api,
    event,
    base,
    owner: login.data.token,
    sessions,
    stripeCalls,
    close: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await new Promise((resolve) => server.close(resolve));
      sqlite.close();
      globalThis.fetch = realFetch;
    },
  };
}
