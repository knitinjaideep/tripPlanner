ALTER TABLE "places" DROP CONSTRAINT "places_category_valid";--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "recommendation" jsonb;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_trip_source_unique" UNIQUE("trip_id","source_key");--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_source_key_length" CHECK (char_length("places"."source_key") between 1 and 120);--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_recommendation_object" CHECK ("places"."recommendation" is null or (jsonb_typeof("places"."recommendation") = 'object' and "places"."source_key" is not null));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_category_valid" CHECK (("places"."kind" = 'place' and "places"."category" in ('sight', 'museum', 'nature', 'beach', 'park', 'shopping', 'nightlife', 'experience', 'spa', 'other')) or ("places"."kind" = 'food' and "places"."category" in ('restaurant', 'cafe', 'bar', 'bakery', 'dessert', 'market', 'other')));