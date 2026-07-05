import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./shared/schema.ts",
    "./shared/crm-schema.ts",
    "./shared/marketing-schema.ts",
    "./shared/hr-schema.ts",
    "./shared/pm-schema.ts",
    "./shared/finance-schema.ts",
    "./shared/quote-schema.ts",
  ],
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/inventory.db",
  },
});
