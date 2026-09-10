import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60000,
  use: { viewport: { width: 390, height: 844 }, trace: "retain-on-failure" },
  reporter: "list",
});
