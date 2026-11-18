import { sql } from "drizzle-orm"
import type { Db } from "../../db/client"
import type { Storage } from "../../core/storage/storage"
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
 * Every base table of the public schema that has a `tenant_id` column, read from the catalogue (not a hand list), so a table added in a later migration is covered
 * without anyone remembering to list it here. Needs a role that may read the catalogue columns of those tables (the owner does).
 */
export async function tenantTableNames(owner: Db): Promise<string[]> {
  const rows = (await owner.execute(sql`
    select c.table_name as t from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' order by c.table_name`)).rows as { t: string }[]
  return rows.map((r) => r.t)
}

export type ResetResult = {
  tenants: number
  /** Storage objects deleted (final and staging keys of every file row of the demo tenants). */
  objectsRemoved: number
  /** Deletes that threw (storage unreachable); the rows are gone either way. */
  objectFailures: number
  /** Files that may still have an object, when no storage was given to remove them. */
  objectsLeft: number
}

/**
 * --reset: deletes the demo tenants (cascade removes all their rows) and everything else that carries their tenant_id (audit entries and any table without a foreign key
 * to tenants: the sweep runs over the catalogue, so a table added after B6 is included), then removes the files' objects from storage. It names the demo slugs itself and
 * nothing else, so no input can widen it; the caller has already passed the guard, which refuses any database holding another tenant.
 *
 * Storage: only through the injected `storage` (never built here), after the database commit, so a storage failure cannot leave rows pointing at nothing; a failed delete is
 * counted in the result. Keys come from the demo tenants' own `files` rows: `t/<tenant>/<file>` and the upload staging key `u/<tenant>/<file>`.
 */
export async function deleteDemoTenants(owner: Db, o: { storage?: Pick<Storage, "delete"> } = {}): Promise<ResetResult> {
  const rows = (await owner.execute(sql`select id from tenants where slug = any(${sql.raw(`ARRAY[${DEMO_SLUGS.map((s) => `'${s}'`).join(",")}]::text[]`)})`)).rows as { id: string }[]
  const catalogue = await tenantTableNames(owner)
  const keys: string[] = []
  let objectsLeft = 0
  for (const { id } of rows) {
    await owner.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`)
      const files = (await tx.execute(sql`select id, key, purpose, status, object_removed_at is not null as removed from files where tenant_id = ${id}`)).rows as { id: string; key: string; purpose: string | null; status: string; removed: boolean }[]
      for (const f of files) {
        keys.push(f.key, `u/${id}/${f.id}`)
        if (f.purpose !== "task_evidence" && f.status !== "deleted" && !f.removed) objectsLeft++
      }
      await tx.execute(sql`delete from audit_events where tenant_id = ${id}`) // no foreign key to tenants, so the cascade would leave the chain behind
      await tx.execute(sql`delete from tenants where id = ${id} and slug = any(${sql.raw(`ARRAY[${DEMO_SLUGS.map((s) => `'${s}'`).join(",")}]::text[]`)})`)
      for (const t of catalogue) await tx.execute(sql`delete from ${sql.identifier(t)} where tenant_id = ${id}`) // what the cascade could not reach
    })
  }
  let objectsRemoved = 0
  let objectFailures = 0
  if (o.storage) {
    for (const k of keys) {
      try {
        await o.storage.delete(k)
        objectsRemoved++
      } catch {
        objectFailures++
      }
    }
    objectsLeft = 0
  }
  return { tenants: rows.length, objectsRemoved, objectFailures, objectsLeft: o.storage ? objectFailures : objectsLeft }
}
