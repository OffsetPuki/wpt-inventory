import express, { type Request, type Response, type NextFunction } from "express";
import path from "path";
import fs from "fs";

// Map a file extension to its content type. We only need the ones Vite emits;
// anything else falls back to express.static.
const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

// Pick the best pre-compressed variant the client accepts. Returns the
// suffix to append to the file path (e.g. ".br") and the matching
// Content-Encoding header, or null if no precompressed copy applies.
function pickEncoding(req: Request): { suffix: string; encoding: string } | null {
  const accept = String(req.headers["accept-encoding"] || "");
  if (accept.includes("br")) return { suffix: ".br", encoding: "br" };
  if (accept.includes("gzip")) return { suffix: ".gz", encoding: "gzip" };
  return null;
}

export function serveStatic(app: express.Express): void {
  const distPath = path.resolve(process.cwd(), "dist", "public");

  if (!fs.existsSync(distPath)) {
    console.warn("[static] dist/public not found — skipping static serve");
    return;
  }

  // Serve hashed bundles from /assets with a 1-year immutable cache, picking
  // a pre-compressed .br/.gz file if the browser supports it. Vite's build
  // emits content-hashed filenames here, so the bytes for a given URL never
  // change — `immutable` is safe.
  app.use("/assets", (req: Request, res: Response, next: NextFunction) => {
    const rel = decodeURIComponent(req.path);
    const safeRel = rel.replace(/^\/+/, "");
    if (safeRel.includes("..")) return next();
    const filePath = path.join(distPath, "assets", safeRel);
    // One stat instead of existsSync + statSync (both hit the FS) — a missing
    // file throws and falls through to express.static, same as before.
    let st: fs.Stats;
    try { st = fs.statSync(filePath); } catch { return next(); }
    if (!st.isFile()) return next();

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", mime);
    // Tell caches that the chosen variant depends on Accept-Encoding.
    res.setHeader("Vary", "Accept-Encoding");

    const enc = pickEncoding(req);
    if (enc) {
      const precompressed = filePath + enc.suffix;
      if (fs.existsSync(precompressed)) {
        res.setHeader("Content-Encoding", enc.encoding);
        return res.sendFile(precompressed);
      }
    }
    res.sendFile(filePath);
  });

  // Fall back to express.static for any other built files (favicon, etc).
  // index.html is excluded so the SPA fallback below can attach its own
  // cache headers without express.static getting in the way.
  app.use(
    express.static(distPath, {
      index: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // SPA fallback: non-API GET routes → index.html. Always re-validate so
  // a deploy is picked up on the next navigation without a hard refresh.
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ message: "Not found" });
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(distPath, "index.html"));
  });
}
