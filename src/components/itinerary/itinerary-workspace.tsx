"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deleteItineraryItem, moveItineraryItem } from "@/app/actions/itinerary";
import { SelectField, secondaryButtonClass } from "@/components/forms/fields";
import { ConfirmDialog } from "@/components/trip/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { itineraryHref } from "@/lib/itinerary-format";
import { entryTitle } from "@/lib/schedule";
import type { ItineraryEntry, Reservation } from "@/lib/types";
import { ItineraryForm } from "./itinerary-form";
import type { ActivityFormMode, ExplorePlace, TripDayOption } from "./types";

type SheetState =
  | { open: false }
  | {
      open: true;
      mode: ActivityFormMode;
      date: string;
      item: ItineraryEntry | null;
      reservation: Reservation | null;
    };

type Ctx = {
  tripId: string;
  selectedDate: string;
  showCancelled: boolean;
  days: TripDayOption[];
  addActivity: (mode?: ActivityFormMode) => void;
  editEntry: (entry: { item: ItineraryEntry | null; reservation: Reservation | null; date: string }) => void;
  moveEntry: (item: ItineraryEntry) => void;
  removeEntry: (item: ItineraryEntry) => void;
  goToDay: (date: string) => void;
};

const ItineraryContext = createContext<Ctx | null>(null);

export function useItinerary() {
  const ctx = useContext(ItineraryContext);
  if (!ctx) throw new Error("useItinerary must be used inside <ItineraryWorkspace>");
  return ctx;
}

const modeFor = (item: ItineraryEntry | null, reservation: Reservation | null): ActivityFormMode =>
  reservation ? "booking" : item?.place_id ? "place" : "activity";

/**
 * Client coordinator for the itinerary page: the add / edit sheet, the
 * move-to-day dialog and the remove confirmation. Data arrives as props
 * from the server page and refreshes via revalidatePath after each action.
 */
export function ItineraryWorkspace({
  tripId,
  tripTimeZone,
  selectedDate,
  showCancelled,
  days,
  places,
  bookings,
  linkedBookingIds,
  children,
}: {
  tripId: string;
  tripTimeZone: string;
  selectedDate: string;
  showCancelled: boolean;
  days: TripDayOption[];
  places: ExplorePlace[];
  bookings: Reservation[];
  linkedBookingIds: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [moving, setMoving] = useState<ItineraryEntry | null>(null);
  const [removing, setRemoving] = useState<ItineraryEntry | null>(null);

  const goToDay = (date: string) => router.push(itineraryHref(tripId, date, showCancelled), { scroll: false });
  const dayLabel = (date: string) => days.find((d) => d.date === date)?.label ?? date;

  const ctx: Ctx = {
    tripId,
    selectedDate,
    showCancelled,
    days,
    addActivity: (mode = "activity") => setSheet({ open: true, mode, date: selectedDate, item: null, reservation: null }),
    editEntry: ({ item, reservation, date }) =>
      setSheet({ open: true, mode: modeFor(item, reservation), date, item, reservation }),
    moveEntry: setMoving,
    removeEntry: setRemoving,
    goToDay,
  };

  const close = () => setSheet({ open: false });
  const editing = sheet.open && Boolean(sheet.item || sheet.reservation);
  const title = !sheet.open
    ? ""
    : editing
      ? sheet.reservation
        ? "Itinerary notes"
        : "Edit activity"
      : "Add to your day";

  return (
    <ItineraryContext.Provider value={ctx}>
      {children}

      <Sheet open={sheet.open} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="right"
          className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader className="gap-1 px-5 pt-5 pb-4 pr-16 sm:px-6">
            <SheetTitle className="font-display text-2xl leading-tight font-semibold text-ink">{title}</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {sheet.open
                ? sheet.reservation
                  ? sheet.reservation.title
                  : sheet.item
                    ? entryTitle(sheet.item)
                    : `Only a name is needed — times are optional.`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {sheet.open ? (
            <ItineraryForm
              key={`${sheet.item?.id ?? sheet.reservation?.id ?? "new"}-${sheet.mode}`}
              tripId={tripId}
              tripTimeZone={tripTimeZone}
              days={days}
              places={places}
              bookings={bookings}
              linkedBookingIds={linkedBookingIds}
              mode={sheet.mode}
              date={sheet.date}
              item={sheet.item}
              reservation={sheet.reservation}
              onCancel={close}
              onSaved={(date) => {
                close();
                if (date && date !== selectedDate && days.some((d) => d.date === date)) goToDay(date);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <MoveDialog
        key={moving?.id ?? "none"}
        item={moving}
        days={days}
        onClose={() => setMoving(null)}
        onMoved={(date) => {
          setMoving(null);
          toast.success(`Moved to ${dayLabel(date)}.`, {
            action: date !== selectedDate ? { label: "View day", onClick: () => goToDay(date) } : undefined,
          });
        }}
        tripId={tripId}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove from the itinerary?"
        description={
          removing
            ? [
                `“${entryTitle(removing)}” will be removed from your plans.`,
                removing.place_id ? "The place stays in Explore." : null,
                removing.reflection || removing.rating ? "Its rating and reflection will be deleted too." : null,
              ]
                .filter(Boolean)
                .join(" ")
            : ""
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          const result = await deleteItineraryItem(tripId, removing.id);
          if (result.ok) {
            toast.success(result.message);
            setRemoving(null);
          } else {
            toast.error(result.message ?? "Couldn’t remove that.");
          }
        }}
      />
    </ItineraryContext.Provider>
  );
}

function MoveDialog({
  tripId,
  item,
  days,
  onClose,
  onMoved,
}: {
  tripId: string;
  item: ItineraryEntry | null;
  days: TripDayOption[];
  onClose: () => void;
  onMoved: (date: string) => void;
}) {
  const inTrip = item?.local_date && days.some((d) => d.date === item.local_date);
  const [date, setDate] = useState(inTrip ? item!.local_date! : days[0]?.date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="rounded-2xl bg-background p-6 sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-display text-2xl font-semibold text-ink">Move to another day</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {item ? `${entryTitle(item)} keeps its times and notes.` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!item) return;
            setError(null);
            startTransition(async () => {
              const result = await moveItineraryItem(tripId, item.id, date);
              if (result.ok) onMoved(date);
              else setError(result.message ?? "Couldn’t move that.");
            });
          }}
          className="space-y-5"
        >
          <SelectField
            idPrefix="move"
            name="date"
            label="Day"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            options={days.map((d) => ({ value: d.date, label: d.label }))}
            error={error ? [error] : undefined}
          />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || date === item?.local_date}
              aria-busy={pending}
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-coral px-5 text-[0.9375rem] font-semibold text-white hover:bg-coral-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? "Moving…" : "Move"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Add activity" trigger usable from server-rendered markup. */
export function AddActivityButton({
  mode,
  className,
  children,
}: {
  mode?: ActivityFormMode;
  className?: string;
  children: ReactNode;
}) {
  const { addActivity } = useItinerary();
  return (
    <button type="button" onClick={() => addActivity(mode)} className={className}>
      {children}
    </button>
  );
}
