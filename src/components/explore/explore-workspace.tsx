"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePlace } from "@/app/actions/places";
import { ConfirmDialog } from "@/components/trip/confirm-dialog";
import { useTripAccess } from "@/components/trip/trip-access";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { exploreHref, type ExploreFilters } from "@/lib/explore";
import type { PlaceWithVisits } from "@/lib/types";
import { PlaceForm } from "./place-form";

type Ctx = {
  tripId: string;
  newPlace: () => void;
  editPlace: (place: PlaceWithVisits) => void;
  removePlace: (place: PlaceWithVisits) => void;
};

const ExploreContext = createContext<Ctx | null>(null);

export function useExplore() {
  const ctx = useContext(ExploreContext);
  if (!ctx) throw new Error("useExplore must be used inside <ExploreWorkspace>");
  return ctx;
}

type Removing = { place: PlaceWithVisits; visits: number } | null;

/**
 * Client coordinator for Explore: the add / edit sheet and the delete
 * confirmation. The place detail sheet is driven by `?place=` in the URL.
 */
export function ExploreWorkspace({
  tripId,
  places,
  filters,
  children,
}: {
  tripId: string;
  places: PlaceWithVisits[];
  /** Current filters, kept when opening or closing a place. */
  filters: ExploreFilters;
  children: ReactNode;
}) {
  const router = useRouter();
  const placeHref = (id: string) => exploreHref(tripId, filters, id);
  const closeHref = exploreHref(tripId, filters);
  const [form, setForm] = useState<{ open: boolean; place?: PlaceWithVisits }>({ open: false });
  const [removing, setRemoving] = useState<Removing>(null);

  const ctx: Ctx = {
    tripId,
    newPlace: () => setForm({ open: true }),
    editPlace: (place) => setForm({ open: true, place }),
    removePlace: (place) => setRemoving({ place, visits: place.visit_count }),
  };

  const removingText = (r: NonNullable<Removing>) => {
    if (r.visits === 0) return `“${r.place.name}” will be removed from Explore.`;
    const done = r.place.completed_count;
    return [
      `“${r.place.name}” is on your itinerary ${r.visits === 1 ? "once" : `${r.visits} times`}${done ? ` (${done} completed)` : ""}.`,
      "Removing the place keeps those visits — with their notes, ratings and reflections — as activities named",
      `“${r.place.name}”. Only the place’s own details (address, links, shared notes) are deleted.`,
    ].join(" ");
  };

  return (
    <ExploreContext.Provider value={ctx}>
      {children}

      <Sheet open={form.open} onOpenChange={(open) => !open && setForm({ open: false })}>
        <SheetContent
          side="right"
          className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader className="gap-1 px-5 pt-5 pb-4 pr-16 sm:px-6">
            <SheetTitle className="font-display text-2xl leading-tight font-semibold text-ink">
              {form.place ? "Edit place" : "Save a place"}
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {form.place ? form.place.name : "Somewhere you heard about — only a name is needed."}
            </SheetDescription>
          </SheetHeader>
          {form.open ? (
            <PlaceForm
              key={form.place?.id ?? "new"}
              tripId={tripId}
              place={form.place}
              existing={places}
              onCancel={() => setForm({ open: false })}
              onSaved={(id) => {
                const isNew = !form.place;
                setForm({ open: false });
                // A new place opens straight into its detail, ready to schedule.
                if (isNew && id) router.push(placeHref(id), { scroll: false });
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing && removing.visits > 0 ? "Remove the place, keep its visits?" : "Remove this place?"}
        description={removing ? removingText(removing) : ""}
        confirmLabel={removing && removing.visits > 0 ? "Remove place, keep visits" : "Remove place"}
        onConfirm={async () => {
          if (!removing) return;
          // Without known visits, ask the server to refuse if some exist — then explain.
          const result = await deletePlace(tripId, removing.place.id, removing.visits > 0 ? "detach" : "block");
          if (result.ok) {
            toast.success(result.message);
            setRemoving(null);
            router.push(closeHref, { scroll: false });
          } else if (result.visits) {
            setRemoving({ place: removing.place, visits: result.visits });
          } else {
            toast.error(result.message ?? "Couldn’t remove that place.");
          }
        }}
      />
    </ExploreContext.Provider>
  );
}

/** "Add place" trigger usable from server-rendered markup. */
export function AddPlaceButton({ className, children }: { className?: string; children: ReactNode }) {
  const { newPlace } = useExplore();
  const { canEdit } = useTripAccess();
  if (!canEdit) return null;
  return (
    <button type="button" onClick={newPlace} className={className}>
      {children}
    </button>
  );
}
