-- rove: "Would you go back?" gains a third answer. The nullable boolean could
-- not tell "undecided" apart from "not answered yet", so it becomes text:
-- 'yes' | 'no' | 'undecided', null = not answered. Existing answers are kept
-- (true → 'yes', false → 'no', null stays null). Hand edit: the USING clause
-- (drizzle-kit would cast to 'true' / 'false', which the CHECK rejects).
ALTER TABLE "trip_memories" ALTER COLUMN "would_return" SET DATA TYPE text USING (CASE "would_return" WHEN true THEN 'yes' WHEN false THEN 'no' END);--> statement-breakpoint
ALTER TABLE "trip_memories" ADD CONSTRAINT "trip_memories_would_return_valid" CHECK ("trip_memories"."would_return" in ('yes', 'no', 'undecided'));
