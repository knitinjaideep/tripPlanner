"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarPlus, Check, CircleCheckBig, Clock, ExternalLink, Loader2, Lock, Users } from "lucide-react";
import { toast } from "sonner";
import { cancelPoll, choosePollResult, closePoll, votePoll } from "@/app/actions/polls";
import { secondaryButtonClass } from "@/components/forms/fields";
import { ConfirmDialog } from "@/components/trip/confirm-dialog";
import { useTripAccess } from "@/components/trip/trip-access";
import { itineraryHref } from "@/lib/itinerary-format";
import { decisionSummary, formatDeadline, parentLabel, standing, type PollView } from "@/lib/polls";
import { cn } from "@/lib/utils";
import { PollFormDialog } from "./poll-form";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

function statusOf(poll: PollView, tripZone: string): { label: string; tone: "open" | "done" | "off" } {
  if (poll.status === "canceled") return { label: "Canceled", tone: "off" };
  if (poll.result) return { label: "Decided", tone: "done" };
  if (poll.status === "closed" || poll.expired) return { label: poll.expired && poll.status === "open" ? "Voting ended" : "Closed", tone: "off" };
  return { label: poll.closes_at ? `Open · closes ${formatDeadline(poll.closes_at, tripZone)}` : "Open", tone: "open" };
}

/**
 * One question: options with an accessible radio group, totals, who answered,
 * and the organizer's controls. The same card is used next to a day or
 * place and on the trip's Decisions page; `compact` just trims the extras.
 */
