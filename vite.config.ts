import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { compression } from "vite-plugin-compression2";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    // Pre-compress built JS/CSS/HTML/SVG so the server can ship them straight
    // from disk instead of re-gzipping per request. Brotli is ~20% smaller
    // than gzip on text assets; gzip is the fallback for older clients.
    compression({ algorithm: "brotliCompress", exclude: [/\.(br|gz)$/, /\.(png|jpe?g|webp|woff2?)$/i] }),
    compression({ algorithm: "gzip",          exclude: [/\.(br|gz)$/, /\.(png|jpe?g|webp|woff2?)$/i] }),
  ],
  root: path.resolve(import.meta.dirname, "client"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist", "public"),
    emptyOutDir: true,
    // Split vendor deps into stable chunks so they survive app-code updates in
    // the browser cache. Recharts and Radix ship a lot of code that almost
    // never changes between releases — pull them out of the main bundle.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("/d3-")) return "recharts";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("lucide-react")) return "icons";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("@tanstack/react-query") ||
            id.includes("/wouter/")
          ) return "vendor";
        },
      },
    },
  },
  server: {
    // In dev mode the Express server will mount Vite middleware,
    // so we don't need a separate Vite dev server port.
  },
});
