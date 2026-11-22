-- The organization logo and favicon go through the file pipeline under their own purposes (`branding_logo`, `branding_favicon`): scoped like task and report files, so
-- /v1/files never lists, serves or deletes them. The purpose CHECK is hand-managed (see 0018, 0028, 0036), so it is widened here. Additive: widening only, an older image
-- never writes the new purposes and reads no row differently. No data is read or changed.
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('dsr_export','task_evidence','task_attachment','task_voice','report_attachment','report_export','branding_logo','branding_favicon'));