export function PollCard({
  poll,
  tripTimeZone,
  places,
  compact = false,
  highlight = false,
}: {
  poll: PollView;
  tripTimeZone: string;
  places: { id: string; name: string }[];
  compact?: boolean;
  highlight?: boolean;
}) {
  const uid = useId();
  const { tripId } = useTripAccess();
  const mine = poll.me.response ? (poll.me.response.option_id ?? "any") : null;
  const [choice, setChoice] = useState<string | null>(mine);
  const [choosing, setChoosing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "close" | null>(null);
  const [form, setForm] = useState<"edit" | "revise" | null>(null);

  const status = statusOf(poll, tripTimeZone);
  const lead = standing(poll.tally);
  const leaders = poll.options.filter((o) => poll.tally.leaders.includes(o.id));
  const shown = poll.result ? poll.result.tally : poll.tally;
  const max = Math.max(1, ...poll.options.map((o) => shown.counts[o.id] ?? 0));
  const resultOption = poll.result ? poll.options.find((o) => o.id === poll.result!.option_id) : null;
  const showRadios = poll.can.vote || choosing;
  const unchanged = choice === mine;

  const run = (job: () => Promise<{ ok: boolean; message?: string }>, success?: string, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await job();
      if (!result.ok) {
        setError(result.message ?? "That didn’t work. Nothing was changed.");
        return;
      }
      if (success) toast.success(success);
      after?.();
    });
  };

  const day = poll.parent.day ?? poll.parent.item?.date ?? null;
  const applyHref = resultOption?.place
    ? `/trips/${tripId}/explore?place=${resultOption.place.id}&action=schedule${day ? `&day=${day}` : ""}`
    : null;
  const existing = poll.result?.existing ?? null;

  return (
    <article
      id={`poll-${poll.id}`}
      aria-labelledby={`${uid}-q`}
      className={cn("rounded-2xl border bg-surface p-4 sm:p-5", highlight ? "border-gold ring-2 ring-gold/40" : "border-border", poll.status === "canceled" && "opacity-80")}
    >
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              status.tone === "open" && "bg-moss-soft text-moss-ink",
              status.tone === "done" && "bg-gold-soft text-gold-ink",
              status.tone === "off" && "bg-secondary text-muted-foreground",
            )}
          >
            {status.tone === "done" ? <CircleCheckBig className="size-3.5" aria-hidden="true" /> : status.tone === "off" ? <Lock className="size-3.5" aria-hidden="true" /> : <Clock className="size-3.5" aria-hidden="true" />}
            {status.label}
          </span>
          {parentLabel(poll.parent) ? <span className="text-xs text-muted-foreground">{parentLabel(poll.parent)}</span> : null}
        </div>
        <h3 id={`${uid}-q`} className="font-display text-xl leading-snug font-semibold break-words text-ink">{poll.question}</h3>
        {poll.description && !compact ? <p className="text-sm break-words text-muted-foreground">{poll.description}</p> : null}
        <p className="text-xs text-muted-foreground">Asked by {poll.creator_name}</p>
      </header>

      <div className="mt-3">
        <div role="radiogroup" aria-labelledby={`${uid}-q`} className="space-y-2">
          {poll.options.map((o) => {
            const count = shown.counts[o.id] ?? 0;
            const voters = poll.result ? [] : poll.votes.filter((v) => v.option_id === o.id);
            const isResult = poll.result?.option_id === o.id;
            const selected = choice === o.id;
            return (
              <label
                key={o.id}
                className={cn(
                  "relative block overflow-hidden rounded-xl border p-3 transition-colors",
                  showRadios ? "cursor-pointer hover:bg-moss-soft/40" : "cursor-default",
                  selected && showRadios ? "border-moss-ink bg-moss-soft/50" : "border-border bg-white",
                  isResult && "border-gold bg-gold-soft/40",
                )}
              >
                <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-moss/10" style={{ width: `${(count / max) * (count ? 100 : 0)}%` }} />
                <span className="relative flex items-start gap-3">
                  {showRadios ? (
                    <input
                      type="radio"
                      name={`${uid}-r`}
                      value={o.id}
                      checked={selected}
                      onChange={() => setChoice(o.id)}
                      disabled={pending}
                      className="mt-1 size-5 shrink-0 accent-[#3E7A3A]"
                    />
                  ) : isResult ? (
                    <CircleCheckBig className="mt-0.5 size-5 shrink-0 text-gold-deep" aria-hidden="true" />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold break-words text-ink">
                        {o.label}
                        {isResult ? <span className="sr-only"> — the chosen answer</span> : null}
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {count} {count === 1 ? "vote" : "votes"}
                      </span>
                    </span>
                    {voters.length > 0 && !compact ? (
                      <span className="mt-0.5 block text-xs break-words text-muted-foreground">{voters.map((v) => v.name).join(", ")}</span>
                    ) : null}
                    {o.place ? (
                      <Link
                        href={`/trips/${tripId}/explore?place=${o.place.id}`}
                        className="focus-ring relative mt-1 inline-flex min-h-8 items-center gap-1 rounded text-xs font-semibold text-moss-ink underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View place <ExternalLink className="size-3" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}

          {poll.any_option && !choosing ? (
            <label
              className={cn(
                "block rounded-xl border border-dashed p-3",
                poll.can.vote ? "cursor-pointer hover:bg-secondary/60" : "cursor-default",
                choice === "any" && poll.can.vote ? "border-moss-ink bg-moss-soft/40" : "border-border",
              )}
            >
              <span className="flex items-start gap-3">
                {poll.can.vote ? (
                  <input type="radio" name={`${uid}-r`} value="any" checked={choice === "any"} onChange={() => setChoice("any")} disabled={pending} className="mt-1 size-5 shrink-0 accent-[#3E7A3A]" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-ink">Any works for me</span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{shown.any}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">Doesn’t count toward any option.</span>
                  {!poll.result && !compact && poll.votes.some((v) => v.option_id === null) ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{poll.votes.filter((v) => v.option_id === null).map((v) => v.name).join(", ")}</span>
                  ) : null}
                </span>
              </span>
            </label>
          ) : null}
        </div>

        {!poll.result && poll.tally.voted > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
            {lead === "tied" ? `Tied: ${leaders.map((o) => o.label).join(" and ")}. ` : lead === "leading" ? `Leading: ${leaders[0].label}. ` : ""}
            Not final until the organizer chooses.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-[#f3c6bf] bg-[#fff1ee] p-3 text-sm text-[#8c2b1f]">{error}</p>
      ) : null}

      {poll.can.vote && !choosing ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending || choice === null || unchanged}
            onClick={() => run(() => votePoll(tripId, poll.id, choice!), mine ? "Vote changed." : "Vote saved.")}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
            {mine ? "Change vote" : "Vote"}
          </button>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden="true" /> Everyone on the trip can see how you vote.
          </p>
        </div>
      ) : null}

      {choosing ? (
        <div className="mt-3 space-y-2 rounded-xl border border-gold/60 bg-gold-soft/40 p-3">
          <p className="text-sm text-ink">
            Pick the final answer. The group is told, and the poll closes. {lead === "tied" ? "The vote is tied — this is your call." : "You can choose any option, not just the leader."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !choice || choice === "any"}
              onClick={() => run(() => choosePollResult(tripId, poll.id, choice!), undefined, () => setChoosing(false))}
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CircleCheckBig className="size-4" aria-hidden="true" />}
              Choose this answer
            </button>
            <button type="button" onClick={() => { setChoosing(false); setChoice(mine); }} className={secondaryButtonClass}>Not yet</button>
          </div>
        </div>
      ) : null}

      {poll.result ? (
        <div className="mt-3 space-y-2 rounded-xl bg-gold-soft/50 p-3 text-sm text-ink">
          <p>
            <span className="font-semibold">Decided:</span> {resultOption?.label ?? "the chosen answer"} — chosen by {poll.result.selected_by}.
            <span className="block text-xs text-muted-foreground">
              {poll.result.tally.voted} of {poll.result.tally.eligible} had answered when it was decided.
            </span>
          </p>
          {resultOption?.place ? (
            existing ? (
              <Link href={existing.date ? itineraryHref(tripId, existing.date) : `/trips/${tripId}/itinerary`} className={cn(secondaryButtonClass, "w-full sm:w-auto")}>
                <CalendarPlus className="size-4" aria-hidden="true" /> Already planned — view in itinerary
              </Link>
            ) : poll.can.apply && applyHref ? (
              <Link href={applyHref} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover sm:w-auto">
                <CalendarPlus className="size-4" aria-hidden="true" /> Use this choice — add to itinerary
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">An owner or editor can add this to the itinerary.</p>
            )
          ) : (
            <p className="text-muted-foreground">{decisionSummary(poll)} Nothing was added to the itinerary.</p>
          )}
        </div>
      ) : null}

      {!compact ? (
        <div className="mt-3 flex items-center gap-2" aria-label={`${poll.tally.voted} of ${poll.tally.eligible} have answered`} role="group">
          <ul className="flex -space-x-1.5" aria-label="Who was asked">
            {poll.participants.map((p) => (
              <li
                key={p.user_id}
                title={`${p.name}${p.voted ? " — answered" : " — hasn’t answered"}`}
                className={cn(
                  "grid size-7 place-items-center rounded-full text-[0.625rem] font-bold ring-2 ring-surface",
                  p.voted ? "bg-moss-ink text-white" : "bg-secondary text-muted-foreground",
                )}
              >
                <span aria-hidden="true">{initials(p.name)}</span>
                <span className="sr-only">{p.name}: {p.voted ? "answered" : "hasn’t answered"}</span>
              </li>
            ))}
          </ul>
          <span className="text-xs text-muted-foreground">{poll.tally.voted} of {poll.tally.eligible} answered</span>
        </div>
      ) : null}

      {(poll.can.choose || poll.can.close || poll.can.cancel || poll.can.edit || (poll.can.revise && poll.hasVotes)) && !choosing ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {poll.can.choose ? (
            <button type="button" onClick={() => { setChoosing(true); setChoice(leaders.length === 1 ? leaders[0].id : null); }} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>Choose final option</button>
          ) : null}
          {poll.can.close ? <button type="button" onClick={() => setConfirm("close")} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>Close poll</button> : null}
          {poll.can.edit ? <button type="button" onClick={() => setForm("edit")} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>Edit</button> : null}
          {poll.can.revise && poll.hasVotes ? <button type="button" onClick={() => setForm("revise")} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>Create a revised poll</button> : null}
          {poll.can.cancel ? <button type="button" onClick={() => setConfirm("cancel")} className="focus-ring min-h-10 rounded-xl px-4 text-sm font-semibold text-destructive hover:bg-destructive/10">Cancel poll</button> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "cancel" ? "Cancel this question?" : "Close voting?"}
        description={
          confirm === "cancel"
            ? "People will no longer be able to answer, and it won’t be counted as a decision. This can’t be undone."
            : "People will no longer be able to answer. You can still choose the final answer afterwards."
        }
        confirmLabel={confirm === "cancel" ? "Cancel question" : "Close voting"}
        pendingLabel="Saving…"
        cancelLabel="Keep it open"
        onConfirm={async () => {
          const result = confirm === "cancel" ? await cancelPoll(tripId, poll.id) : await closePoll(tripId, poll.id);
          if (result.ok) toast.success(result.message);
          else setError(result.message ?? "That didn’t work.");
          setConfirm(null);
        }}
      />
      {form ? (
        <PollFormDialog
          mode={form === "edit" ? { kind: "edit", poll } : { kind: "revise", poll }}
          open
          onOpenChange={(open) => !open && setForm(null)}
          places={places}
          tripTimeZone={tripTimeZone}
          scopeLabel={parentLabel(poll.parent)}
        />
      ) : null}
    </article>
  );
}
