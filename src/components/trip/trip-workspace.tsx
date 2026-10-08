"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteReservation } from "@/app/actions/reservations";
import { deleteDocument } from "@/app/actions/documents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { secondaryButtonClass } from "@/components/forms/fields";
import { ReminderButton } from "@/components/reminders/reminders-provider";
import { Attribution, useTripAccess } from "./trip-access";
import { BOOKING_KIND_META } from "@/lib/booking-kinds";
import { formatMoment, stayNights } from "@/lib/booking-format";
import { useDisplayPrefs } from "@/components/settings/settings-provider";
import { readDetails } from "@/lib/reservation-details";
import type { Reservation, ReservationKind, TripDocument } from "@/lib/types";
import { BookingForm } from "./booking-form";
import { BookingIcon } from "./booking-icon";
import { ConfirmDialog } from "./confirm-dialog";
import { CopyButton } from "./copy-button";
import { DocumentForm } from "./document-form";
import { DocumentRow } from "./document-row";

type SheetState =
  | { open: false; mode?: undefined }
  | { open: true; mode: "view" | "edit"; bookingId: string }
  | { open: true; mode: "create"; kind: ReservationKind };

type DocDialogState = { open: boolean; doc?: TripDocument; bookingId?: string | null };

type Workspace = {
  tripId: string;
  viewBooking: (id: string) => void;
  editBooking: (id: string) => void;
  newBooking: (kind?: ReservationKind) => void;
  newDocument: (bookingId?: string | null) => void;
  editDocument: (doc: TripDocument) => void;
  removeDocument: (doc: TripDocument) => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function useTripWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useTripWorkspace must be used inside <TripWorkspace>");
  return ctx;
}

/**
 * Client-side coordinator for a trip's booking sheet, document dialog and
 * delete confirmations. Server-rendered pages place small trigger buttons
 * that call into this context; data arrives as props and refreshes via
 * revalidatePath after every mutation.
 */
