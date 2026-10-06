import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertCircle, CalendarDays, CheckCircle2, Heart, Luggage, Settings2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { BrandGlowCard, MascotImage } from "@/components/mascot";
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

  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_85%_10%,rgb(255_231_163/0.55),transparent_70%),radial-gradient(50%_45%_at_0%_100%,rgb(167_201_87/0.18),transparent_70%)]"
      />
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
        <header className="py-6 sm:py-8">
          <Logo href="/login" />
        </header>

        <div className="grid flex-1 items-center gap-8 pb-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-20">
          <section className="order-2 max-w-xl lg:order-1">
            <p className="eyebrow text-moss-ink">Family travel, beautifully kept</p>
            <h1 className="font-display mt-3 text-4xl leading-[1.05] font-semibold text-ink sm:text-5xl lg:text-[3.5rem]">
              Every family trip, growing beautifully in one place.
            </h1>
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted-foreground sm:text-lg">
              Plan the flights and stays, map out each day, pack together — and keep the moments that matter
              most.
            </p>

            <div className="mt-9 max-w-sm space-y-4">
              {errorMessage ? (
                <div role="alert" className="flex gap-3 rounded-xl border border-[#f3c6bf] bg-[#fff1ee] p-4 text-sm text-[#8c2b1f]">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>{errorMessage}</p>
                </div>
              ) : null}
              {notice ? (
                <div role="status" className="flex gap-3 rounded-xl border border-border bg-moss-soft p-4 text-sm text-moss-ink">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>{notice}</p>
                </div>
              ) : null}

              {configured ? (
                <GoogleSignInButton next={next} />
              ) : (
                <div className="rounded-xl border border-gold/60 bg-gold-soft/60 p-4 text-sm text-ink">
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
                Your trips are private to your account. Atlas only reads your name, email and profile photo from
                Google.
              </p>
            </div>
          </section>

          <section aria-label="Atlas" className="order-1 lg:order-2">
            <BrandGlowCard className="mx-auto flex max-w-md flex-col items-center px-6 pt-6 pb-5 sm:px-10 sm:pt-10 sm:pb-6 lg:max-w-none">
              <MascotImage size="hero" variant="glow" priority />
              <p className="font-display mt-3 text-center text-lg font-semibold text-ink sm:mt-4 sm:text-2xl">
                Your family’s travel garden
              </p>
              <ul className="mt-4 hidden flex-wrap justify-center gap-2 sm:flex text-sm text-ink" aria-label="What Atlas keeps">
                {[
                  { icon: CalendarDays, label: "Plan the days" },
                  { icon: Luggage, label: "Pack together" },
                  { icon: Heart, label: "Keep the moments" },
                ].map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/85 px-3 py-1.5"
                  >
                    <Icon className="size-3.5 text-moss-ink" aria-hidden="true" /> {label}
                  </li>
                ))}
              </ul>
            </BrandGlowCard>
          </section>
        </div>
      </div>
    </main>
  );
}
