-- rove: Explore, Itinerary, Packing and Memories tables. Additive only — no
-- existing table is altered and Neon Auth's `neon_auth` schema is untouched.
-- Links to places / reservations / packing categories use NO ACTION so the
-- database refuses to orphan visits or items; the app detaches or moves them
-- first, in one transaction (see src/db/queries.ts).
CREATE TABLE "itinerary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"place_id" uuid,
	"reservation_id" uuid,
	"title" text,
	"category" text DEFAULT 'activity' NOT NULL,
	"local_date" date,
	"local_start_time" time,
	"local_end_date" date,
	"local_end_time" time,
	"timezone" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"planning_notes" text,
	"rating" integer,
	"reflection" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_items_title_length" CHECK (char_length("itinerary_items"."title") between 1 and 160),
	CONSTRAINT "itinerary_items_has_subject" CHECK ("itinerary_items"."title" is not null or "itinerary_items"."place_id" is not null or "itinerary_items"."reservation_id" is not null),
	CONSTRAINT "itinerary_items_category_valid" CHECK ("itinerary_items"."category" in ('activity', 'sightseeing', 'food', 'transport', 'lodging', 'rest', 'other')),
	CONSTRAINT "itinerary_items_schedule_source" CHECK (("itinerary_items"."reservation_id" is null and "itinerary_items"."local_date" is not null and "itinerary_items"."timezone" is not null)
        or ("itinerary_items"."reservation_id" is not null and "itinerary_items"."local_date" is null and "itinerary_items"."local_start_time" is null
            and "itinerary_items"."local_end_date" is null and "itinerary_items"."local_end_time" is null and "itinerary_items"."timezone" is null)),
	CONSTRAINT "itinerary_items_timezone_length" CHECK (char_length("itinerary_items"."timezone") between 1 and 64),
	CONSTRAINT "itinerary_items_end_after_start" CHECK ("itinerary_items"."local_end_date" >= "itinerary_items"."local_date"),
	CONSTRAINT "itinerary_items_end_time_valid" CHECK ("itinerary_items"."local_end_time" is null
        or coalesce("itinerary_items"."local_end_date", "itinerary_items"."local_date") > "itinerary_items"."local_date"
        or ("itinerary_items"."local_start_time" is not null and "itinerary_items"."local_end_time" > "itinerary_items"."local_start_time")),
	CONSTRAINT "itinerary_items_status_valid" CHECK ("itinerary_items"."status" in ('planned', 'completed', 'skipped')),
	CONSTRAINT "itinerary_items_completed_at_matches" CHECK (("itinerary_items"."status" = 'completed') = ("itinerary_items"."completed_at" is not null)),
	CONSTRAINT "itinerary_items_rating_range" CHECK ("itinerary_items"."rating" between 1 and 5),
	CONSTRAINT "itinerary_items_planning_notes_length" CHECK (char_length("itinerary_items"."planning_notes") <= 5000),
	CONSTRAINT "itinerary_items_reflection_length" CHECK (char_length("itinerary_items"."reflection") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "packing_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_categories_id_trip_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "packing_categories_name_length" CHECK (char_length("packing_categories"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "packing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"traveler_name" text,
	"notes" text,
	"is_packed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_items_label_length" CHECK (char_length("packing_items"."label") between 1 and 120),
	CONSTRAINT "packing_items_quantity_range" CHECK ("packing_items"."quantity" between 1 and 999),
	CONSTRAINT "packing_items_traveler_length" CHECK (char_length("packing_items"."traveler_name") between 1 and 40),
	CONSTRAINT "packing_items_notes_length" CHECK (char_length("packing_items"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'maybe' NOT NULL,
	"address" text,
	"maps_url" text,
	"website_url" text,
	"planning_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_id_trip_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "places_name_length" CHECK (char_length("places"."name") between 1 and 160),
	CONSTRAINT "places_kind_valid" CHECK ("places"."kind" in ('place', 'food')),
	CONSTRAINT "places_category_valid" CHECK (("places"."kind" = 'place' and "places"."category" in ('sight', 'museum', 'nature', 'beach', 'park', 'shopping', 'nightlife', 'experience', 'other')) or ("places"."kind" = 'food' and "places"."category" in ('restaurant', 'cafe', 'bar', 'bakery', 'dessert', 'market', 'other'))),
	CONSTRAINT "places_priority_valid" CHECK ("places"."priority" in ('must_do', 'maybe')),
	CONSTRAINT "places_address_length" CHECK (char_length("places"."address") <= 240),
	CONSTRAINT "places_maps_url_https" CHECK ("places"."maps_url" ~ '^https://' and char_length("places"."maps_url") <= 2048),
	CONSTRAINT "places_website_url_https" CHECK ("places"."website_url" ~ '^https://' and char_length("places"."website_url") <= 2048),
	CONSTRAINT "places_planning_notes_length" CHECK (char_length("places"."planning_notes") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "trip_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"overall_rating" integer,
	"summary" text,
	"favorite_moment" text,
	"would_return" boolean,
	"lessons_for_next_time" text,
	"photo_album_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_memories_trip_unique" UNIQUE("trip_id"),
	CONSTRAINT "trip_memories_rating_range" CHECK ("trip_memories"."overall_rating" between 1 and 5),
	CONSTRAINT "trip_memories_summary_length" CHECK (char_length("trip_memories"."summary") <= 5000),
	CONSTRAINT "trip_memories_favorite_length" CHECK (char_length("trip_memories"."favorite_moment") <= 2000),
	CONSTRAINT "trip_memories_lessons_length" CHECK (char_length("trip_memories"."lessons_for_next_time") <= 5000),
	CONSTRAINT "trip_memories_album_url_https" CHECK ("trip_memories"."photo_album_url" ~ '^https://' and char_length("trip_memories"."photo_album_url") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_place_same_trip_fk" FOREIGN KEY ("place_id","trip_id") REFERENCES "public"."places"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_reservation_same_trip_fk" FOREIGN KEY ("reservation_id","trip_id") REFERENCES "public"."reservations"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_categories" ADD CONSTRAINT "packing_categories_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_category_same_trip_fk" FOREIGN KEY ("category_id","trip_id") REFERENCES "public"."packing_categories"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_memories" ADD CONSTRAINT "trip_memories_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "itinerary_items_reservation_unique" ON "itinerary_items" USING btree ("reservation_id") WHERE "itinerary_items"."reservation_id" is not null;--> statement-breakpoint
CREATE INDEX "itinerary_items_trip_date_idx" ON "itinerary_items" USING btree ("trip_id","local_date","sort_order");--> statement-breakpoint
CREATE INDEX "itinerary_items_place_idx" ON "itinerary_items" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "itinerary_items_owner_idx" ON "itinerary_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "packing_categories_trip_order_idx" ON "packing_categories" USING btree ("trip_id","sort_order");--> statement-breakpoint
CREATE INDEX "packing_categories_owner_idx" ON "packing_categories" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "packing_items_trip_category_idx" ON "packing_items" USING btree ("trip_id","category_id","sort_order");--> statement-breakpoint
CREATE INDEX "packing_items_category_idx" ON "packing_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "packing_items_owner_idx" ON "packing_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "places_trip_kind_idx" ON "places" USING btree ("trip_id","kind");--> statement-breakpoint
CREATE INDEX "places_owner_idx" ON "places" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "trip_memories_owner_idx" ON "trip_memories" USING btree ("owner_id");