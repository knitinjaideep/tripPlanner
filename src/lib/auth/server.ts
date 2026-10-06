import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getAuthEnv } from "@/lib/env";

/**
 * The one Neon Auth server instance (`@neondatabase/auth/next/server`).
 * It provides the /api/auth proxy handler, the session-refreshing proxy
 * middleware, and server-side `getSession()`, which verifies the signed
 * session-data cookie (HS256, NEON_AUTH_COOKIE_SECRET) or asks Neon Auth.
 *
 * Created lazily so a missing configuration renders setup instructions
 * instead of crashing at import time.
 */

let instance: NeonAuth | null | undefined;

export function getAuth(): NeonAuth | null {
  if (instance === undefined) {
    const env = getAuthEnv();
    instance = env
      ? createNeonAuth({
          baseUrl: env.baseUrl,
          cookies: { secret: env.cookieSecret },
          logLevel: "warn",
        })
      : null;
  }
  return instance;
}

/** Neon Auth cookies all start with this prefix (see the SDK's cookie names). */
export const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";

/** Query param Neon Auth appends to callbackURL after the OAuth round trip. */
export const SESSION_VERIFIER_PARAM = "neon_auth_session_verifier";
