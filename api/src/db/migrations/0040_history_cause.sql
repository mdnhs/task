ALTER TABLE "task_history" ADD COLUMN "cause_task_id" uuid;--> statement-breakpoint
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_cause_fk" FOREIGN KEY ("tenant_id","cause_task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE SET NULL ("cause_task_id") ON UPDATE no action;--> statement-breakpoint
-- task_history and tasks are FORCE ROW LEVEL SECURITY and the migrator has no BYPASSRLS, so the backfill runs once per tenant with app.tenant_id set (a plain UPDATE here would match 0 rows).
DO $$
DECLARE
  t record;
  pat constant text := '^(?:Moved because|Archived with|Restored with|Created from recurring task) TSK-([0-9]+)(?: was rescheduled)?$';
  pat_ref constant text := '^(?:Moved because|Archived with|Restored with|Created from recurring task) TSK-([0-9]{1,9})(?: was rescheduled)?$'; -- at most 9 digits: the ref_no cast below can never overflow
BEGIN
  FOR t IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    UPDATE "task_history" h SET "cause_task_id" = k."id"
      FROM "tasks" k
      WHERE h."tenant_id" = t."id" AND k."tenant_id" = t."id" AND h."cause_task_id" IS NULL
        AND h."kind" IN ('rescheduled', 'archived', 'restored', 'created') AND h."text" ~ pat_ref
        AND k."ref_no" = substring(h."text" from pat_ref)::bigint;
    UPDATE "task_history" SET "text" = CASE "kind" WHEN 'rescheduled' THEN 'Moved because another task was rescheduled' WHEN 'archived' THEN 'Archived with another task' WHEN 'restored' THEN 'Restored with another task' ELSE 'Created from a recurring task' END
      WHERE "tenant_id" = t."id" AND "kind" IN ('rescheduled', 'archived', 'restored', 'created') AND "text" ~ pat;
    UPDATE "task_history" SET "text" = 'The parent task was removed; this is now a task of its own'
      WHERE "tenant_id" = t."id" AND "kind" = 'detached' AND "text" ~ '^TSK-[0-9]+ was removed; this is now a task of its own$';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
