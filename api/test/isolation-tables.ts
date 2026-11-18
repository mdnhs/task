/**
 * Tenant tables (columns named tenant_id) and how the isolation walker covers each one (B7 Task 14).
 * HASHED_TABLES: row hashes of tenant B are taken before and after the walk, so a cross-tenant write, delete or audit row by A's
 * calls changes the hash and fails the run. TABLE_EXEMPT: a tenant table that cannot be hashed, with the reason.
 * route-inventory.test.ts requires HASHED_TABLES + TABLE_EXEMPT to equal the live list of tenant_id tables, i.e. the same list
 * rls-guard.test.ts checks for the RLS template: a new tenant table fails the build until it is added here.
 */
export const HASHED_TABLES = ["roles", "memberships", "teams", "team_members", "reporting_lines", "devices", "device_policies", "invites", "audit_events", "tenant_settings", "notifications", "notification_preferences", "push_tokens", "notification_deliveries", "files", "integration_connections", "oauth_states", "public_holidays", "data_requests", "support_grants", "api_keys", "webhook_endpoints", "webhook_deliveries", "tasks", "task_assignees", "task_history", "task_time_entries", "task_counters", "task_checklist_items", "task_comments", "task_files", "task_templates", "task_voice_access", "projects", "project_milestones", "task_dependencies", "task_evidence", "shift_patterns", "shift_assignments", "shift_reporting_teams", "shift_reporting_people", "shift_reports", "shift_report_items", "shift_report_versions", "shift_report_comments", "shift_report_files", "shift_report_alerts", "report_exports", "domain_events", "event_deliveries", "event_delivery_failures", "invoices", "module_overrides", "search_documents", "subscriptions"]

export const TABLE_EXEMPT: Record<string, string> = {
  rls_probe: "test-schema table of the RLS probe (rls-probe.ts, seed.test.ts); no route ever writes it",
}
