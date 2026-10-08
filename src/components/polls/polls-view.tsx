import Link from "next/link";
import { MessageCircleQuestionMark } from "lucide-react";
import { MascotEmptyState } from "@/components/mascot";
import type { PollView } from "@/lib/polls";
import { AskGroupButton } from "./ask-group-button";
import { PollCard } from "./poll-card";

/** The trip-level list: every question, newest first, grouped by where it stands. */
export function PollsView({
  tripTimeZone,
  polls,
  places,
  focus,
}: {
  tripTimeZone: string;
  polls: PollView[];
  places: { id: string; name: string }[];
  focus?: string;
}) {
  const open = polls.filter((p) => p.status === "open" && !p.expired && !p.result);
  const decided = polls.filter((p) => p.result || (p.status !== "canceled" && !open.includes(p)));
  const canceled = polls.filter((p) => p.status === "canceled");
  const group = (title: string, list: PollView[], id: string) =>
    list.length === 0 ? null : (
      <section aria-labelledby={id} className="space-y-3">
        <h2 id={id} className="eyebrow text-ink">{title} · {list.length}</h2>
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((p) => (
            <li key={p.id} className="min-w-0">
              <PollCard poll={p} tripTimeZone={tripTimeZone} places={places} highlight={p.id === focus} />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Ask the group</h1>
          <p className="mt-1 max-w-xl text-muted-foreground">
            Small decisions, made together. Everyone on the trip can answer; the person who asked makes it final.
          </p>
        </div>
        <AskGroupButton parent={{ type: "trip" }} places={places} tripTimeZone={tripTimeZone} />
      </div>
      {polls.length === 0 ? (
        <MascotEmptyState
          tone="quiet"
          headingLevel={2}
          title="No questions yet"
          description="Ask where to eat, which outing sounds better, or which day suits a spa visit. You can also ask from a day in the itinerary or from an Explore place."
        />
      ) : (
        <>
          {group("Open", open, "polls-open")}
          {group("Decided and closed", decided, "polls-decided")}
          {group("Canceled", canceled, "polls-canceled")}
        </>
      )}
    </div>
  );
}

/** A few questions near the day or place they belong to, without repeating the whole page. */
export function PollsNearby({
  tripId,
  tripTimeZone,
  polls,
  places,
  heading = "Ask the group",
  parent,
  scopeLabel,
  seedPlaceId,
}: {
  tripId: string;
  tripTimeZone: string;
  polls: PollView[];
  places: { id: string; name: string }[];
  heading?: string;
  parent: Parameters<typeof AskGroupButton>[0]["parent"];
  scopeLabel?: string | null;
  seedPlaceId?: string;
}) {
  const live = polls.filter((p) => p.status !== "canceled");
  const shown = [...live.filter((p) => p.status === "open" && !p.expired && !p.result), ...live.filter((p) => !(p.status === "open" && !p.expired && !p.result))].slice(0, 3);
  return (
    <section aria-label={heading} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eyebrow flex items-center gap-2 text-ink">
          <MessageCircleQuestionMark className="size-4" aria-hidden="true" /> {heading}
          {live.length ? ` · ${live.length}` : ""}
        </h3>
        <div className="flex items-center gap-1">
          {live.length > 3 ? (
            <Link href={`/trips/${tripId}/polls`} className="focus-ring inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-moss-ink hover:underline">
              See all {live.length}
            </Link>
          ) : null}
          <AskGroupButton parent={parent} places={places} tripTimeZone={tripTimeZone} scopeLabel={scopeLabel} seedPlaceId={seedPlaceId} className="min-h-10 px-3 text-sm" />
        </div>
      </div>
      {shown.length > 0 ? (
        <ul className="space-y-3">
          {shown.map((p) => (
            <li key={p.id}>
              <PollCard poll={p} tripTimeZone={tripTimeZone} places={places} compact />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
