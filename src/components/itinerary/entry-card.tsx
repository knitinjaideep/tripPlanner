"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarArrowUp,
  Check,
  ChevronDown,
  CircleDashed,
  Copy,
  ExternalLink,
  Heart,
  Loader2,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  RotateCcw,
  StickyNote,
  Ticket,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  addReservationToItinerary,
  duplicateItineraryItem,
  saveReflection,
  setItineraryFavorite,
  setItineraryStatus,
  type EntryTarget,
} from "@/app/actions/itinerary";
import { FormMessage, SubmitButton, TextAreaField, secondaryButtonClass } from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { useTripWorkspace } from "@/components/trip/trip-workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { entryClock, entryDetail, entryLabel, placeMapsUrl } from "@/lib/itinerary-format";
import type { ItineraryStatus } from "@/lib/plan-options";
import { agendaCategory, agendaTitle, type AgendaEntry, type OverlapDetail } from "@/lib/schedule";
import type { ActionState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, CategoryIcon } from "./category-icon";
import { useItinerary } from "./itinerary-workspace";
import { StarRatingInput, Stars } from "./star-rating";

export type ReorderControls = {
  canUp: boolean;
  canDown: boolean;
  onMove: (direction: -1 | 1) => void;
  pending: boolean;
};

type Props = {
  entry: AgendaEntry;
  variant: "timed" | "flexible" | "outside";
  overlaps?: OverlapDetail[];
  reorder?: ReorderControls;
};

const menuItem = "min-h-11 rounded-lg";

