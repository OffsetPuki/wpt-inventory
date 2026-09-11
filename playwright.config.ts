import { defineConfig } from "@playwright/test";
import { readdirSync } from "node:fs";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  // The server's SQLite singleton is cached per process. Give each fixture-owning
  // spec its own worker process so a prior spec cannot leave a closed connection.
  projects: readdirSync(new URL("./tests/", import.meta.url))
    .filter((file) => file.endsWith(".spec.mjs"))
    .map((file) => ({ name: file.replace(".spec.mjs", ""), testMatch: `**/${file}` })),
  timeout: 60000,
  use: { viewport: { width: 390, height: 844 }, trace: "retain-on-failure" },
  reporter: "list",
});
