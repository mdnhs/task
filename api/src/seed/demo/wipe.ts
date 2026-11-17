import { sql } from "drizzle-orm"
import type { Db } from "../../db/client"
import { DEMO_SLUGS } from "./guards"

/**
 * What a seed run owns inside a demo tenant, in foreign-key-safe order. Everything here is rebuilt from the mock JSON on every run (so every date moves to the
 * new anchor). NOT here: the tenant row, roles, memberships, subscription, settings, audit entries and the users, which keep their ids across runs.
 * Run as the table owner (the app role may only append to some of these, e.g. report versions); FORCE RLS still applies, so the tenant context is set and every
 * delete also names the tenant.
 */
const TENANT_TABLES = [
  "notification_deliveries", "notifications", "notification_preferences",
  "report_exports", "shift_report_alerts", "shift_reports", // items, versions, comments and files of a report go with it (cascade)
  "shift_assignments", "shift_reporting_people", "shift_reporting_teams", "shift_patterns",
  "task_templates",
  "tasks", // assignees, history, time entries, checklist, comments, task files, evidence, dependencies (cascade)
  "projects", // milestones (cascade)
  "device_policies", "devices",
  "team_members", "reporting_lines", "teams",
  "task_counters", "search_documents", "public_holidays",
] as const

export async function wipeTenantData(owner: Db, tenantId: string): Promise<void> {
  await owner.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    for (const t of TENANT_TABLES) await tx.execute(sql`delete from ${sql.identifier(t)} where tenant_id = ${tenantId}`)
    // the seeded evidence files (metadata rows; their task_files links went with the tasks)
    await tx.execute(sql`delete from files where tenant_id = ${tenantId} and purpose = 'task_evidence'`)
  })
}

/**
 * --reset: deletes the demo tenants (cascade removes all their rows) and their audit entries. It names the demo slugs itself and nothing else, so no input can
 * widen it; the caller has already passed the guard, which refuses any database holding another tenant.
 */
export async function deleteDemoTenants(owner: Db): Promise<number> {
  const rows = (await owner.execute(sql`select id from tenants where slug = any(${sql.raw(`ARRAY[${DEMO_SLUGS.map((s) => `'${s}'`).join(",")}]::text[]`)})`)).rows as { id: string }[]
  for (const { id } of rows) {
    await owner.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`)
      await tx.execute(sql`delete from audit_events where tenant_id = ${id}`) // no foreign key to tenants, so the cascade would leave the chain behind
      await tx.execute(sql`delete from tenants where id = ${id} and slug = any(${sql.raw(`ARRAY[${DEMO_SLUGS.map((s) => `'${s}'`).join(",")}]::text[]`)})`)
    })
  }
  return rows.length
}
