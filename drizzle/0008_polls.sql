ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_id_trip_unique" UNIQUE("id","trip_id");--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"place_id" uuid,
	CONSTRAINT "poll_options_id_poll_unique" UNIQUE("id","poll_id"),
	CONSTRAINT "poll_options_position_unique" UNIQUE("poll_id","position"),
	CONSTRAINT "poll_options_position_range" CHECK ("poll_options"."position" between 1 and 3),
	CONSTRAINT "poll_options_label_length" CHECK (char_length("poll_options"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "poll_participants" (
	"poll_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "poll_participants_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"option_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"created_by" text NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"parent_type" text DEFAULT 'trip' NOT NULL,
	"parent_day" date,
	"parent_item_id" uuid,
	"parent_place_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone,
	"any_option" boolean DEFAULT true NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"canceled_at" timestamp with time zone,
	"result_option_id" uuid,
	"result_selected_by" text,
	"result_selected_at" timestamp with time zone,
	"result_tally" jsonb,
	"replaces_poll_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polls_id_trip_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "polls_status_valid" CHECK ("polls"."status" in ('open', 'closed', 'canceled')),
	CONSTRAINT "polls_parent_valid" CHECK ("polls"."parent_type" in ('trip', 'day', 'activity', 'place')),
	CONSTRAINT "polls_question_length" CHECK (char_length("polls"."question") between 3 and 140),
	CONSTRAINT "polls_description_length" CHECK (char_length("polls"."description") <= 500),
	CONSTRAINT "polls_parent_columns" CHECK (("polls"."parent_day" is null or "polls"."parent_type" = 'day')
        and ("polls"."parent_item_id" is null or "polls"."parent_type" = 'activity')
        and ("polls"."parent_place_id" is null or "polls"."parent_type" = 'place')),
	CONSTRAINT "polls_canceled_pair" CHECK (("polls"."status" = 'canceled') = ("polls"."canceled_at" is not null)),
	CONSTRAINT "polls_result_not_canceled" CHECK ("polls"."result_option_id" is null or "polls"."status" = 'closed'),
	CONSTRAINT "polls_result_pair" CHECK (("polls"."result_option_id" is null) = ("polls"."result_selected_at" is null))
);
--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_same_trip_fk" FOREIGN KEY ("poll_id","trip_id") REFERENCES "public"."polls"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_place_same_trip_fk" FOREIGN KEY ("place_id","trip_id") REFERENCES "public"."places"("id","trip_id") ON DELETE SET NULL ("place_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_participants" ADD CONSTRAINT "poll_participants_poll_same_trip_fk" FOREIGN KEY ("poll_id","trip_id") REFERENCES "public"."polls"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_same_trip_fk" FOREIGN KEY ("poll_id","trip_id") REFERENCES "public"."polls"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_same_poll_fk" FOREIGN KEY ("option_id","poll_id") REFERENCES "public"."poll_options"("id","poll_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: a column-list SET NULL (Postgres 15+) so deleting a linked activity / place keeps the poll and the trip id.
ALTER TABLE "polls" ADD CONSTRAINT "polls_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_item_same_trip_fk" FOREIGN KEY ("parent_item_id","trip_id") REFERENCES "public"."itinerary_items"("id","trip_id") ON DELETE SET NULL ("parent_item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_place_same_trip_fk" FOREIGN KEY ("parent_place_id","trip_id") REFERENCES "public"."places"("id","trip_id") ON DELETE SET NULL ("parent_place_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_votes_trip_idx" ON "poll_votes" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "polls_trip_idx" ON "polls" USING btree ("trip_id","created_at");
