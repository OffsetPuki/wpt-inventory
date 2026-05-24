import type { Express } from "express";
import type { Server } from "http";
import fs from "fs";
import path from "path";

export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: "vite.config.ts",
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: "custom",
  });
  app.use(vite.middlewares);

  // SPA fallback: serve the transformed index.html for any non-API GET request.
  // (Vite's custom/middleware mode does not serve index.html on its own.)
  app.use("*", async (req, res, next) => {
    if (req.method !== "GET" || req.originalUrl.startsWith("/api")) {
      return next();
    }
    try {
      const templatePath = path.resolve(process.cwd(), "client", "index.html");
      const raw = fs.readFileSync(templatePath, "utf-8");
      const html = await vite.transformIndexHtml(req.originalUrl, raw);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
