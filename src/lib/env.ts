/**
 * Server configuration. None of these are NEXT_PUBLIC_: the database URL and
 * the cookie secret must never reach the browser, and the Neon Auth URL is
 * only used by the server-side proxy at /api/auth.
 *
 * Imported by proxy.ts, so it deliberately avoids `server-only`; it is still
 * never imported from a Client Component.
 */

export function getAuthEnv() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !cookieSecret || cookieSecret.length < 32) return null;
  return { baseUrl, cookieSecret };
}

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || null;
}

/** Which required settings are missing (names only — never values). */
export function missingConfig() {
  const missing: string[] = [];
  if (!getDatabaseUrl()) missing.push("DATABASE_URL");
  if (!process.env.NEON_AUTH_BASE_URL) missing.push("NEON_AUTH_BASE_URL");
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) missing.push("NEON_AUTH_COOKIE_SECRET (32+ characters)");
  return missing;
}

export function isAppConfigured() {
  return missingConfig().length === 0;
}

/**
 * node-postgres currently treats sslmode=prefer/require/verify-ca as
 * verify-full and warns that v9 will switch to weaker libpq semantics. Pin
 * today's behavior (encrypted + certificate and hostname verified) explicitly,
 * so Neon's default `sslmode=require` URLs stay strict and stop warning.
 */
export function withVerifiedSsl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get("sslmode");
    if (mode && ["prefer", "require", "verify-ca"].includes(mode) && !url.searchParams.has("uselibpqcompat")) {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}