export function TripWorkspace({
  tripId,
  tripTimeZone,
  bookings,
  documents,
  children,
}: {
  tripId: string;
  tripTimeZone: string;
  bookings: Reservation[];
  documents: TripDocument[];
  children: ReactNode;
}) {
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [docDialog, setDocDialog] = useState<DocDialogState>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<
    { type: "booking"; booking: Reservation } | { type: "document"; doc: TripDocument } | null
  >(null);

  const activeBooking = sheet.open && sheet.mode !== "create" ? bookings.find((b) => b.id === sheet.bookingId) : undefined;

  // A reminder's link (?booking=…) opens that booking, showing its CURRENT details. Opening changes nothing.
  const bookingParam = useSearchParams().get("booking");
  const openedFromLink = useRef<string | null>(null);
  useEffect(() => {
    if (!bookingParam || openedFromLink.current === bookingParam || !/^[0-9a-f-]{36}$/i.test(bookingParam)) return;
    openedFromLink.current = bookingParam;
    setSheet({ open: true, mode: "view", bookingId: bookingParam });
  }, [bookingParam]);

  const workspace: Workspace = {
    tripId,
    viewBooking: (id) => setSheet({ open: true, mode: "view", bookingId: id }),
    editBooking: (id) => setSheet({ open: true, mode: "edit", bookingId: id }),
    newBooking: (kind = "flight") => setSheet({ open: true, mode: "create", kind }),
    newDocument: (bookingId = null) => setDocDialog({ open: true, bookingId }),
    editDocument: (doc) => setDocDialog({ open: true, doc }),
    removeDocument: (doc) => setPendingDelete({ type: "document", doc }),
  };

  const closeSheet = () => setSheet({ open: false });

  let sheetTitle = "Add a booking";
  let sheetDescription = "Record a reservation you’ve made elsewhere.";
  if (sheet.open && sheet.mode === "edit" && activeBooking) {
    sheetTitle = "Edit booking";
    sheetDescription = activeBooking.title;
  } else if (sheet.open && sheet.mode === "view" && activeBooking) {
    sheetTitle = activeBooking.title;
    sheetDescription = BOOKING_KIND_META[activeBooking.kind].label;
  }

  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}

      <Sheet open={sheet.open} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent
          side="right"
          className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader className="gap-1 px-5 pt-5 pb-4 pr-16 sm:px-6">
            {sheet.open && sheet.mode === "view" && activeBooking ? (
              <div className="mb-2">
                <BookingIcon kind={activeBooking.kind} />
              </div>
            ) : null}
            <SheetTitle className="font-display text-2xl leading-tight font-semibold text-ink">{sheetTitle}</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">{sheetDescription}</SheetDescription>
          </SheetHeader>

          {sheet.open && sheet.mode === "create" ? (
            <BookingForm
              key={`create-${sheet.kind}`}
              tripId={tripId}
              tripTimeZone={tripTimeZone}
              initialKind={sheet.kind}
              onCancel={closeSheet}
              onSaved={closeSheet}
            />
          ) : null}

          {sheet.open && sheet.mode === "edit" && activeBooking ? (
            <BookingForm
              key={`edit-${activeBooking.id}`}
              tripId={tripId}
              tripTimeZone={tripTimeZone}
              booking={activeBooking}
              onCancel={() => setSheet({ open: true, mode: "view", bookingId: activeBooking.id })}
              onSaved={() => setSheet({ open: true, mode: "view", bookingId: activeBooking.id })}
            />
          ) : null}

          {sheet.open && sheet.mode === "view" && activeBooking ? (
            <BookingDetails
              booking={activeBooking}
              documents={documents.filter((d) => d.reservation_id === activeBooking.id)}
              onEdit={() => setSheet({ open: true, mode: "edit", bookingId: activeBooking.id })}
              onDelete={() => setPendingDelete({ type: "booking", booking: activeBooking })}
              onAddDocument={() => workspace.newDocument(activeBooking.id)}
            />
          ) : null}

          {sheet.open && sheet.mode !== "create" && !activeBooking ? (
            <p className="px-6 text-muted-foreground">This booking no longer exists.</p>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={docDialog.open} onOpenChange={(open) => !open && setDocDialog({ open: false })}>
        <DialogContent className="rounded-2xl bg-background p-6 sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-display text-2xl font-semibold text-ink">
              {docDialog.doc ? "Edit link" : "Add a document link"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Keep tickets, IDs and confirmations one tap away.
            </DialogDescription>
          </DialogHeader>
          {docDialog.open ? (
            <DocumentForm
              key={docDialog.doc?.id ?? `new-${docDialog.bookingId ?? "trip"}`}
              tripId={tripId}
              doc={docDialog.doc}
              bookingId={docDialog.bookingId}
              bookings={bookings}
              onCancel={() => setDocDialog({ open: false })}
              onSaved={() => setDocDialog({ open: false })}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete?.type === "booking" ? "Delete this booking?" : "Remove this link?"}
        description={
          pendingDelete?.type === "booking"
            ? `“${pendingDelete.booking.title}” will be removed from this trip. Document links attached to it stay on the trip, and if it’s on your itinerary with notes or a review, that entry is kept.`
            : pendingDelete?.type === "document"
              ? `“${pendingDelete.doc.label}” will be removed from Atlas. The file itself is not touched.`
              : ""
        }
        confirmLabel={pendingDelete?.type === "booking" ? "Delete booking" : "Remove link"}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const result =
            pendingDelete.type === "booking"
              ? await deleteReservation(tripId, pendingDelete.booking.id)
              : await deleteDocument(tripId, pendingDelete.doc.id);
          if (result.ok) {
            toast.success(result.message);
            if (pendingDelete.type === "booking") closeSheet();
            setPendingDelete(null);
          } else {
            toast.error(result.message ?? "Couldn’t delete that.");
          }
        }}
      />
    </WorkspaceContext.Provider>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[0.9375rem] break-words text-ink">{children}</dd>
    </div>
  );
}

