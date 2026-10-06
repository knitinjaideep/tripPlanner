-- rove: bookings can be marked cancelled (kept, hidden from the itinerary by
-- default). Additive: existing rows become 'confirmed' via the default.
ALTER TABLE "reservations" ADD COLUMN "status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_status_valid" CHECK ("reservations"."status" in ('confirmed', 'cancelled'));