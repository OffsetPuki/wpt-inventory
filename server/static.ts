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
    let rel:string;
    try { rel=decodeURIComponent(req.path); } catch { return res.status(400).end(); }
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

    const variants = [
      {encoding:'br',file:filePath+'.br'},
      {encoding:'gzip',file:filePath+'.gz'},
      {encoding:'identity',file:filePath},
    ].filter(v=>fs.existsSync(v.file));
    const selected = req.headers['accept-encoding']
      ? req.acceptsEncodings(...variants.map(v=>v.encoding)) : 'identity';
    const variant=variants.find(v=>v.encoding===selected);
    if(!variant) { res.setHeader('Cache-Control','no-store'); return res.status(406).end(); }
    if(variant.encoding!=='identity')res.setHeader('Content-Encoding',variant.encoding);
    res.sendFile(variant.file);
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
    if(req.path.startsWith('/assets/') || path.extname(req.path)) {
      res.setHeader('Cache-Control','no-store');
      return res.status(404).type('text').send('File not found. Reload the page to get the current version.');
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(distPath, "index.html"));
  });
}
