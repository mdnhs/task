ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_tenant_project_id" UNIQUE("tenant_id","project_id","id");--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_milestone_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_fk" FOREIGN KEY ("tenant_id","project_id","milestone_id") REFERENCES "public"."project_milestones"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_needs_project" CHECK ("tasks"."milestone_id" is null or "tasks"."project_id" is not null);
