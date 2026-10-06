import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseUrl, withVerifiedSsl } from "@/lib/env";
import * as schema from "./schema";

/**
 * Server-only Drizzle client over node-postgres, pointed at Neon's *pooled*
 * connection string (DATABASE_URL, host contains `-pooler`). The app runs on
 * the Node.js runtime, so one small pool per server process is reused across
 * requests; Neon's PgBouncer does the heavy pooling.
 *
 * Never import this from a Client Component or expose it through a generic
 * action — all access goes through the owner-scoped functions in ./queries.
 */

type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { roveDb?: Db };

export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: withVerifiedSsl(connectionString), max: 5, idleTimeoutMillis: 30_000 });
  pool.on("error", (err) => console.error("[rove] idle database client error:", err.message));
  return { db: drizzle({ client: pool, schema, casing: "snake_case" }), pool };
}

export function getDb(): Db {
  if (globalForDb.roveDb) return globalForDb.roveDb;
  const url = getDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set. See docs/local-setup.md.");
  const { db } = createDb(url);
  // Reuse across dev hot reloads instead of opening a new pool each time.
  globalForDb.roveDb = db;
  return db;
}

export type { Db };