function BookingDetails({
  booking: b,
  documents,
  onEdit,
  onDelete,
  onAddDocument,
}: {
  booking: Reservation;
  documents: TripDocument[];
  onEdit: () => void;
  onDelete: () => void;
  onAddDocument: () => void;
}) {
  const { clock: clockPref } = useDisplayPrefs();
  const meta = BOOKING_KIND_META[b.kind];
  const start = formatMoment(b.start_date, b.start_time, false, b.start_time_zone, clockPref);
  const end = formatMoment(b.end_date, b.end_time, false, b.end_time_zone, clockPref);
  const nights = stayNights(b);
  const { canEdit } = useTripAccess();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 sm:px-6">
        {b.status === "cancelled" ? (
          <p className="rounded-2xl border border-[#f3c6bf] bg-[#fff1ee] px-4 py-3 text-sm text-[#8c2b1f]">
            <span className="font-semibold">Cancelled.</span> Kept for your records and hidden from the itinerary by
            default. Edit the booking to restore it.
          </p>
        ) : null}
        {b.confirmation_code ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-gold-soft px-4 py-3">
            <div className="min-w-0">
              <p className="eyebrow text-gold-ink">Confirmation</p>
              <p className="mt-1 truncate font-mono text-lg font-semibold tracking-wider text-ink">
                {b.confirmation_code}
              </p>
            </div>
            <CopyButton value={b.confirmation_code} label="Confirmation number" />
          </div>
        ) : null}

        <dl className="divide-y divide-border rounded-2xl border border-border bg-surface px-4">
          {b.provider ? <Detail label={meta.providerLabel}>{b.provider}</Detail> : null}
          {readDetails(b.kind, b.details).map((field) => (
            <Detail key={field.key} label={field.label}>
              <span className={field.mono ? "font-mono tracking-wide" : undefined}>{field.value}</span>
            </Detail>
          ))}
          {b.origin || b.destination ? (
            <Detail label="Route">
              {b.origin ?? "—"} → {b.destination ?? "—"}
            </Detail>
          ) : null}
          {b.location ? <Detail label="Location">{b.location}</Detail> : null}
          <Detail label={meta.startLabel}>{start ?? <span className="text-muted-foreground">Not set</span>}</Detail>
          {end ? <Detail label={meta.endLabel}>{end}</Detail> : null}
          {nights ? <Detail label="Length">{nights === 1 ? "1 night" : `${nights} nights`}</Detail> : null}
          {b.booking_url ? (
            <Detail label="Booking link">
              <a
                href={b.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex items-center gap-1.5 rounded font-medium text-moss-ink underline-offset-4 hover:underline"
              >
                Open booking <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Detail>
          ) : null}
        </dl>

        {b.notes ? (
          <section>
            <h3 className="text-sm font-semibold text-ink">Notes</h3>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed whitespace-pre-line text-muted-foreground">{b.notes}</p>
          </section>
        ) : null}

        <section aria-label="Reminder" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {b.status === "cancelled" ? "A cancelled booking has no reminders." : "Get a heads-up before this starts — only for the people you choose."}
          </p>
          <ReminderButton type="booking" id={b.id} />
        </section>

        <section className="rounded-2xl bg-surface-warm p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="eyebrow text-earth-ink">Documents</h3>
            {canEdit ? (
              <button
                type="button"
                onClick={onAddDocument}
                className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-earth-ink hover:bg-white/60"
              >
                <Plus className="size-4" aria-hidden="true" /> Add link
              </button>
            ) : null}
          </div>
          {documents.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {documents.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-earth-ink">
              {canEdit ? "Attach the ticket, voucher or confirmation from Drive." : "No document links yet."}
            </p>
          )}
        </section>
        <Attribution createdBy={b.created_by} updatedBy={b.updated_by} />
      </div>

      {canEdit ? (
        <div className="space-y-2 border-t border-border bg-surface px-5 py-4 sm:px-6">
          <p className="text-xs text-muted-foreground">
            This is your record in Atlas. Editing or deleting it doesn’t change or cancel the real reservation.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onDelete}
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[0.9375rem] font-semibold text-destructive hover:bg-[#fff1ee]"
            >
              <Trash2 className="size-4" aria-hidden="true" /> Delete
            </button>
            <button type="button" onClick={onEdit} className={`${secondaryButtonClass} ml-auto`}>
              <Pencil className="size-4" aria-hidden="true" /> Edit
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Small triggers usable from Server Components ---------- */

export function AddBookingButton({
  kind,
  children,
  className,
}: {
  kind?: ReservationKind;
  children: ReactNode;
  className?: string;
}) {
  const { newBooking } = useTripWorkspace();
  const { canEdit } = useTripAccess();
  if (!canEdit) return null;
  return (
    <button type="button" onClick={() => newBooking(kind)} className={className}>
      {children}
    </button>
  );
}

export function ViewBookingButton({
  bookingId,
  children,
  className,
  label,
}: {
  bookingId: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const { viewBooking } = useTripWorkspace();
  return (
    <button type="button" onClick={() => viewBooking(bookingId)} className={className} aria-label={label}>
      {children}
    </button>
  );
}

export function AddDocumentButton({ children, className }: { children: ReactNode; className?: string }) {
  const { newDocument } = useTripWorkspace();
  const { canEdit } = useTripAccess();
  if (!canEdit) return null;
  return (
    <button type="button" onClick={() => newDocument(null)} className={className}>
      {children}
    </button>
  );
}
