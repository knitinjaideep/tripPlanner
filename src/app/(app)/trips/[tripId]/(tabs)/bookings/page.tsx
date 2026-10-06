import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { BookingSummaryRow } from "@/components/trip/overview-cards";
import { DocumentRow } from "@/components/trip/document-row";
import { AddBookingButton, AddDocumentButton } from "@/components/trip/trip-workspace";
import { getTripForUser } from "@/lib/dal";
import { daysUntil, formatDayDate } from "@/lib/dates";
import type { Reservation } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/bookings">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Bookings · ${trip.title}` : "Bookings" };
}

function groupByDay(bookings: Reservation[]) {
  const groups = new Map<string, Reservation[]>();
  for (const b of bookings) {
    const key = b.start_date ?? "unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return [...groups.entries()];
}

export default async function TripBookingsPage({ params }: PageProps<"/trips/[tripId]/bookings">) {
  const { tripId } = await params;
  const trip = await getTripForUser(tripId);
  if (!trip) notFound();

  const groups = groupByDay(trip.reservations);
  const titles = new Map(trip.reservations.map((b) => [b.id, b.title]));

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
      <section aria-labelledby="bookings-heading" className="lg:col-span-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="bookings-heading" className="font-display text-3xl font-semibold text-ink">
              Bookings
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {trip.reservations.length === 0
                ? "Nothing saved yet."
                : `${trip.reservations.length} ${trip.reservations.length === 1 ? "reservation" : "reservations"}, in order. Times are local.`}
            </p>
          </div>
          <AddBookingButton className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral px-5 text-[0.9375rem] font-semibold text-white hover:bg-coral-hover">
            <Plus className="size-4" aria-hidden="true" /> Add booking
          </AddBookingButton>
        </div>

        {groups.length === 0 ? (
          <div className="card-surface mt-6 p-8 text-center">
            <h3 className="font-display text-2xl font-semibold text-ink">Your reservations live here</h3>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              Flights, stays, car rentals, tables and tours — add each one with its confirmation number so it’s
              always easy to find.
            </p>
            <AddBookingButton className="focus-ring mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-teal-ink px-5 text-[0.9375rem] font-semibold text-teal-ink hover:bg-teal-soft">
              <Plus className="size-4" aria-hidden="true" /> Add your first booking
            </AddBookingButton>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {groups.map(([day, items]) => {
              const inTrip = day !== "unscheduled" && day >= trip.start_date && day <= trip.end_date;
              return (
                <section key={day} aria-label={day === "unscheduled" ? "No date" : formatDayDate(day)}>
                  <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-ink">
                    {day === "unscheduled" ? "No date yet" : formatDayDate(day)}
                    {inTrip ? (
                      <span className="font-normal text-muted-foreground">
                        · Day {daysUntil(day, trip.start_date) + 1}
                      </span>
                    ) : null}
                  </h3>
                  <ul className="space-y-3">
                    {items.map((b) => (
                      <li key={b.id}>
                        <BookingSummaryRow booking={b} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <aside id="documents" aria-labelledby="documents-heading" className="scroll-mt-24 lg:col-span-4">
        <div className="rounded-2xl bg-lavender p-5 sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-3">
            <h2 id="documents-heading" className="eyebrow flex items-center gap-2 text-lavender-ink">
              <FileText className="size-4" aria-hidden="true" /> All documents
            </h2>
            <AddDocumentButton className="focus-ring -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-lavender-ink hover:bg-white/60">
              <Plus className="size-4" aria-hidden="true" /> Add link
            </AddDocumentButton>
          </div>
          {trip.documents.length === 0 ? (
            <p className="mt-4 rounded-xl bg-white/70 p-4 text-sm text-[#4f4a63]">
              No links yet. Add a Drive folder for the whole trip, or attach files to a specific booking.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {trip.documents.map((d) => (
                <DocumentRow
                  key={d.id}
                  doc={d}
                  context={d.reservation_id ? titles.get(d.reservation_id) : "Whole trip"}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
