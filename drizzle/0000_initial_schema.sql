-- rove initial schema (application tables only; Neon Auth owns `neon_auth`).
-- HAND-EDITED: documents_reservation_same_trip_fk uses
-- ON DELETE SET NULL ("reservation_id") (Postgres 15+) so deleting a
-- reservation keeps its documents on the trip. Drizzle cannot express the
-- column list; keep this edit if the migration is ever regenerated.
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"reservation_id" uuid,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_label_length" CHECK (char_length("documents"."label") between 1 and 120),
	CONSTRAINT "documents_url_https" CHECK ("documents"."url" ~ '^https://' and char_length("documents"."url") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"confirmation_code" text,
	"start_date" date,
	"start_time" time,
	"start_time_zone" text,
	"end_date" date,
	"end_time" time,
	"end_time_zone" text,
	"origin" text,
	"destination" text,
	"location" text,
	"booking_url" text,
	"notes" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_id_trip_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "reservations_kind_valid" CHECK ("reservations"."kind" in ('flight', 'lodging', 'car', 'train', 'activity', 'restaurant', 'other')),
	CONSTRAINT "reservations_title_length" CHECK (char_length("reservations"."title") between 1 and 160),
	CONSTRAINT "reservations_provider_length" CHECK (char_length("reservations"."provider") <= 120),
	CONSTRAINT "reservations_confirmation_length" CHECK (char_length("reservations"."confirmation_code") <= 80),
	CONSTRAINT "reservations_start_tz_length" CHECK (char_length("reservations"."start_time_zone") between 1 and 64),
	CONSTRAINT "reservations_end_tz_length" CHECK (char_length("reservations"."end_time_zone") between 1 and 64),
	CONSTRAINT "reservations_start_time_has_date" CHECK ("reservations"."start_time" is null or "reservations"."start_date" is not null),
	CONSTRAINT "reservations_end_time_has_date" CHECK ("reservations"."end_time" is null or "reservations"."end_date" is not null),
	CONSTRAINT "reservations_dates_ordered" CHECK ("reservations"."end_date" is null or "reservations"."start_date" is null or "reservations"."end_date" >= "reservations"."start_date"),
	CONSTRAINT "reservations_origin_length" CHECK (char_length("reservations"."origin") <= 120),
	CONSTRAINT "reservations_destination_length" CHECK (char_length("reservations"."destination") <= 120),
	CONSTRAINT "reservations_location_length" CHECK (char_length("reservations"."location") <= 240),
	CONSTRAINT "reservations_booking_url_https" CHECK ("reservations"."booking_url" ~ '^https://' and char_length("reservations"."booking_url") <= 2048),
	CONSTRAINT "reservations_notes_length" CHECK (char_length("reservations"."notes") <= 5000),
	CONSTRAINT "reservations_details_object" CHECK (jsonb_typeof("reservations"."details") = 'object')
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"destination" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"travelers" text[] DEFAULT '{}'::text[] NOT NULL,
	"cover_image" text DEFAULT 'beach' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "trips_owner_id_present" CHECK (char_length("trips"."owner_id") between 1 and 255),
	CONSTRAINT "trips_title_length" CHECK (char_length("trips"."title") between 1 and 120),
	CONSTRAINT "trips_destination_length" CHECK (char_length("trips"."destination") between 1 and 120),
	CONSTRAINT "trips_dates_ordered" CHECK ("trips"."end_date" >= "trips"."start_date"),
	CONSTRAINT "trips_time_zone_length" CHECK (char_length("trips"."time_zone") between 1 and 64),
	CONSTRAINT "trips_travelers_count" CHECK (cardinality("trips"."travelers") <= 20),
	CONSTRAINT "trips_cover_image_length" CHECK (char_length("trips"."cover_image") <= 40),
	CONSTRAINT "trips_notes_length" CHECK (char_length("trips"."notes") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reservation_same_trip_fk" FOREIGN KEY ("reservation_id","trip_id") REFERENCES "public"."reservations"("id","trip_id") ON DELETE SET NULL ("reservation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_trip_created_idx" ON "documents" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_reservation_idx" ON "documents" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "reservations_trip_start_idx" ON "reservations" USING btree ("trip_id","start_date","start_time");--> statement-breakpoint
CREATE INDEX "reservations_owner_idx" ON "reservations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "trips_owner_start_idx" ON "trips" USING btree ("owner_id","start_date");