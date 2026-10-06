ALTER TABLE "itinerary_items" ADD COLUMN "is_optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "is_protected_rest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_trip_source_unique" UNIQUE("trip_id","source_key");--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_source_key_length" CHECK (char_length("itinerary_items"."source_key") between 1 and 120);--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_source_fingerprint_length" CHECK (char_length("itinerary_items"."source_fingerprint") <= 64);