/** One itinerary entry: a timed timeline row, a Flexible card, or an outside-the-trip card. */
export function EntryCard({ entry, variant, overlaps, reorder }: Props) {
  const { tripId, moveEntry, removeEntry, editEntry } = useItinerary();
  const { viewBooking, editBooking } = useTripWorkspace();
  const [pending, startTransition] = useTransition();
  const [reflecting, setReflecting] = useState(false);
  // Set when a booking gets its itinerary row during this session (before the refresh lands).
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);

  const { item, reservation, cancelled } = entry;
  const title = agendaTitle(entry);
  const category = agendaCategory(entry);
  const status: ItineraryStatus = item?.status ?? "planned";
  const isEnd = entry.role === "end";
  const canReview = !cancelled && !isEnd;
  const ownPlan = Boolean(item && !reservation);
  const itemId = item?.id ?? createdItemId;
  const target: EntryTarget = item ? { itemId: item.id } : { reservationId: reservation!.id };
  const label = entryLabel(entry);
  const detail = entryDetail(entry);
  const clock = entryClock(entry);
  const hasReview = Boolean(item && (item.rating || item.reflection));
  const protectedRest = Boolean(item?.is_protected_rest && !reservation);
  // Plan-written times are planning estimates (bookings carry real times).
  const estimated = Boolean(item?.source_key && !reservation && entry.time);
  const restClash = !protectedRest ? overlaps?.filter((o) => o.protectedRest) ?? [] : [];
  // On the rest block itself, what's planned inside it is a gentle note, not a warning.
  const insideRest = protectedRest ? overlaps ?? [] : [];
  const otherClash = protectedRest ? [] : overlaps?.filter((o) => !o.protectedRest) ?? [];

  const run = (action: () => Promise<ActionState & { itemId?: string }>, after?: (r: ActionState & { itemId?: string }) => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        after?.(result);
      } else {
        toast.error(result.message ?? "Couldn’t save that. Please try again.");
      }
    });

  const setStatus = (next: ItineraryStatus) =>
    run(
      () => setItineraryStatus(tripId, target, next),
      (r) => {
        if (r.itemId) setCreatedItemId(r.itemId);
        // Offer (never require) a reflection right after finishing something.
        setReflecting(next === "completed");
      },
    );

  // A booking gets its itinerary row first (quietly — nothing to announce yet).
  const openReflectionForBooking = () =>
    startTransition(async () => {
      const result = await addReservationToItinerary(tripId, reservation!.id);
      if (result.ok && result.itemId) {
        setCreatedItemId(result.itemId);
        setReflecting(true);
      } else {
        toast.error(result.message ?? "Couldn’t open the reflection. Please try again.");
      }
    });

  const statusButton = canReview ? (
    <button
      type="button"
      onClick={() => setStatus(status === "completed" ? "planned" : "completed")}
      disabled={pending}
      aria-pressed={status === "completed"}
      aria-label={status === "completed" ? `${title}: done. Mark as planned` : `Mark ${title} as done`}
      title={status === "completed" ? "Done — tap to undo" : "Mark as done"}
      className={cn(
        "focus-ring grid size-11 shrink-0 place-items-center rounded-full transition-colors",
        status === "completed" ? "text-white" : "text-muted-foreground hover:text-moss-ink",
      )}
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full border-2",
          status === "completed" ? "border-moss bg-moss" : "border-input bg-white",
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : status === "completed" ? (
          <Check className="size-4" strokeWidth={3} aria-hidden="true" />
        ) : null}
      </span>
    </button>
  ) : null;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="focus-ring grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-ink"
        aria-label={`Options for ${title}`}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
        {canReview ? (
          <>
            {status !== "completed" ? (
              <DropdownMenuItem className={menuItem} onSelect={() => setStatus("completed")}>
                <Check aria-hidden="true" /> Mark done
              </DropdownMenuItem>
            ) : null}
            {status !== "skipped" ? (
              <DropdownMenuItem className={menuItem} onSelect={() => setStatus("skipped")}>
                <Ban aria-hidden="true" /> Mark skipped
              </DropdownMenuItem>
            ) : null}
            {status !== "planned" ? (
              <DropdownMenuItem className={menuItem} onSelect={() => setStatus("planned")}>
                <RotateCcw aria-hidden="true" /> Back to planned
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className={menuItem}
              onSelect={() => run(() => setItineraryFavorite(tripId, target, !item?.is_favorite))}
            >
              <Heart aria-hidden="true" /> {item?.is_favorite ? "Remove favorite" : "Mark as favorite"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItem}
              onSelect={() => (itemId ? setReflecting(true) : openReflectionForBooking())}
            >
              <NotebookPen aria-hidden="true" /> {hasReview ? "Edit reflection" : "Add a reflection"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {ownPlan && item ? (
          <>
            <DropdownMenuItem
              className={menuItem}
              onSelect={() => editEntry({ item, reservation: null, date: entry.date })}
            >
              <Pencil aria-hidden="true" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => moveEntry(item)}>
              <CalendarArrowUp aria-hidden="true" /> Move to another day
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => duplicateItineraryItem(tripId, item.id))}>
              <Copy aria-hidden="true" /> Duplicate
            </DropdownMenuItem>
          </>
        ) : null}
        {reservation ? (
          <>
            {!isEnd && !cancelled ? (
              <DropdownMenuItem
                className={menuItem}
                onSelect={() => editEntry({ item, reservation, date: entry.date })}
              >
                <StickyNote aria-hidden="true" /> {item?.planning_notes ? "Edit itinerary notes" : "Add itinerary notes"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className={menuItem} onSelect={() => viewBooking(reservation.id)}>
              <Ticket aria-hidden="true" /> View booking
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => editBooking(reservation.id)}>
              <Pencil aria-hidden="true" /> Edit booking
            </DropdownMenuItem>
          </>
        ) : null}
        {ownPlan && item ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className={menuItem} onSelect={() => removeEntry(item)}>
              <Trash2 aria-hidden="true" /> Remove
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const card = (
    <article
      className={cn(
        "card-surface rounded-2xl p-3 sm:p-4",
        protectedRest && "border-[#cfe0b4] bg-[#f1f6e6]",
        (cancelled || status === "skipped") && "bg-secondary/40 shadow-none",
      )}
    >
      <div className="flex items-start gap-3">
        <CategoryIcon
          category={category}
          kind={reservation?.kind}
          icon={protectedRest ? Moon : undefined}
          className={cn("mt-0.5", cancelled && "opacity-60")}
        />
        <div className="min-w-0 flex-1">
          {clock ? (
            <p className={cn("text-sm font-semibold text-ink", variant === "timed" && "sm:hidden")}>
              {clock.time}
              {clock.zone ? <span className="ml-1 font-normal text-muted-foreground">{clock.zone}</span> : null}
              {estimated ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">· Estimated</span> : null}
            </p>
          ) : null}
          {protectedRest || item?.is_optional ? (
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {protectedRest ? <span className="text-[#3d6b2a]">Protected rest</span> : null}
              {protectedRest && item?.is_optional ? " · " : null}
              {item?.is_optional ? "Optional" : null}
            </p>
          ) : null}
          <h4
            className={cn(
              "font-semibold break-words text-ink",
              (cancelled || status === "skipped") && "text-muted-foreground line-through decoration-1",
            )}
          >
            {label ? <span className="mr-1.5 font-medium text-muted-foreground no-underline">{label} ·</span> : null}
            {title}
          </h4>
          {detail ? <p className="mt-0.5 text-sm break-words text-muted-foreground">{detail}</p> : null}

          <Badges entry={entry} status={status} />

          {item?.planning_notes && !isEnd ? (
            <details className="group mt-2 text-sm">
              <summary className="focus-ring -ml-1 flex min-h-9 cursor-pointer list-none items-start gap-1.5 rounded px-1 py-1 text-ink/80 [&::-webkit-details-marker]:hidden">
                <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 line-clamp-1 whitespace-pre-line group-open:line-clamp-none">
                  {item.planning_notes}
                </span>
                <ChevronDown
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
                <span className="sr-only">Show details</span>
              </summary>
            </details>
          ) : null}
          {item?.place && !isEnd ? (
            <a
              href={placeMapsUrl(item.place)}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring mt-1 -ml-1 inline-flex min-h-9 items-center gap-1.5 rounded px-1 text-sm font-semibold text-moss-ink hover:underline"
            >
              Map <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">for {item.place.name} (opens in a new tab)</span>
            </a>
          ) : null}
          {restClash.length ? (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-[#3d6b2a]">
              <Moon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Falls in your protected rest window — fine if that’s intended.
            </p>
          ) : null}
          {insideRest.length ? (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-[#3d6b2a]">
              <Moon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Planned during this rest window: {insideRest.map((o) => o.title).join(", ")}
            </p>
          ) : null}
          {otherClash.length ? (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-gold-ink">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Overlaps with {otherClash.map((o) => o.title).join(", ")}
            </p>
          ) : null}
          {hasReview && !reflecting && item ? <ReviewSummary rating={item.rating} reflection={item.reflection} /> : null}
        </div>
        <div className="-mt-1.5 -mr-1.5 flex shrink-0 items-center">
          {reorder ? (
            <div className="mr-0.5 flex flex-col">
              <ReorderButton direction={-1} entryKey={entry.key} title={title} controls={reorder} />
              <ReorderButton direction={1} entryKey={entry.key} title={title} controls={reorder} />
            </div>
          ) : null}
          {statusButton}
          {menu}
        </div>
      </div>

      {reflecting && itemId ? (
        <ReflectionPanel
          key={itemId}
          tripId={tripId}
          itemId={itemId}
          rating={item?.rating ?? null}
          reflection={item?.reflection ?? null}
          favorite={item?.is_favorite ?? false}
          justCompleted={status === "completed"}
          onDone={() => setReflecting(false)}
        />
      ) : null}

      {variant === "outside" ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {ownPlan && item ? (
            <button type="button" onClick={() => moveEntry(item)} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>
              <CalendarArrowUp className="size-4" aria-hidden="true" /> Move to a trip day
            </button>
          ) : reservation ? (
            <button
              type="button"
              onClick={() => editBooking(reservation.id)}
              className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}
            >
              <Pencil className="size-4" aria-hidden="true" /> Edit booking dates
            </button>
          ) : null}
        </div>
      ) : null}

    </article>
  );

  if (variant !== "timed") return card;

  return (
    <li className="grid grid-cols-[1fr] sm:grid-cols-[5rem_1fr] sm:gap-3">
      <div className="hidden pt-4 text-right sm:block">
        {clock ? (
          <>
            <p className="text-sm font-semibold whitespace-nowrap text-ink">{clock.time}</p>
            {clock.zone ? <p className="text-xs text-muted-foreground">{clock.zone}</p> : null}
            {estimated ? <p className="text-[0.6875rem] text-muted-foreground/90">Estimated</p> : null}
          </>
        ) : null}
      </div>
      <div className="relative pb-3 pl-5 sm:pb-4 before:absolute before:top-0 before:bottom-0 before:left-[5px] before:w-px before:bg-border">
        <span
          className={cn(
            "absolute top-5 left-0 size-[11px] rounded-full ring-4 ring-background",
            cancelled ? "bg-input" : CATEGORY_STYLE[category].dot,
          )}
          aria-hidden="true"
        />
        {card}
      </div>
    </li>
  );
}

function Badges({ entry, status }: { entry: AgendaEntry; status: ItineraryStatus }) {
  const badges: ReactNode[] = [];
  if (entry.cancelled) {
    badges.push(
      <span key="c" className="rounded-full bg-[#fff1ee] px-2.5 py-0.5 text-xs font-semibold text-[#8c2b1f]">
        Cancelled
      </span>,
    );
  } else if (entry.role !== "end") {
    if (status === "completed") {
      badges.push(
        <span key="d" className="inline-flex items-center gap-1 rounded-full bg-moss-soft px-2.5 py-0.5 text-xs font-semibold text-moss-ink">
          <Check className="size-3" strokeWidth={3} aria-hidden="true" /> Done
        </span>,
      );
    } else if (status === "skipped") {
      badges.push(
        <span key="s" className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          <CircleDashed className="size-3" aria-hidden="true" /> Skipped
        </span>,
      );
    }
    if (entry.item?.is_favorite) {
      badges.push(
        <span key="f" className="inline-flex items-center gap-1 rounded-full bg-[#ffe9e4] px-2.5 py-0.5 text-xs font-semibold text-[#a33a2b]">
          <Heart className="size-3 fill-current" aria-hidden="true" /> Favorite
        </span>,
      );
    }
  }
  return badges.length ? <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div> : null;
}

function ReviewSummary({ rating, reflection }: { rating: number | null; reflection: string | null }) {
  return (
    <div className="mt-2 rounded-xl bg-gold-soft/60 px-3 py-2 text-sm">
      {rating ? <Stars value={rating} /> : null}
      {reflection ? <p className="line-clamp-3 whitespace-pre-line text-ink/90 italic">“{reflection}”</p> : null}
    </div>
  );
}

function ReflectionPanel({
  tripId,
  itemId,
  rating: initialRating,
  reflection,
  favorite,
  justCompleted,
  onDone,
}: {
  tripId: string;
  itemId: string;
  rating: number | null;
  reflection: string | null;
  favorite: boolean;
  justCompleted: boolean;
  onDone: () => void;
}) {
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveReflection(tripId, itemId, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onDone();
    }
    return result;
  });
  const prefix = `reflect-${itemId}`;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 space-y-3 rounded-xl border border-border bg-background p-3.5">
      <p className="text-sm font-semibold text-ink">
        {justCompleted ? "How was it? " : "Your reflection "}
        <span className="font-normal text-muted-foreground">Optional — saved to Memories.</span>
      </p>
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <StarRatingInput defaultValue={initialRating} />
      <TextAreaField
        idPrefix={prefix}
        name="reflection"
        label="Reflection"
        defaultValue={reflection ?? ""}
        error={state.fieldErrors?.reflection}
        optional
        maxLength={5000}
        placeholder="What do you want to remember?"
        className="min-h-20"
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" name="is_favorite" defaultChecked={favorite} className="size-5 accent-coral" />
        A trip favorite
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDone} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>
          Not now
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…" className="min-h-10 px-4 text-sm">
          Save reflection
        </SubmitButton>
      </div>
    </form>
  );
}

function ReorderButton({
  direction,
  entryKey,
  title,
  controls,
}: {
  direction: -1 | 1;
  entryKey: string;
  title: string;
  controls: ReorderControls;
}) {
  const enabled = direction === -1 ? controls.canUp : controls.canDown;
  const Icon = direction === -1 ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      id={`reorder-${direction === -1 ? "up" : "down"}-${entryKey}`}
      onClick={() => controls.onMove(direction)}
      disabled={!enabled || controls.pending}
      aria-label={`Move ${title} ${direction === -1 ? "up" : "down"}`}
      className="focus-ring grid h-6 w-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
