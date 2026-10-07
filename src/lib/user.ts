import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getAuth, NEON_AUTH_COOKIE_PREFIX } from "@/lib/auth/server";

export type CurrentUser = {
  /** Stable Neon Auth user ID — the only value used for authorization. */
  id: string;
  email: string | null;
  /** The sign-in provider's own statement that it verified this address. Never a browser-supplied value. */
  emailVerified: boolean;
  displayName: string;
  firstName: string;
  avatarUrl: string | null;
  initials: string;
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

/** Thrown when Neon Auth cannot be reached to verify a session. */
export class SessionUnavailableError extends Error {
  constructor() {
    super("We couldn’t verify your session right now. Please try again in a moment.");
  }
}

/**
 * The verified signed-in user, or null.
 *
 * Neon Auth's server `getSession()` accepts the session only if the signed
 * session-data cookie verifies against NEON_AUTH_COOKIE_SECRET, or if Neon
 * Auth itself confirms the session token. Memoized per request with React
 * `cache` — never across requests or users.
 *
 * Name, email and photo come from Google via Neon Auth and are display-only.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const auth = getAuth();
  if (!auth) return null;

  // No session token cookie → signed out; no need to ask Neon Auth.
  const hasToken = (await cookies())
    .getAll()
    .some((c) => c.name.startsWith(NEON_AUTH_COOKIE_PREFIX) && c.name.endsWith(".session_token"));
  if (!hasToken) return null;

  const { data, error } = await auth.getSession();
  if (error) {
    // 5xx / network: don't silently sign the user out.
    if ((error.status ?? 0) >= 500) throw new SessionUnavailableError();
    return null;
  }
  const user = data?.user;
  if (!data?.session || !user?.id) return null;

  const email = typeof user.email === "string" && user.email ? user.email : null;
  const name = (typeof user.name === "string" && user.name.trim()) || (email ? email.split("@")[0] : "Traveler");
  const avatar = typeof user.image === "string" && /^https:\/\//.test(user.image) ? user.image : null;

  return {
    id: user.id,
    email,
    emailVerified: email !== null && (user as { emailVerified?: unknown }).emailVerified === true,
    displayName: name,
    firstName: name.split(/\s+/)[0],
    avatarUrl: avatar,
    initials: initialsFrom(name),
  };
});
