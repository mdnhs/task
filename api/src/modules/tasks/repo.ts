import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { taskAssignees, taskCounters } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"

/**
 * The next `TSK-<n>` number of the tenant. The counter row is created on first use and then UPDATEd (row lock held until commit), so
 * concurrent creates are serialised and each gets its own number. A rolled-back create gives its number back (same tx).
 */
export async function nextRefNo(tx: TenantTx, tenantId: string): Promise<number> {
  await tx.insert(taskCounters).values({ tenantId }).onConflictDoNothing()
  const [row] = await tx
    .update(taskCounters)
    .set({ nextNo: sql`${taskCounters.nextNo} + 1` })
    .where(eq(taskCounters.tenantId, tenantId))
    .returning({ no: sql<number>`${taskCounters.nextNo} - 1` })
  return row.no
}

export type AssigneeSet = { primary: string | null; others: string[] }

/** Assignees of many tasks in one query: the primary, then the others in id order. */
export async function assigneesOf(tx: TenantTx, tenantId: string, taskIds: string[]): Promise<Map<string, AssigneeSet>> {
  const out = new Map<string, AssigneeSet>(taskIds.map((id) => [id, { primary: null, others: [] }]))
  if (taskIds.length === 0) return out
  const rows = await tx
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, isPrimary: taskAssignees.isPrimary })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.tenantId, tenantId), inArray(taskAssignees.taskId, taskIds)))
    .orderBy(asc(taskAssignees.userId))
  for (const r of rows) {
    const s = out.get(r.taskId)!
    if (r.isPrimary) s.primary = r.userId
    else s.others.push(r.userId)
  }
  return out
}

export const allAssignees = (s: AssigneeSet): string[] => (s.primary ? [s.primary, ...s.others] : [...s.others])

/** Replaces the assignee rows of a task (the caller holds the task row lock). */
export async function replaceAssignees(tx: TenantTx, tenantId: string, taskId: string, primary: string, others: string[]): Promise<void> {
  await tx.delete(taskAssignees).where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.taskId, taskId)))
  await tx.insert(taskAssignees).values([{ tenantId, taskId, userId: primary, isPrimary: true }, ...others.map((userId) => ({ tenantId, taskId, userId, isPrimary: false }))])
}
