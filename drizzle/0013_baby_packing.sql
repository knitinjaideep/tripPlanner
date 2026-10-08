ALTER TABLE "packing_items" ADD COLUMN "quantity_text" text;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "source_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "packing_items_trip_source_key_unique" ON "packing_items" USING btree ("trip_id","source_key") WHERE "packing_items"."source_key" is not null;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_quantity_text_length" CHECK (char_length("packing_items"."quantity_text") between 1 and 80);--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_source_key_length" CHECK (char_length("packing_items"."source_key") between 1 and 120);