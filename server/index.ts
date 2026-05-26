import "dotenv/config"; // loads .env (e.g. ANTHROPIC_API_KEY) before anything reads env
import express from "express";
import http from "http";
import compression from "compression";
import { seedDefaults } from "./seed";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { setupVite } from "./vite";

const app = express();
const server = http.createServer(app);

// ── CORS headers (manual — no cors middleware to avoid preflight issues) ──
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Auth");
  if (_req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// ── gzip/brotli responses (big bandwidth win on API JSON + initial HTML/JS) ──
app.use(compression());

// ── Body parser (50MB for base64 photos) ──
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ── Seed defaults ──
seedDefaults();

// ── Register routes ──
registerRoutes(app);

// ── Serve frontend ──
const isProd = process.env.NODE_ENV === "production";

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
