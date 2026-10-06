import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { withVerifiedSsl } from "./src/lib/env";

// Read .env.local exactly like `next dev` does (values are never printed).
loadEnvConfig(process.cwd());

/**
 * Migrations manage only the application tables in `public`. Neon Auth's
 * `neon_auth` schema is provider-owned and excluded via `schemaFilter`.
 *
 * Use a direct (non-pooled) connection for migrations when available:
 * DATABASE_URL_UNPOOLED, falling back to DATABASE_URL.
 */
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["public"],
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: { url: url ? withVerifiedSsl(url) : "" },
});
