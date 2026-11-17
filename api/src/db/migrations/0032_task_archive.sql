ALTER TABLE "files" ADD COLUMN "object_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "object_removal_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "object_removal_attempted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "files_removal_pending_idx" ON "files" USING btree ("tenant_id","created_at") WHERE "files"."status" = 'deleted' and "files"."object_removed_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_archived_idx" ON "tasks" USING btree ("tenant_id","archived_at","id") WHERE "tasks"."archived_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_archive_batch_idx" ON "tasks" USING btree ("tenant_id","archive_batch_id") WHERE "tasks"."archive_batch_id" is not null;
--> statement-breakpoint
-- Grants (ruling 9). `tasks` already carries DELETE (purge) and UPDATE on archived_at / archived_by / archive_batch_id / parent_id / series_id /
-- occurrence_date (0027); every child table leaves with its task through ON DELETE CASCADE, which runs as the table owner, so no child table gets a
-- DELETE grant. The one new need: a voice file shared with another task survives its owner's purge, so its task_files row is re-homed to a surviving task.
GRANT UPDATE ("task_id") ON "task_files" TO app_user;
