CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"appearance" jsonb,
	"notifications" jsonb,
	"travel" jsonb,
	"display" jsonb,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_length" CHECK (char_length("user_settings"."user_id") between 1 and 255),
	CONSTRAINT "user_settings_name_length" CHECK ("user_settings"."display_name" is null or char_length("user_settings"."display_name") between 1 and 80),
	CONSTRAINT "user_settings_sections_small" CHECK (("user_settings"."appearance" is null or (jsonb_typeof("user_settings"."appearance") = 'object' and octet_length("user_settings"."appearance"::text) <= 2000))
        and ("user_settings"."notifications" is null or (jsonb_typeof("user_settings"."notifications") = 'object' and octet_length("user_settings"."notifications"::text) <= 2000))
        and ("user_settings"."travel" is null or (jsonb_typeof("user_settings"."travel") = 'object' and octet_length("user_settings"."travel"::text) <= 2000))
        and ("user_settings"."display" is null or (jsonb_typeof("user_settings"."display") = 'object' and octet_length("user_settings"."display"::text) <= 2000)))
);
