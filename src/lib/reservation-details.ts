import type { ReservationKind } from "@/lib/types";

/**
 * Type-specific reservation fields, stored in `reservations.details` (jsonb)
 * and validated per kind on the server (see validation.ts). Form inputs are
 * named `details.<key>`.
 */
export type DetailField = {
  key: string;
  label: string;
  max: number;
  placeholder?: string;
  /** Digits only, stored as a number. */
  numeric?: { min: number; max: number };
  mono?: boolean;
};

export const DETAIL_FIELDS: Record<ReservationKind, DetailField[]> = {
  flight: [
    { key: "flight_number", label: "Flight number", max: 12, placeholder: "UA 1521", mono: true },
    { key: "terminal", label: "Terminal", max: 20, placeholder: "C" },
    { key: "seats", label: "Seats", max: 60, placeholder: "14A, 14B" },
  ],
  lodging: [
    { key: "room_type", label: "Room", max: 80, placeholder: "Ocean-view king" },
    { key: "guests", label: "Guests", max: 2, numeric: { min: 1, max: 30 } },
  ],
  car: [{ key: "vehicle", label: "Car", max: 80, placeholder: "Compact SUV" }],
  train: [
    { key: "train_number", label: "Train number", max: 20, placeholder: "Acela 2151", mono: true },
    { key: "coach", label: "Coach", max: 20 },
    { key: "seats", label: "Seats", max: 60 },
  ],
  activity: [{ key: "meeting_point", label: "Meeting point", max: 160 }],
  restaurant: [{ key: "party_size", label: "Party size", max: 2, numeric: { min: 1, max: 50 } }],
  other: [],
};

/** Read a stored details object for display, keeping only known keys. */
export function readDetails(kind: ReservationKind, details: unknown) {
  const source = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  return DETAIL_FIELDS[kind]
    .map((field) => {
      const value = source[field.key];
      if (typeof value === "number" || (typeof value === "string" && value.trim())) {
        return { ...field, value: String(value) };
      }
      return null;
    })
    .filter((f): f is DetailField & { value: string } => f !== null);
}

export function detailValue(kind: ReservationKind, details: unknown, key: string) {
  return readDetails(kind, details).find((f) => f.key === key)?.value ?? null;
}
