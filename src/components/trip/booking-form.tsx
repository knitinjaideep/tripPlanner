"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveReservation } from "@/app/actions/reservations";
import { BOOKING_KIND_META } from "@/lib/booking-kinds";
import { toTimeInput } from "@/lib/dates";
import { DETAIL_FIELDS } from "@/lib/reservation-details";
import { RESERVATION_KINDS, type ActionState, type Reservation, type ReservationKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  FormMessage,
  SubmitButton,
  TextAreaField,
  TextField,
  TimeZoneField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { BOOKING_ICONS } from "./booking-icon";

type Props = {
  tripId: string;
  /** Default zone for new times — the trip's destination zone. */
  tripTimeZone: string;
  booking?: Reservation;
  initialKind?: ReservationKind;
  onCancel: () => void;
  onSaved: () => void;
};

export function BookingForm({ tripId, tripTimeZone, booking, initialKind = "flight", onCancel, onSaved }: Props) {
  const [kind, setKind] = useState<ReservationKind>(booking?.kind ?? initialKind);
  const meta = BOOKING_KIND_META[kind];
  const { state, onSubmit, pending } = useFormAction(
    async (prev: ActionState, formData: FormData) => {
      const result = await saveReservation(tripId, booking?.id ?? null, prev, formData);
      if (result.ok) {
        toast.success(result.message);
        onSaved();
      }
      return result;
    },
  );
  const errors = state.fieldErrors ?? {};
  const p = "booking";
  const detailFields = DETAIL_FIELDS[kind];
  const storedDetails = booking?.kind === kind ? (booking.details as Record<string, unknown>) : {};
  const detailDefault = (key: string) => {
    const value = storedDetails[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 sm:px-6">
        <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />

        <fieldset>
          <legend className="mb-2.5 text-sm font-semibold text-ink">Type</legend>
          <div className="flex flex-wrap gap-2">
            {RESERVATION_KINDS.map((k) => {
              const Icon = BOOKING_ICONS[k];
              return (
                <label key={k} className="cursor-pointer">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-white px-3.5 text-sm font-medium text-ink transition-colors",
                      "peer-checked:border-moss peer-checked:bg-moss-soft peer-checked:text-moss-ink peer-focus-visible:ring-3 peer-focus-visible:ring-moss/40",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {BOOKING_KIND_META[k].label}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <TextField
          idPrefix={p}
          name="title"
          label="Name"
          placeholder={meta.titlePlaceholder}
          defaultValue={booking?.title}
          error={errors.title}
          required
          maxLength={160}
          autoComplete="off"
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            idPrefix={p}
            name="provider"
            label={meta.providerLabel}
            defaultValue={booking?.provider ?? ""}
            error={errors.provider}
            optional
            maxLength={120}
            autoComplete="off"
          />
          <TextField
            idPrefix={p}
            name="confirmation_code"
            label="Confirmation code"
            defaultValue={booking?.confirmation_code ?? ""}
            error={errors.confirmation_code}
            optional
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-wide"
          />
        </div>

        {meta.route ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              idPrefix={p}
              name="origin"
              label="From"
              placeholder={kind === "flight" ? "EWR or Newark" : "Pick-up place"}
              defaultValue={booking?.origin ?? ""}
              error={errors.origin}
              optional
              maxLength={120}
            />
            <TextField
              idPrefix={p}
              name="destination"
              label="To"
              placeholder={kind === "flight" ? "AUA or Aruba" : "Drop-off place"}
              defaultValue={booking?.destination ?? ""}
              error={errors.destination}
              optional
              maxLength={120}
            />
          </div>
        ) : (
          <TextField
            idPrefix={p}
            name="location"
            label="Address or area"
            defaultValue={booking?.location ?? ""}
            error={errors.location}
            optional
            maxLength={240}
          />
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">
            {meta.startLabel}
            <span className="ml-1 font-normal text-muted-foreground">(local time)</span>
          </legend>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <TextField idPrefix={p} name="start_date" label="Date" type="date" defaultValue={booking?.start_date ?? ""} error={errors.start_date} />
            <TextField idPrefix={p} name="start_time" label="Time" type="time" defaultValue={toTimeInput(booking?.start_time ?? null)} error={errors.start_time} className="w-[8.5rem]" />
          </div>
          <TimeZoneField
            idPrefix={p}
            name="start_time_zone"
            label={meta.route ? `${meta.startLabel} time zone` : "Time zone"}
            defaultValue={booking?.start_time_zone ?? tripTimeZone}
            error={errors.start_time_zone}
          />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">
            {meta.endLabel}
            <span className="ml-1 font-normal text-muted-foreground">(optional, local time)</span>
          </legend>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <TextField idPrefix={p} name="end_date" label="Date" type="date" defaultValue={booking?.end_date ?? ""} error={errors.end_date} />
            <TextField idPrefix={p} name="end_time" label="Time" type="time" defaultValue={toTimeInput(booking?.end_time ?? null)} error={errors.end_time} className="w-[8.5rem]" />
          </div>
          {meta.route ? (
            <TimeZoneField
              idPrefix={p}
              name="end_time_zone"
              label={`${meta.endLabel} time zone`}
              defaultValue={booking?.end_time_zone ?? tripTimeZone}
              error={errors.end_time_zone}
            />
          ) : null}
        </fieldset>

        {detailFields.length > 0 ? (
          <fieldset key={kind} className="grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">{meta.label} details</legend>
            {detailFields.map((field) => (
              <TextField
                key={field.key}
                idPrefix={p}
                name={`details.${field.key}`}
                label={field.label}
                placeholder={field.placeholder}
                defaultValue={detailDefault(field.key)}
                error={errors[`details.${field.key}`]}
                optional
                maxLength={field.max}
                inputMode={field.numeric ? "numeric" : undefined}
                autoComplete="off"
                spellCheck={field.mono ? false : undefined}
                className={field.mono ? "font-mono tracking-wide" : undefined}
              />
            ))}
          </fieldset>
        ) : null}

        <TextField
          idPrefix={p}
          name="booking_url"
          label="Booking link"
          type="url"
          inputMode="url"
          placeholder="https://"
          defaultValue={booking?.booking_url ?? ""}
          error={errors.booking_url}
          optional
          hint="Manage-booking page or confirmation email."
        />
        <TextAreaField
          idPrefix={p}
          name="notes"
          label="Notes"
          defaultValue={booking?.notes ?? ""}
          error={errors.notes}
          optional
          maxLength={5000}
          placeholder="Seats, room type, cancellation deadline…"
        />

        {booking ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-input bg-white p-3.5">
            <input
              type="checkbox"
              name="cancelled"
              defaultChecked={booking.status === "cancelled"}
              className="mt-0.5 size-5 shrink-0 accent-destructive"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">This booking was cancelled</span>
              <span className="block text-sm text-muted-foreground">
                It stays here with its confirmation, but is hidden from your itinerary by default.
              </span>
            </span>
          </label>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {booking ? "Save booking" : "Add booking"}
        </SubmitButton>
      </div>
    </form>
  );
}
