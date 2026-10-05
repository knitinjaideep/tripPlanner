import type { BookingKind } from "@/lib/types";

type KindMeta = {
  label: string;
  /** Labels for the start/end moments, e.g. "Check-in" / "Check-out". */
  startLabel: string;
  endLabel: string;
  /** Transport bookings use origin → destination instead of one location. */
  route: boolean;
  titlePlaceholder: string;
  providerLabel: string;
};

export const BOOKING_KIND_META: Record<BookingKind, KindMeta> = {
  flight: {
    label: "Flight",
    startLabel: "Departs",
    endLabel: "Arrives",
    route: true,
    titlePlaceholder: "UA 1521",
    providerLabel: "Airline",
  },
  lodging: {
    label: "Stay",
    startLabel: "Check-in",
    endLabel: "Check-out",
    route: false,
    titlePlaceholder: "Hotel or rental name",
    providerLabel: "Booked via",
  },
  car: {
    label: "Car rental",
    startLabel: "Pick-up",
    endLabel: "Drop-off",
    route: true,
    titlePlaceholder: "Compact SUV",
    providerLabel: "Rental company",
  },
  train: {
    label: "Train",
    startLabel: "Departs",
    endLabel: "Arrives",
    route: true,
    titlePlaceholder: "Train or service number",
    providerLabel: "Operator",
  },
  activity: {
    label: "Activity",
    startLabel: "Starts",
    endLabel: "Ends",
    route: false,
    titlePlaceholder: "Snorkel tour",
    providerLabel: "Organizer",
  },
  restaurant: {
    label: "Restaurant",
    startLabel: "Reservation",
    endLabel: "Ends",
    route: false,
    titlePlaceholder: "Restaurant name",
    providerLabel: "Booked via",
  },
  other: {
    label: "Other",
    startLabel: "Starts",
    endLabel: "Ends",
    route: false,
    titlePlaceholder: "What is it?",
    providerLabel: "Provider",
  },
};
