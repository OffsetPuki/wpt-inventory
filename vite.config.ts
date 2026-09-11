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
    compression({ algorithms: ["brotliCompress","gzip"], exclude: [/\.(br|gz)$/, /\.(png|jpe?g|webp|woff2?)$/i] }),
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
    // Let the bundler follow lazy route imports. Hand-assigned vendor chunks
    // pulled chart dependencies into the shell and can create CommonJS cycles.
  },
  server: {
    // In dev mode the Express server will mount Vite middleware,
    // so we don't need a separate Vite dev server port.
  },
});
