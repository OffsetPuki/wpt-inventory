import "dotenv/config"; // loads .env (e.g. ANTHROPIC_API_KEY) before anything reads env
import express from "express";
import http from "http";
import compression from "compression";
import helmet from "helmet";
import { seedDefaults } from "./seed";
import { registerRoutes } from "./routes";
import { startSessionReaper } from "./auth";
import { serveStatic } from "./static";
import { setupVite } from "./vite";

const app = express();
const server = http.createServer(app);

const isProd = process.env.NODE_ENV === "production";

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
            // Tailwind-compiled CSS is external; allow inline styles only
            // because Radix occasionally inserts style="..." attributes.
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    // Same-origin only — narrows the window the app can be loaded in.
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

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
