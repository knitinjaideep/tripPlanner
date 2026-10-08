import Link from "next/link";
import { CalendarDays, Clock3, MailWarning, ShieldCheck, UserRound } from "lucide-react";
import { Logo } from "@/components/brand";
import { MascotImage } from "@/components/mascot";
import { secondaryButtonClass } from "@/components/forms/fields";
import { formatDateRange } from "@/lib/dates";
import type { InvitePage } from "@/lib/invite-page";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/sharing";
import { AcceptInvitationForm, SwitchAccountButton, type InviteTarget } from "./invite-actions";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_85%_0%,rgb(255_231_163/0.5),transparent_70%),radial-gradient(50%_45%_at_0%_100%,rgb(167_201_87/0.16),transparent_70%)]"
      />
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 sm:px-6">
        <header className="py-5 sm:py-8">
          <Logo />
        </header>
        <div className="flex flex-1 items-start sm:items-center">
          <div className="card-surface w-full space-y-6 p-5 sm:p-8">{children}</div>
        </div>
      </div>
    </main>
  );
}

function Notice({ title, children, tripsLabel = "Go to my trips" }: { title: string; children?: React.ReactNode; tripsLabel?: string }) {
  return (
    <>
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-ink">
          <MailWarning className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight font-semibold text-ink sm:text-3xl">{title}</h1>
          <div className="mt-2 space-y-2 text-[0.9375rem] text-muted-foreground">{children}</div>
        </div>
      </div>
      <Link href="/trips" className={`${secondaryButtonClass} w-full`}>
        {tripsLabel}
      </Link>
    </>
  );
}

/** Renders what the invitation page decided to show. Pure: no data access, so every state can be previewed. */
export function InviteView({ view, target }: { view: InvitePage; target: InviteTarget }) {
  switch (view.kind) {
    case "signed_out":
      // Normally the proxy has already sent signed-out visitors to sign in. Don't put the token in a redirect here.
      return (
        <Shell>
          <Notice title="Sign in to see this invitation" tripsLabel="Sign in">
            <p>Open the invitation link again after signing in with Google.</p>
          </Notice>
        </Shell>
      );

    case "invalid":
      return (
        <Shell>
          <Notice title="This invitation isn’t valid">
            <p>The link may be incomplete, or the trip may no longer exist. Ask the person who invited you to send a new one.</p>
          </Notice>
        </Shell>
      );

    case "expired":
    case "revoked":
    case "used":
      return (
        <Shell>
          <Notice
            title={
              view.kind === "expired"
                ? "This invitation has expired"
                : view.kind === "revoked"
                  ? "This invitation was withdrawn"
                  : "This invitation has already been used"
            }
          >
            <p>
              The invitation to <strong className="font-semibold text-ink">{view.trip.title}</strong> from {view.inviter} can’t be used anymore.
              {view.kind === "used" ? " Invitations work once." : ""}
            </p>
            <p>Ask {view.inviter} to send you a new one.</p>
          </Notice>
        </Shell>
      );

    case "already_member":
    case "owner":
    case "accepted_by_you":
      return (
        <Shell>
          <div className="space-y-2">
            <h1 className="font-display text-2xl leading-tight font-semibold text-ink sm:text-3xl">
              {view.kind === "owner" ? "This is your own trip" : "You’re already on this trip"}
            </h1>
            <p className="text-[0.9375rem] text-muted-foreground">
              {view.kind === "owner"
                ? `You manage “${view.title}”, so there’s nothing to accept.`
                : `You have access to “${view.title}”.`}
            </p>
          </div>
          <Link
            href={`/trips/${view.tripId}`}
            className="focus-ring inline-flex h-13 w-full items-center justify-center rounded-xl bg-moss-ink px-5 text-base font-semibold text-white hover:bg-moss-hover"
          >
            Open the trip
          </Link>
        </Shell>
      );

    case "wrong_account":
      return (
        <Shell>
          <Notice title="This invitation is for a different account" tripsLabel="Back to my trips">
            <p>
              {view.inviter} invited <strong className="font-semibold text-ink">{view.hint}</strong> to “{view.trip.title}”
              {view.signedInAs ? (
                <>
                  , but you’re signed in as <strong className="font-semibold text-ink">{view.signedInAs}</strong>
                </>
              ) : null}
              .
            </p>
            <p>Sign in with the invited Google account to accept it.</p>
          </Notice>
          <SwitchAccountButton target={target} label="Sign in with a different account" />
        </Shell>
      );

    case "unverified_email":
      return (
        <Shell>
          <Notice title="We couldn’t confirm your email" tripsLabel="Back to my trips">
            <p>
              This invitation to “{view.trip.title}” was sent to <strong className="font-semibold text-ink">{view.hint}</strong>, and we can’t
              confirm that the account you’re signed in with owns that address.
            </p>
          </Notice>
          <SwitchAccountButton target={target} label="Sign in with a different account" />
        </Shell>
      );

    case "ready":
      return (
        <Shell>
          <div className="flex items-start gap-4">
            <MascotImage size="xs" decorative />
            <div className="min-w-0">
              <p className="eyebrow text-moss-ink">You’re invited</p>
              <h1 className="font-display mt-1.5 text-[1.75rem] leading-tight font-semibold break-words text-ink sm:text-4xl">{view.trip.title}</h1>
            </div>
          </div>

          <dl className="space-y-3 text-[0.9375rem]">
            <div className="flex items-center gap-3">
              <CalendarDays className="size-5 shrink-0 text-moss-ink" aria-hidden="true" />
              <div>
                <dt className="sr-only">Dates</dt>
                <dd className="font-medium text-ink">{formatDateRange(view.trip.start_date, view.trip.end_date)}</dd>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <UserRound className="size-5 shrink-0 text-moss-ink" aria-hidden="true" />
              <div>
                <dt className="sr-only">Invited by</dt>
                <dd className="text-ink">
                  Invited by <span className="font-medium">{view.inviter}</span>
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-moss-ink" aria-hidden="true" />
              <div>
                <dt className="sr-only">Your access</dt>
                <dd className="text-ink">
                  <span className="font-semibold">{ROLE_LABELS[view.role]}</span>
                  <span className="block text-muted-foreground">{ROLE_DESCRIPTIONS[view.role]}</span>
                </dd>
              </div>
            </div>
          </dl>

          <div className="space-y-3">
            <AcceptInvitationForm target={target} />
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              You’ll see the whole trip once you accept. Signing in alone doesn’t join you.
            </p>
            <SwitchAccountButton target={target} label="Not you? Use a different account" />
          </div>
        </Shell>
      );
  }
}
