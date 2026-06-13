import "dotenv/config"; // loads .env (e.g. ANTHROPIC_API_KEY) before anything reads env
import express from "express";
import http from "http";
import compression from "compression";
import helmet from "helmet";
import { seedDefaults } from "./seed";
import { registerRoutes } from "./routes";
import { registerLegalRoutes } from "./legal";
import { startSessionReaper } from "./auth";
import { serveStatic } from "./static";
import { setupVite } from "./vite";

const app = express();
const server = http.createServer(app);

const isProd = process.env.NODE_ENV === "production";

// Trust the first proxy hop so req.ip is the real client IP, not Railway's
// proxy. Without this, express-rate-limit treats every request as coming
// from the same IP, and the audit log records useless proxy addresses.
app.set("trust proxy", 1);

// Force HTTPS in production. The host (e.g. Railway) terminates TLS and tells
// us the original scheme via x-forwarded-proto; if a request arrived over
// plain HTTP, 308-redirect it to https so a session token in localStorage is
// never sent in the clear. Paired with helmet's HSTS below. No-op in dev.
if (isProd) {
  app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"];
    if (proto && proto !== "https") {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// ── Security headers (helmet) ─────────────────────────────────────────────
// In dev, Vite injects inline scripts and a websocket for HMR, so a strict
// CSP would break the page. We use a loose dev CSP and a tight prod CSP.
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            // Vite-built bundles are external files, no inline JS in prod.
            scriptSrc: ["'self'"],
            // Radix UI sets inline `style="..."` attributes on popovers, so
            // we can't drop 'unsafe-inline' without a Radix rewrite. Inline
            // *blocks* (<style>...</style>) are still blocked because we'd
            // need 'unsafe-hashes' to allow attribute styles separately.
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            // CSP violations get POSTed here so we know if something tried
            // an injection attack that the CSP blocked.
            reportUri: ["/api/security/csp-report"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    // Same-origin only — narrows the window the app can be loaded in.
    crossOriginResourcePolicy: { policy: "same-origin" },
    // Lock down browser features we never use. Reduces attack surface if a
    // 3rd-party script ever sneaks in. Strict-Transport-Security is set by
    // helmet's default; the explicit Permissions-Policy isn't.
  })
);

// Permissions-Policy: deny powerful APIs the app never asks for. Anything
// later that wants the camera (e.g. shop-floor photo capture works via
// <input type="file" capture> which doesn't need this) can be re-enabled.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), interest-cohort=()"
  );
  next();
});

// API responses must never be cached by intermediate proxies — otherwise a
// shared cache (corporate proxy, CDN) could serve one worker's session JSON
// to another. Static /uploads keep their long immutable cache header.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// CSP report receiver. Body comes through as either application/csp-report
// or application/json depending on the browser; both are small JSON.
app.use("/api/security/csp-report", express.json({
  type: ["application/csp-report", "application/json"],
  limit: "32kb",
}));
app.post("/api/security/csp-report", (req, res) => {
  console.warn("[csp-report]", JSON.stringify(req.body));
  res.status(204).end();
});

// ── gzip/brotli responses (big bandwidth win on API JSON + initial HTML/JS) ──
app.use(compression());

// ── Body parser ──
// Reduced from 50 MB to 1 MB. The only large payloads were photo uploads,
// which go through multer (multipart) at 10 MB — they don't pass through
// express.json. Keeping json/urlencoded at 50 MB was a free DoS vector.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Seed defaults & start session reaper ──
seedDefaults();
startSessionReaper();

// ── Register routes ──
registerRoutes(app);

// Public legal pages (/privacy, /eula). Registered before the SPA catch-all
// so they return real HTML — Intuit's reviewer needs a public Privacy Policy
// URL, and these must resolve without auth or the React shell.
registerLegalRoutes(app);

// ── Serve frontend ──

(async () => {
  if (isProd) {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  const PORT = parseInt(process.env.PORT || "5000", 10);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  🏭 WPT Inventory Locator`);
    console.log(`  ➜ Local:   http://localhost:${PORT}`);
    console.log(`  ➜ Mode:    ${isProd ? "production" : "development"}\n`);
  });
})();
