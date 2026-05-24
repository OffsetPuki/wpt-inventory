import express from "express";
import path from "path";
import fs from "fs";

export function serveStatic(app: express.Express): void {
  const distPath = path.resolve(process.cwd(), "dist", "public");

  if (!fs.existsSync(distPath)) {
    console.warn("[static] dist/public not found — skipping static serve");
    return;
  }

  app.use(express.static(distPath));

  // SPA fallback: non-API GET routes → index.html
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ message: "Not found" });
    res.sendFile(path.join(distPath, "index.html"));
  });
}
