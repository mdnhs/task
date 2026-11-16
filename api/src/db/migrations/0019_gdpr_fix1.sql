ALTER TABLE "user" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "subject_user_id" text;
--> statement-breakpoint
-- Backfill: ".invalid" is a reserved TLD, so a real address can never end with it.
UPDATE "user" SET "erased_at" = "updated_at" WHERE "email" LIKE 'erased+%@invalid';
