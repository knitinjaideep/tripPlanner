CREATE TABLE "reminder_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"quiet_enabled" boolean DEFAULT false NOT NULL,
	"quiet_start" time DEFAULT '22:00:00' NOT NULL,
	"quiet_end" time DEFAULT '07:00:00' NOT NULL,
	"quiet_zone" text,
	"default_task_time" time DEFAULT '09:00:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_prefs_user_length" CHECK (char_length("reminder_prefs"."user_id") between 1 and 255),
	CONSTRAINT "reminder_prefs_channel" CHECK ("reminder_prefs"."in_app" or "reminder_prefs"."email"),
	CONSTRAINT "reminder_prefs_quiet_zone" CHECK (not "reminder_prefs"."quiet_enabled" or ("reminder_prefs"."quiet_zone" is not null and char_length("reminder_prefs"."quiet_zone") between 1 and 64)),
	CONSTRAINT "reminder_prefs_quiet_span" CHECK ("reminder_prefs"."quiet_start" <> "reminder_prefs"."quiet_end")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"reservation_id" uuid,
	"packing_item_id" uuid,
	"recipient_id" text NOT NULL,
	"preset" text NOT NULL,
	"lead_minutes" integer,
	"days_before" integer,
	"local_time" time,
	"occurrence" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"target_at" timestamp with time zone,
	"natural_fire_at" timestamp with time zone,
	"fire_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"adjustment" text,
	"adjustment_note" text,
	"quiet_override" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp with time zone,
	"snooze_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"locked_until" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"in_app_sent_at" timestamp with time zone,
	"email_status" text DEFAULT 'none' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_next_at" timestamp with time zone,
	"email_locked_until" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_subject_shape" CHECK (("reminders"."subject_type" = 'booking' and "reminders"."reservation_id" is not null and "reminders"."packing_item_id" is null) or ("reminders"."subject_type" = 'task' and "reminders"."packing_item_id" is not null and "reminders"."reservation_id" is null)),
	CONSTRAINT "reminders_preset_valid" CHECK ("reminders"."preset" in ('24h', '2h', 'at_due', '1d_before', 'custom')),
	CONSTRAINT "reminders_status_valid" CHECK ("reminders"."status" in ('pending', 'sending', 'sent', 'failed', 'skipped', 'canceled')),
	CONSTRAINT "reminders_email_status_valid" CHECK ("reminders"."email_status" in ('none', 'pending', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "reminders_recipient_length" CHECK (char_length("reminders"."recipient_id") between 1 and 255),
	CONSTRAINT "reminders_rule_shape" CHECK (("reminders"."lead_minutes" is not null and "reminders"."days_before" is null and "reminders"."local_time" is null) or ("reminders"."lead_minutes" is null and "reminders"."days_before" is not null and "reminders"."local_time" is not null)),
	CONSTRAINT "reminders_lead_range" CHECK ("reminders"."lead_minutes" is null or "reminders"."lead_minutes" between 0 and 43200),
	CONSTRAINT "reminders_days_range" CHECK ("reminders"."days_before" is null or "reminders"."days_before" between 0 and 30),
	CONSTRAINT "reminders_booking_lead" CHECK ("reminders"."subject_type" <> 'booking' or "reminders"."lead_minutes" >= 1),
	CONSTRAINT "reminders_occurrence_positive" CHECK ("reminders"."occurrence" >= 1),
	CONSTRAINT "reminders_reason_length" CHECK (char_length("reminders"."status_reason") <= 40),
	CONSTRAINT "reminders_note_length" CHECK (char_length("reminders"."adjustment_note") <= 300)
);
--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "due_time" time;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "due_time_zone" text;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_id_trip_unique" UNIQUE("id","trip_id");--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_reservation_same_trip_fk" FOREIGN KEY ("reservation_id","trip_id") REFERENCES "public"."reservations"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_packing_item_same_trip_fk" FOREIGN KEY ("packing_item_id","trip_id") REFERENCES "public"."packing_items"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_reservation_recipient_unique" ON "reminders" USING btree ("reservation_id","recipient_id") WHERE "reminders"."reservation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_packing_item_recipient_unique" ON "reminders" USING btree ("packing_item_id","recipient_id") WHERE "reminders"."packing_item_id" is not null;--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("fire_at") WHERE "reminders"."status" in ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "reminders_email_idx" ON "reminders" USING btree ("email_next_at") WHERE "reminders"."email_status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "reminders_recipient_idx" ON "reminders" USING btree ("recipient_id","trip_id");--> statement-breakpoint
CREATE INDEX "packing_items_assignee_idx" ON "packing_items" USING btree ("trip_id","assignee_id");--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_assignee_length" CHECK (char_length("packing_items"."assignee_id") between 1 and 255);--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_due_time_has_date" CHECK ("packing_items"."due_time" is null or "packing_items"."due_date" is not null);--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_due_zone_pair" CHECK (("packing_items"."due_date" is null) = ("packing_items"."due_time_zone" is null));--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_due_zone_length" CHECK (char_length("packing_items"."due_time_zone") between 1 and 64);--> statement-breakpoint
-- Deleting a reminder (its booking, task or trip was deleted) must not leave a sent inbox item looking current:
-- mark it "canceled". Hand-written; the item itself is kept as history and its link opens current data.
CREATE FUNCTION "reminders_retire_notifications"() RETURNS trigger AS $$
BEGIN
  UPDATE "notifications"
     SET "metadata" = "metadata" || '{"state":"canceled"}'::jsonb
   WHERE "type" = 'reminder' AND "resource_id" = OLD."id";
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "reminders_retire_notifications_trg" BEFORE DELETE ON "reminders" FOR EACH ROW EXECUTE FUNCTION "reminders_retire_notifications"();
