import { defineConfig } from "drizzle-kit";

/**
 * Migrations run against the direct (non-pooled) connection. Set
 * DATABASE_URL_UNPOOLED (falls back to DATABASE_URL).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
