"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, NEON_AUTH_COOKIE_PREFIX } from "@/lib/auth/server";

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
