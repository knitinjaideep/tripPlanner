CREATE TABLE "evening_preview_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"target_date" date NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evening_preview_delivery_key" UNIQUE("trip_id","user_id","target_date","channel"),
	CONSTRAINT "evening_preview_deliveries_channel" CHECK ("evening_preview_deliveries"."channel" in ('in_app', 'email')),
	CONSTRAINT "evening_preview_deliveries_status" CHECK ("evening_preview_deliveries"."status" in ('pending', 'sending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "evening_preview_deliveries_reason_length" CHECK (char_length("evening_preview_deliveries"."reason") <= 80)
);
--> statement-breakpoint
CREATE TABLE "evening_preview_prefs" (
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"send_time" time DEFAULT '19:00:00' NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evening_preview_prefs_pk" PRIMARY KEY("trip_id","user_id"),
	CONSTRAINT "evening_preview_prefs_time_range" CHECK ("evening_preview_prefs"."send_time" between '16:00' and '22:00'),
	CONSTRAINT "evening_preview_prefs_channel" CHECK ("evening_preview_prefs"."in_app" or "evening_preview_prefs"."email")
);
--> statement-breakpoint
CREATE TABLE "scheduler_heartbeats" (
	"job" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_result" jsonb
);
--> statement-breakpoint
ALTER TABLE "evening_preview_deliveries" ADD CONSTRAINT "evening_preview_deliveries_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evening_preview_prefs" ADD CONSTRAINT "evening_preview_prefs_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;