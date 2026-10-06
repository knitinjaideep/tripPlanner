"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { GoogleIcon } from "@/components/brand";
import { authClient } from "@/lib/auth/client";

/**
 * Starts Google sign-in through Neon Auth. Neon Auth sends the browser to
 * Google (basic `openid email profile` identity only — no Drive or Gmail),
 * then back to `callbackURL`, where the proxy completes the session.
 */
export function GoogleSignInButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const errorUrl = new URL("/login", origin);
      errorUrl.searchParams.set("error", "provider");
      if (next !== "/trips") errorUrl.searchParams.set("next", next);

      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: new URL(next, origin).toString(),
        errorCallbackURL: errorUrl.toString(),
      });
      if (error) throw error;
      // The browser is now navigating to Google; keep the spinner up.
    } catch {
      setPending(false);
      setError("We couldn’t reach Google just now. Please try again.");
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        aria-busy={pending}
        className="focus-ring flex h-13 w-full items-center justify-center gap-3 rounded-xl border border-input bg-white px-5 text-[0.9375rem] font-semibold text-ink shadow-[0_1px_2px_rgba(16,47,64,0.06)] transition-colors hover:bg-[#f7fafa] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-5 animate-spin text-teal" aria-hidden="true" /> : <GoogleIcon />}
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
