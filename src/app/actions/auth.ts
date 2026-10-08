"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, NEON_AUTH_COOKIE_PREFIX } from "@/lib/auth/server";
import { INVITE_COOKIE, TOKEN_PATTERN } from "@/lib/sharing";
import { idSchema } from "@/lib/validation";

/**
 * Ends the session at Neon Auth (which revokes it server-side), then clears
 * every Neon Auth cookie locally so a cached session-data cookie cannot keep
 * the browser signed in.
 */
export async function signOut() {
  const auth = getAuth();
  if (auth) {
    try {
      const { error } = await auth.signOut();
      if (error) console.error("[rove] sign-out at Neon Auth failed:", error.status);
    } catch (error) {
      console.error("[rove] sign-out at Neon Auth failed:", (error as Error)?.name);
    }
  }

  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith(NEON_AUTH_COOKIE_PREFIX)) {
      store.set(cookie.name, "", { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "lax" });
    }
  }
  redirect("/login?signed_out=1");
}

/**
 * "Use a different account" on an invitation: ends this session, remembers
 * the invitation in a short-lived first-party cookie, and goes to sign-in.
 * After signing in as someone else they come straight back to the invitation.
 */
export async function switchAccountForInvite(token: string) {
  if (!TOKEN_PATTERN.test(token)) redirect("/trips");
  await signOutQuietly();
  (await cookies()).set(INVITE_COOKIE, token, { path: "/", maxAge: 30 * 60, secure: true, httpOnly: true, sameSite: "lax" });
  redirect("/login?next=%2Finvite");
}

/**
 * "Use a different account" on an invitation opened from the inbox. The
 * invitation id is not a secret, so it simply rides in the (validated)
 * return path.
 */
export async function switchAccountForInvitation(invitationId: string) {
  if (!idSchema.safeParse(invitationId).success) redirect("/trips");
  await signOutQuietly();
  redirect(`/login?next=${encodeURIComponent(`/invitations/${invitationId}`)}`);
}

async function signOutQuietly() {
  const auth = getAuth();
  if (auth) {
    try {
      await auth.signOut();
    } catch (error) {
      console.error("[rove] sign-out at Neon Auth failed:", (error as Error)?.name);
    }
  }
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith(NEON_AUTH_COOKIE_PREFIX)) {
      store.set(cookie.name, "", { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "lax" });
    }
  }
}
