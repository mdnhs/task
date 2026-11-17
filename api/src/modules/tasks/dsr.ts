import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import { projects, taskAssignees, taskEvidence, taskTemplates, taskChecklistItems, taskComments, taskFiles, taskHistory, taskTimeEntries, taskVoiceAccess, tasks } from "../../db/schema"
import { expireFile } from "../files"
import type { DsrHandler } from "../gdpr/registry"
import { writeHistory } from "./history"

/**
 * Data-subject requests for tasks (FR-M0-18). Export: the tasks the subject created or is assigned to (ids, refs, titles, their
 * role) and the history lines they wrote. Evidence: export = the subject's items as metadata; erase nulls created_by / reviewed_by (the items and files stay until the task purge, D13).
 * Voice notes (T4.7): export = the notes the subject recorded (task, duration, type, time; never the file) and the times they played one; erase = every note they
 * recorded is cleared on ALL tasks that share its file and the file is deleted (queued after commit), and their plays lose the person link (the other players stay).
 * Erase: creator, archiver and history actor become null, their time entries lose the person
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
    // evidence the subject uploaded or decided: ids and metadata only (no file name, note text or link)
    const evidence = await tx
      .select({ id: taskEvidence.id, taskId: taskEvidence.taskId, kind: taskEvidence.kind, at: taskEvidence.createdAt, review: taskEvidence.review })
      .from(taskEvidence)
      .where(and(eq(taskEvidence.tenantId, tenantId), or(eq(taskEvidence.createdBy, userId), eq(taskEvidence.reviewedBy, userId))))
      .orderBy(asc(taskEvidence.createdAt), asc(taskEvidence.id))
    // voice notes the subject recorded (metadata only: no file id or name) and their own plays
    const voice = await tx
      .select({ id: tasks.id, refNo: tasks.refNo, meta: tasks.voiceMeta })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), sql`${tasks.voiceFileId} is not null`, sql`${tasks.voiceMeta}->>'recordedBy' = ${userId}`))
      .orderBy(asc(tasks.id))
    const voicePlays = await tx
      .select({ id: taskVoiceAccess.id, taskId: taskVoiceAccess.taskId, at: taskVoiceAccess.at })
      .from(taskVoiceAccess)
      .where(and(eq(taskVoiceAccess.tenantId, tenantId), eq(taskVoiceAccess.userId, userId)))
      .orderBy(asc(taskVoiceAccess.at), asc(taskVoiceAccess.id))
    return {
      voiceNotes: voice.map((v) => ({ taskId: v.id, ref: `TSK-${v.refNo}`, durationSec: (v.meta as { durationSec?: number } | null)?.durationSec ?? null, mime: (v.meta as { mime?: string } | null)?.mime ?? null, recordedAt: (v.meta as { recordedAt?: string } | null)?.recordedAt ?? null })),
      voicePlays: voicePlays.map((p) => ({ id: p.id, taskId: p.taskId, at: p.at.toISOString() })),
      evidence: evidence.map((e) => ({ id: e.id, taskId: e.taskId, kind: e.kind, at: e.at.toISOString(), review: e.review })),
      comments: comments.map((c) => ({ id: c.id, taskId: c.taskId, at: c.at.toISOString(), body: c.body })),
      tasks: rows.map((r) => ({ id: r.id, ref: `TSK-${r.refNo}`, title: r.title, role: [...(r.creatorId === userId ? ["creator"] : []), ...(r.assigned ? ["assignee"] : [])] })),
      history: history.map((h) => ({ id: h.id, taskId: h.taskId, at: h.at.toISOString(), kind: h.kind, text: h.text })),
    }
  },
  async erase(tx, tenantId, userId, now, enqueue) {
    // Voice notes first, while `recordedBy` still names the subject. The rows are locked in id order (a recurrence run on the series finishes first, so its
    // instance is visible to the next statement); every task sharing a file of theirs loses the note, and the file goes: no reference count is needed
    // because ALL references are cleared, so this takes no purge lock (which would invert the DSR lock order: membership row, then purge lock).
    const mine = await tx
      .select({ id: tasks.id, fileId: tasks.voiceFileId })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), sql`${tasks.voiceMeta}->>'recordedBy' = ${userId}`))
      .orderBy(asc(tasks.id))
      .for("update", { of: [tasks] })
    const fileIds = [...new Set(mine.flatMap((m) => (m.fileId ? [m.fileId] : [])))].sort()
    const orphans = mine.filter((m) => !m.fileId).map((m) => m.id)
    if (orphans.length) await tx.update(tasks).set({ voiceMeta: null }).where(and(eq(tasks.tenantId, tenantId), inArray(tasks.id, orphans)))
    if (fileIds.length) {
      const cleared = await tx
        .update(tasks)
        .set({ voiceFileId: null, voiceMeta: null, version: sql`${tasks.version} + 1`, updatedAt: now })
        .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.voiceFileId, fileIds)))
        .returning({ id: tasks.id })
      for (const t of cleared.sort((a, b) => a.id.localeCompare(b.id))) await writeHistory(tx, { tenantId, actorId: "system:erasure", now }, t.id, { kind: "voice", text: "Voice note removed" })
      for (const fileId of fileIds) await expireFile(tx, tenantId, fileId, enqueue ?? (() => {})) // without a queue the hourly retention sweep re-queues the object removal
    }
    await tx.update(taskVoiceAccess).set({ userId: null }).where(and(eq(taskVoiceAccess.tenantId, tenantId), eq(taskVoiceAccess.userId, userId)))
    await tx.update(tasks).set({ creatorId: null }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.creatorId, userId)))
    await tx.update(projects).set({ leadId: null }).where(and(eq(projects.tenantId, tenantId), eq(projects.leadId, userId)))
    await tx.update(taskTemplates).set({ createdBy: null }).where(and(eq(taskTemplates.tenantId, tenantId), eq(taskTemplates.createdBy, userId)))
    await tx.update(taskTemplates).set({ assigneeId: null }).where(and(eq(taskTemplates.tenantId, tenantId), eq(taskTemplates.assigneeId, userId)))
    await tx.update(tasks).set({ archivedBy: null }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.archivedBy, userId)))
    await tx.update(taskHistory).set({ actorId: null }).where(and(eq(taskHistory.tenantId, tenantId), eq(taskHistory.actorId, userId)))
    await tx.update(taskHistory).set({ notified: sql`array_remove(${taskHistory.notified}, ${userId})` }).where(and(eq(taskHistory.tenantId, tenantId), sql`${userId} = any(${taskHistory.notified})`))
    await tx.update(taskTimeEntries).set({ userId: null }).where(and(eq(taskTimeEntries.tenantId, tenantId), eq(taskTimeEntries.userId, userId)))
    await tx.update(taskChecklistItems).set({ doneBy: null }).where(and(eq(taskChecklistItems.tenantId, tenantId), eq(taskChecklistItems.doneBy, userId)))
    await tx.update(taskComments).set({ authorId: null }).where(and(eq(taskComments.tenantId, tenantId), eq(taskComments.authorId, userId)))
    await tx.update(taskComments).set({ mentions: sql`array_remove(${taskComments.mentions}, ${userId})` }).where(and(eq(taskComments.tenantId, tenantId), sql`${userId} = any(${taskComments.mentions})`))
    await tx.update(taskEvidence).set({ createdBy: null }).where(and(eq(taskEvidence.tenantId, tenantId), eq(taskEvidence.createdBy, userId)))
    await tx.update(taskEvidence).set({ reviewedBy: null }).where(and(eq(taskEvidence.tenantId, tenantId), eq(taskEvidence.reviewedBy, userId)))
    await tx.update(taskFiles).set({ createdBy: null }).where(and(eq(taskFiles.tenantId, tenantId), eq(taskFiles.createdBy, userId)))
    await tx.execute(sql`update search_documents set audience = array_remove(array_remove(audience, ${`a:${userId}`}), ${`o:${userId}`}) where tenant_id = ${tenantId} and entity = 'task' and (${`a:${userId}`} = any(audience) or ${`o:${userId}`} = any(audience))`)
    await tx.delete(taskAssignees).where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.userId, userId)))
  },
}
