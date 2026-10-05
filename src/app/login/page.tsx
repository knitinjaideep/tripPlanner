import type { Metadata } from "next";
import Image from "next/image";
import { AlertCircle, Settings2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { getCover } from "@/lib/covers";
import { isSupabaseConfigured } from "@/lib/env";
import { GoogleSignInButton } from "./google-button";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  provider: "Google sign-in was cancelled or didn’t complete. Please try again.",
  callback: "We couldn’t finish signing you in. The link may have expired — please try again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorMessage = typeof error === "string" ? (ERRORS[error] ?? ERRORS.callback) : null;
  const configured = isSupabaseConfigured();
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

            {configured ? (
              <GoogleSignInButton />
            ) : (
              <div className="rounded-xl border border-border bg-sun/60 p-4 text-sm text-ink">
                <p className="flex items-center gap-2 font-semibold">
                  <Settings2 className="size-4" aria-hidden="true" /> Almost ready
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  Sign-in needs Supabase settings in <code className="font-mono text-ink">.env.local</code>. See{" "}
                  <code className="font-mono text-ink">docs/setup.md</code>.
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
