import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle2, Settings2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { getCover } from "@/lib/covers";
import { safeNextPath } from "@/lib/auth/redirects";
import { missingConfig } from "@/lib/env";
import { getCurrentUser, SessionUnavailableError } from "@/lib/user";
import { GoogleSignInButton } from "./google-button";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  provider: "Google sign-in was cancelled or didn’t complete. Please try again.",
  callback: "We couldn’t finish signing you in. The sign-in link may have expired — please try again.",
  session: "We couldn’t check your session just now. Please try again in a moment.",
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = first(params.error);
  const next = safeNextPath(first(params.next));
  const missing = missingConfig();
  const configured = missing.length === 0;

  let sessionCheckFailed = false;
  if (configured) {
    try {
      // Already signed in? Skip the login screen.
      if (await getCurrentUser()) redirect(next);
    } catch (e) {
      if (!(e instanceof SessionUnavailableError)) throw e;
      sessionCheckFailed = true;
    }
  }

  const errorMessage = sessionCheckFailed
    ? ERRORS.session
    : error
      ? (ERRORS[error] ?? ERRORS.callback)
      : first(params.reason) === "expired"
        ? "Your session has ended. Please sign in again to continue."
        : null;
  const notice = !errorMessage && first(params.signed_out) ? "You’re signed out. See you on the next trip." : null;
  const cover = getCover("beach");

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative h-[38dvh] min-h-64 overflow-hidden lg:h-auto">
        <Image
          src={cover.image}
          alt={cover.alt}
          fill
          loading="eager"
          fetchPriority="high"
          placeholder="blur"
          sizes="(min-width: 1024px) 55vw, 100vw"
          className="object-cover"
          style={{ objectPosition: cover.position }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b2a3a]/70 via-[#0b2a3a]/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-10">
          <p className="eyebrow text-white/85">Palm Beach, Aruba</p>
          <p className="font-display mt-2 max-w-md text-3xl leading-tight font-semibold sm:text-4xl">
            Somewhere warm is already waiting.
          </p>
          <p className="mt-4 text-xs text-white/75">
            Photo: {cover.credit.author} · {cover.credit.license} ·{" "}
            <a href={cover.credit.source} className="underline underline-offset-2" target="_blank" rel="noreferrer">
              Wikimedia Commons
            </a>
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <Logo href="/login" />
          <h1 className="font-display mt-10 text-4xl leading-[1.05] font-semibold text-ink sm:text-5xl">
            Every trip, in one calm place.
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
            Keep flights, stays, confirmation numbers and the documents you’ll need — together, private, and
            ready when you land.
          </p>

          <div className="mt-9 space-y-4">
            {errorMessage ? (
              <div role="alert" className="flex gap-3 rounded-xl border border-[#f3c6bf] bg-[#fff1ee] p-4 text-sm text-[#8c2b1f]">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>{errorMessage}</p>
              </div>
            ) : null}
            {notice ? (
              <div role="status" className="flex gap-3 rounded-xl border border-border bg-teal-soft/60 p-4 text-sm text-teal-ink">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>{notice}</p>
              </div>
            ) : null}

            {configured ? (
              <GoogleSignInButton next={next} />
            ) : (
              <div className="rounded-xl border border-border bg-sun/60 p-4 text-sm text-ink">
                <p className="flex items-center gap-2 font-semibold">
                  <Settings2 className="size-4" aria-hidden="true" /> Almost ready
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  Sign-in needs {missing.join(", ")} in <code className="font-mono text-ink">.env.local</code>.
                  See <code className="font-mono text-ink">docs/local-setup.md</code>.
                </p>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your trips are private to your account. rove only reads your name, email and profile photo from
              Google.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
