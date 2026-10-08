CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" text NOT NULL,
	"trip_id" uuid,
	"trip_owner_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"resource_type" text,
	"resource_id" uuid,
	"actor_id" text,
	"dedupe_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "notifications_recipient_dedupe_unique" UNIQUE("recipient_id","dedupe_key"),
	CONSTRAINT "notifications_type_shape" CHECK ("notifications"."type" ~ '^[a-z][a-z_]{0,39}$'),
	CONSTRAINT "notifications_title_length" CHECK (char_length("notifications"."title") between 1 and 120),
	CONSTRAINT "notifications_body_length" CHECK (char_length("notifications"."body") between 1 and 400),
	CONSTRAINT "notifications_dedupe_length" CHECK (char_length("notifications"."dedupe_key") between 1 and 200),
	CONSTRAINT "notifications_recipient_length" CHECK (char_length("notifications"."recipient_id") between 1 and 255),
	CONSTRAINT "notifications_not_self" CHECK ("notifications"."actor_id" is null or "notifications"."actor_id" <> "notifications"."recipient_id"),
	CONSTRAINT "notifications_trip_pair" CHECK (("notifications"."trip_id" is null) = ("notifications"."trip_owner_id" is null)),
	CONSTRAINT "notifications_metadata_small" CHECK (jsonb_typeof("notifications"."metadata") = 'object' and octet_length("notifications"."metadata"::text) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_trip_same_owner_fk" FOREIGN KEY ("trip_id","trip_owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."read_at" is null and "notifications"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_trip_recipient_idx" ON "notifications" USING btree ("trip_id","recipient_id");