export const BOOKING_KINDS = [
  "flight",
  "lodging",
  "car",
  "train",
  "activity",
  "restaurant",
  "other",
] as const;

export type BookingKind = (typeof BOOKING_KINDS)[number];

export type Trip = {
  id: string;
  owner_id: string;
  title: string;
  destination: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  travelers: string[];
  cover_image: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  trip_id: string;
  owner_id: string;
  kind: BookingKind;
  title: string;
  provider: string | null;
  confirmation_code: string | null;
  start_date: string | null;
  start_time: string | null; // HH:MM:SS local wall-clock
  end_date: string | null;
  end_time: string | null;
  origin: string | null;
  destination: string | null;
  location: string | null;
  booking_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentLink = {
  id: string;
  trip_id: string;
  booking_id: string | null;
  owner_id: string;
  label: string;
  url: string;
  created_at: string;
  updated_at: string;
};

export type TripWithDetails = Trip & {
  bookings: Booking[];
  document_links: DocumentLink[];
};

/** Result shape shared by every form Server Action. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};
