CREATE TABLE "place_member_state" (
	"place_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_member_state_pk" PRIMARY KEY("place_id","user_id"),
	CONSTRAINT "place_member_state_notes_length" CHECK (char_length("place_member_state"."notes") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "trip_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"invited_by" text NOT NULL,
	"inviter_name" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"delivery_status" text DEFAULT 'not_sent' NOT NULL,
	"last_sent_at" timestamp with time zone,
	"send_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_invitations_role_valid" CHECK ("trip_invitations"."role" in ('editor', 'viewer')),
	CONSTRAINT "trip_invitations_email_length" CHECK (char_length("trip_invitations"."email") between 3 and 320),
	CONSTRAINT "trip_invitations_delivery_valid" CHECK ("trip_invitations"."delivery_status" in ('not_sent', 'sent', 'failed', 'not_configured')),
	CONSTRAINT "trip_invitations_one_outcome" CHECK (not ("trip_invitations"."accepted_at" is not null and "trip_invitations"."revoked_at" is not null)),
	CONSTRAINT "trip_invitations_accepted_pair" CHECK (("trip_invitations"."accepted_at" is null) = ("trip_invitations"."accepted_by" is null))
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_members_trip_user_unique" UNIQUE("trip_id","user_id"),
	CONSTRAINT "trip_members_role_valid" CHECK ("trip_members"."role" in ('editor', 'viewer')),
	CONSTRAINT "trip_members_not_owner" CHECK ("trip_members"."user_id" <> "trip_members"."owner_id"),
	CONSTRAINT "trip_members_user_length" CHECK (char_length("trip_members"."user_id") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_name_length" CHECK (char_length("user_profiles"."display_name") between 1 and 120),
	CONSTRAINT "user_profiles_email_length" CHECK (char_length("user_profiles"."email") <= 320)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "packing_categories" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "packing_categories" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "trip_memories" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "trip_memories" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "place_member_state" ADD CONSTRAINT "place_member_state_place_same_trip_fk" FOREIGN KEY ("place_id","trip_id") REFERENCES "public"."places"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_same_owner_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_member_state_trip_user_idx" ON "place_member_state" USING btree ("trip_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_token_hash_unique" ON "trip_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trip_invitations_trip_idx" ON "trip_invitations" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_members_user_idx" ON "trip_members" USING btree ("user_id");--> statement-breakpoint
-- Hand-written (Drizzle cannot express these): data carried over, then the actor trigger.
-- Everything that exists today was written by the trip's owner.
UPDATE "reservations" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
UPDATE "documents" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
UPDATE "places" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
UPDATE "itinerary_items" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
UPDATE "packing_categories" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
UPDATE "packing_items" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
UPDATE "trip_memories" SET "created_by" = "owner_id", "updated_by" = "owner_id";--> statement-breakpoint
-- The Explore heart and "Your notes" were personal to the one traveler. They move, not copy, into the
-- owner's private per-member state so sharing the trip never exposes them.
INSERT INTO "place_member_state" ("place_id", "trip_id", "user_id", "is_favorite", "notes")
SELECT "id", "trip_id", "owner_id", "is_favorite", "planning_notes" FROM "places"
WHERE "is_favorite" OR "planning_notes" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "places" SET "is_favorite" = false, "planning_notes" = NULL WHERE "is_favorite" OR "planning_notes" IS NOT NULL;--> statement-breakpoint
-- Attribution comes from the acting session, set per transaction by the data layer
-- (select set_config('app.actor', <verified user id>, true)); it is never read from a request field.
CREATE FUNCTION "set_row_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text := nullif(current_setting('app.actor', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(actor, NEW.created_by);
    NEW.updated_by := coalesce(actor, NEW.updated_by);
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.updated_by := coalesce(actor, OLD.updated_by);
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "reservations_actor" BEFORE INSERT OR UPDATE ON "reservations" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();--> statement-breakpoint
CREATE TRIGGER "documents_actor" BEFORE INSERT OR UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();--> statement-breakpoint
CREATE TRIGGER "places_actor" BEFORE INSERT OR UPDATE ON "places" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();--> statement-breakpoint
CREATE TRIGGER "itinerary_items_actor" BEFORE INSERT OR UPDATE ON "itinerary_items" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();--> statement-breakpoint
CREATE TRIGGER "packing_categories_actor" BEFORE INSERT OR UPDATE ON "packing_categories" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();--> statement-breakpoint
CREATE TRIGGER "packing_items_actor" BEFORE INSERT OR UPDATE ON "packing_items" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();--> statement-breakpoint
CREATE TRIGGER "trip_memories_actor" BEFORE INSERT OR UPDATE ON "trip_memories" FOR EACH ROW EXECUTE FUNCTION "set_row_actor"();
