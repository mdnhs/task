import { and, asc, eq, or, sql } from "drizzle-orm"
import { projects, taskAssignees, taskChecklistItems, taskComments, taskFiles, taskHistory, taskTimeEntries, tasks } from "../../db/schema"
import type { DsrHandler } from "../gdpr/registry"

/**
 * Data-subject requests for tasks (FR-M0-18). Export: the tasks the subject created or is assigned to (ids, refs, titles, their
 * role) and the history lines they wrote. Erase: creator, archiver and history actor become null, their time entries lose the person
 * link, they are removed from every assignment and from `notified` lists. The tasks and their history stay (business records).
 * Idempotent: a re-run finds nothing to change.
 */
export const tasksDsrHandler: DsrHandler = {
  async export(tx, tenantId, userId) {
    const rows = await tx
      .select({ id: tasks.id, refNo: tasks.refNo, title: tasks.title, creatorId: tasks.creatorId, assigned: sql<boolean>`exists (select 1 from ${taskAssignees} ta where ta.task_id = ${tasks.id} and ta.user_id = ${userId})` })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), or(eq(tasks.creatorId, userId), sql`exists (select 1 from ${taskAssignees} ta where ta.task_id = ${tasks.id} and ta.user_id = ${userId})`)))
      .orderBy(asc(tasks.refNo))
    const history = await tx
      .select({ id: taskHistory.id, taskId: taskHistory.taskId, at: taskHistory.at, kind: taskHistory.kind, text: taskHistory.text })
      .from(taskHistory)
      .where(and(eq(taskHistory.tenantId, tenantId), eq(taskHistory.actorId, userId)))
      .orderBy(asc(taskHistory.at), asc(taskHistory.id))
    const comments = await tx
      .select({ id: taskComments.id, taskId: taskComments.taskId, at: taskComments.createdAt, body: taskComments.body })
      .from(taskComments)
      .where(and(eq(taskComments.tenantId, tenantId), eq(taskComments.authorId, userId), sql`${taskComments.deletedAt} is null`))
      .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
    return {
      comments: comments.map((c) => ({ id: c.id, taskId: c.taskId, at: c.at.toISOString(), body: c.body })),
      tasks: rows.map((r) => ({ id: r.id, ref: `TSK-${r.refNo}`, title: r.title, role: [...(r.creatorId === userId ? ["creator"] : []), ...(r.assigned ? ["assignee"] : [])] })),
      history: history.map((h) => ({ id: h.id, taskId: h.taskId, at: h.at.toISOString(), kind: h.kind, text: h.text })),
    }
  },
  async erase(tx, tenantId, userId) {
    await tx.update(tasks).set({ creatorId: null }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.creatorId, userId)))
    await tx.update(projects).set({ leadId: null }).where(and(eq(projects.tenantId, tenantId), eq(projects.leadId, userId)))
    await tx.update(tasks).set({ archivedBy: null }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.archivedBy, userId)))
    await tx.update(taskHistory).set({ actorId: null }).where(and(eq(taskHistory.tenantId, tenantId), eq(taskHistory.actorId, userId)))
    await tx.update(taskHistory).set({ notified: sql`array_remove(${taskHistory.notified}, ${userId})` }).where(and(eq(taskHistory.tenantId, tenantId), sql`${userId} = any(${taskHistory.notified})`))
    await tx.update(taskTimeEntries).set({ userId: null }).where(and(eq(taskTimeEntries.tenantId, tenantId), eq(taskTimeEntries.userId, userId)))
    await tx.update(taskChecklistItems).set({ doneBy: null }).where(and(eq(taskChecklistItems.tenantId, tenantId), eq(taskChecklistItems.doneBy, userId)))
    await tx.update(taskComments).set({ authorId: null }).where(and(eq(taskComments.tenantId, tenantId), eq(taskComments.authorId, userId)))
    await tx.update(taskComments).set({ mentions: sql`array_remove(${taskComments.mentions}, ${userId})` }).where(and(eq(taskComments.tenantId, tenantId), sql`${userId} = any(${taskComments.mentions})`))
    await tx.update(taskFiles).set({ createdBy: null }).where(and(eq(taskFiles.tenantId, tenantId), eq(taskFiles.createdBy, userId)))
    await tx.execute(sql`update search_documents set audience = array_remove(array_remove(audience, ${`a:${userId}`}), ${`o:${userId}`}) where tenant_id = ${tenantId} and entity = 'task' and (${`a:${userId}`} = any(audience) or ${`o:${userId}`} = any(audience))`)
    await tx.delete(taskAssignees).where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.userId, userId)))
  },
}
