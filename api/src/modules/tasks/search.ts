import { and, eq } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import type { Context } from "hono"
import { taskScope } from "@opsdesk/domain/task-scope"
import type { AppEnv } from "../../core/context"
import { subjectUserId } from "../../core/middleware/principal"
import { loadRole } from "../../core/middleware/permission"
import { subscribe } from "../../core/events"
import { taskAssignees, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { indexDocument, removeDocument, type SearchScopes } from "../search/service"
import { directReports, effectiveReportScope } from "../teams"

const EMAIL = /[^\s@<>()[\]"']+@[^\s@<>()[\]"']+\.[A-Za-z]{2,}/g
const BODY_CHARS = 500

/** Search text never carries a Drive URL or an email address (ruling D22; emails are never indexed). Cleaned BEFORE any cut. */
export const searchText = (v: string): string => withholdDriveText(v).replace(EMAIL, "").replace(/\s+/g, " ").trim()

/**
 * (Re)indexes one task from its current row (ruling D12): `{ entity: "task", module: "tasks", title: "<ref> <title>", body: labels + the
 * first 500 characters of the description }`, audience = assignees ∪ creator ∪ named reviewer. A missing or archived task drops its
 * document, so archived tasks are never found and a restore (task.restored) brings the document back.
 */
export async function indexTask(tx: TenantTx, tenantId: string, taskId: string, now: Date): Promise<void> {
  const [t] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
  if (!t || t.archivedAt) return removeDocument(tx, tenantId, "task", taskId)
  const people = await tx.select({ u: taskAssignees.userId }).from(taskAssignees).where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.taskId, taskId)))
  // Role-tagged (ruling E4): `a:` = assignee, `o:` = creator or named reviewer, so the team scope can match only assignees who report to me (D5).
  const audience = [...new Set([...people.map((p) => `a:${p.u}`), ...(t.creatorId ? [`o:${t.creatorId}`] : []), ...(t.evidenceRule.reviewer ? [`o:${t.evidenceRule.reviewer}`] : [])])].sort()
  const body = [searchText(t.labels.join(" ")), searchText(t.description).slice(0, BODY_CHARS)].filter(Boolean).join(" ")
  await indexDocument(tx, { tenantId, entity: "task", entityId: taskId, module: "tasks", title: searchText(`TSK-${t.refNo} ${t.title}`), body, audience }, now)
}

/** Registers the task indexers on the event bus (called from registerSearchIndexers). */
export function registerTaskSearchIndexers(): void {
  for (const type of ["task.created", "task.updated", "task.assigned", "task.archived", "task.restored", "task.purged"] as const) {
    try {
      subscribe(type, `search.${type.replace(".", "-")}`, async (e, { tx }) => {
        const id = typeof e.payload.taskId === "string" ? e.payload.taskId : null
        if (id) await indexTask(tx, e.tenantId, id, e.occurredAt)
      })
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
    }
  }
}

/**
 * The search row scope for tasks (ruling D12) from the caller's task scope: own → themself (either role); team → themself + direct reports as assignees only; all → no filter.
 * "Me" is subjectUserId (the creator for an API key). null = no scope entry (all) — and a caller with no task scope sees none (module gate).
 */
export async function taskSearchScope(c: Context<AppEnv>, tx: TenantTx): Promise<SearchScopes> {
  const role = await loadRole(c)
  const me = subjectUserId(c)
  const scope = taskScope({ ...role, reportScope: await effectiveReportScope(tx, c.get("tenant")!.id, role) }, me)
  if (!scope || scope.kind === "all") return scope ? { tasks: null } : { tasks: { audience: [] } }
  if (scope.kind === "own") return { tasks: { audience: [`a:${scope.personId}`, `o:${scope.personId}`] } }
  // own tasks (any role) plus tasks with an ASSIGNEE who reports to me; a report who is only creator or reviewer does not widen it (D5, ruling E4)
  const reports = await directReports(tx, scope.managerId)
  return { tasks: { audience: [`a:${scope.managerId}`, `o:${scope.managerId}`, ...reports.map((r) => `a:${r}`)] } }
}
