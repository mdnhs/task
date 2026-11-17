import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { ARCHIVE_DAYS } from "@opsdesk/domain/task-planning"
import type { AppEnv } from "../../core/context"
import { AppError, Conflict, Forbidden } from "../../core/errors"
import { actorIdOf } from "../../core/middleware/principal"
import { tasks, taskFiles, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { tenantEntitlements } from "../entitlements/service"
import { DELETE_OBJECT_JOB, expireFile } from "../files"
import { withTenantAfterCommit, type Enqueue } from "../notifications"
import { lockActor } from "../rbac"
import { removeDocument } from "../search/service"
import type { TaskDto } from "./dto"
import { publishTaskEvent } from "./events"
import { lockTaskGraph } from "./graph"
import { writeHistory } from "./history"
import { allAssignees, assigneesOf } from "./repo"
import { canManage, getTask, loadTaskCtx, type TaskCtx, type TaskRow } from "./scope"
import { indexTask } from "./search"
import { staleVersion, taskDetailDto } from "./service"

// Archive, restore and purge (FR-M1-13, ruling D13).
//
// ARCHIVE hides a task from every list, the board, the calendar, search and knock-on; nothing is deleted and the dependency edges stay (a restore needs
// them, and the cycle check still sees them: ruling E5). The task and its OPEN subtasks get one `archive_batch_id`; a restore brings that batch back.
// RESTORE works for 30 days from `archived_at` (the same instant after which the retention job may purge, so there is no gap and no overlap).
// PURGE hard-deletes a task that is ALREADY archived: by hand (tenant admin, human only) or by the hourly retention job. Everything below the
// task row leaves through ON DELETE CASCADE (children, history, dependency edges in both directions, task files rows).
//
// Purge lock order (the B4 rule: advisory locks first, then the actor, then rows): task graph lock → task purge lock → actor → task row FOR UPDATE →
// its subtasks and instances → files → delete → search document → audit → publish. The purge lock serialises purges of one tenant: it is what makes the
// "is this voice file still referenced elsewhere" check and the delete one atomic step against another purge, and a recurrence copy of a voice id
// reads it from a series row that this purge holds FOR UPDATE, so that cannot interleave either.

export const ARCHIVE_PURGE_JOB = "tasks.archive-purge"
/** Audit and event actor of the retention job. */
export const RETENTION_ACTOR = "system:archive-retention"
/** Tasks purged per batch by the retention job (each task is its own transaction). */
export const PURGE_BATCH = 200
/** At most this many batches per tenant per run; the rest waits for the next hour, so one run stays bounded. */
const MAX_BATCHES = 50
const DAY_MS = 86_400_000
const OPEN_STATUSES = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]
const ref = (n: number) => `TSK-${n}`

/** Two-key advisory lock namespace for purges of one tenant ("tprn"), same pattern as TASK_GRAPH_LOCK_NS. */
export const TASK_PURGE_LOCK_NS = 0x7470726e
const lockTaskPurge = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${TASK_PURGE_LOCK_NS}::int, hashtext(${tenantId}::text))`)

const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? ((e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : undefined
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

/** Restore window: 30 full days from the archive instant (UTC instants, so DST never shifts it). */
export const archiveExpired = (archivedAt: Date, now: Date): boolean => now.getTime() - archivedAt.getTime() >= ARCHIVE_DAYS * DAY_MS

export const ArchiveBody = z.object({ version: z.number().int().min(1).openapi({ description: "The task's current version (ruling D4)", example: 1 }) }).openapi({ example: { version: 1 } })
export const RestoreBody = z.object({}).openapi({ example: {} })

type Env = { enqueue: Enqueue }

// ---------- archive ----------

/** POST /v1/tasks/{id}/archive: managers only (D6). Row lock → permission → archived? → version → cascade → history → search → audit → publish. */
export async function archiveTask(tx: TenantTx, _env: Env, ctx: TaskCtx, id: string, input: { version: number }): Promise<TaskDto> {
  const row = await getTask(tx, ctx, id, { forUpdate: true, includeArchived: true }) // 404 for another tenant, unknown and out of scope
  const assignees = allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!)
  if (!canManage(ctx, row, assignees)) throw Forbidden("forbidden")
  if (row.archivedAt) throw Conflict("task_archived")
  staleVersion(row, input.version)
  // The open subtasks go with their parent whatever their scope (the parent is the manager's decision); completed and cancelled ones stay live.
  const kids = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.parentId, row.id), sql`${tasks.archivedAt} is null`, inArray(tasks.status, OPEN_STATUSES)))
    .orderBy(asc(tasks.id))
    .for("update", { of: [tasks] })
  const members = [row, ...kids]
  const batch = crypto.randomUUID()
  await tx
    .update(tasks)
    .set({ archivedAt: ctx.now, archivedBy: ctx.actorId, archiveBatchId: batch, version: sql`${tasks.version} + 1`, updatedAt: ctx.now })
    .where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, members.map((m) => m.id))))
  for (const m of members) {
    await writeHistory(tx, ctx, m.id, { kind: "archived", text: m.id === row.id ? "Archived" : `Archived with ${ref(row.refNo)}` })
    await removeDocument(tx, ctx.tenantId, "task", m.id) // gone from search at once, not when the relay catches up
  }
  const [next] = await tx.select().from(tasks).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
  const dto = await taskDetailDto(tx, ctx, next)
  for (const m of members) {
    await recordAudit(tx, ctx.tenantId, {
      action: "task.archived", entity: "task", entityId: m.id, actorId: ctx.actorId,
      before: { ref: ref(m.refNo), status: m.status },
      after: { archivedAt: ctx.now.toISOString(), ...(m.id === row.id ? { subtasks: kids.length } : { withParent: ref(row.refNo) }) },
    }, ctx.now)
  }
  for (const m of members) await publishTaskEvent(tx, ctx, { type: "task.archived", payload: { taskId: m.id } })
  return dto
}

// ---------- restore ----------

/** POST /v1/tasks/{id}/restore: managers only; the whole archive batch comes back; 410 archive_expired after 30 days. */
export async function restoreTask(tx: TenantTx, _env: Env, ctx: TaskCtx, id: string): Promise<TaskDto> {
  const row = await getTask(tx, ctx, id, { forUpdate: true, includeArchived: true })
  const assignees = allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!)
  if (!canManage(ctx, row, assignees)) throw Forbidden("forbidden")
  if (!row.archivedAt) throw Conflict("task_not_archived")
  if (archiveExpired(row.archivedAt, ctx.now)) throw new AppError(410, "archive_expired", "Gone")
  const others = row.archiveBatchId
    ? await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.archiveBatchId, row.archiveBatchId), sql`${tasks.archivedAt} is not null`, sql`${tasks.id} <> ${row.id}`))
        .orderBy(asc(tasks.id))
        .for("update", { of: [tasks] })
    : []
  const members = [row, ...others]
  await tx
    .update(tasks)
    .set({ archivedAt: null, archivedBy: null, archiveBatchId: null, version: sql`${tasks.version} + 1`, updatedAt: ctx.now })
    .where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, members.map((m) => m.id))))
  for (const m of members) {
    await writeHistory(tx, ctx, m.id, { kind: "restored", text: m.id === row.id ? "Restored" : `Restored with ${ref(row.refNo)}` })
    await indexTask(tx, ctx.tenantId, m.id, ctx.now) // back in search at once, with its role-tagged audience (ruling E4)
  }
  const [next] = await tx.select().from(tasks).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
  const dto = await taskDetailDto(tx, ctx, next)
  for (const m of members) {
    await recordAudit(tx, ctx.tenantId, {
      action: "task.restored", entity: "task", entityId: m.id, actorId: ctx.actorId,
      before: { ref: ref(m.refNo), archivedAt: m.archivedAt!.toISOString() }, after: { ref: ref(m.refNo) },
    }, ctx.now)
  }
  for (const m of members) await publishTaskEvent(tx, ctx, { type: "task.restored", payload: { taskId: m.id } })
  return dto
}

// ---------- purge ----------

type Who = { tenantId: string; actorId: string; now: Date }

/**
 * Deletes ONE archived task for good. The caller holds the graph and purge locks and the task row FOR UPDATE, and has checked that it is archived
 * (and, for the job, past 30 days). Everything is in the caller's tx: a failure anywhere rolls the whole purge back (nothing half-deleted, no audit row,
 * no file marked deleted); the delete-object jobs are only queued after the commit.
 *  - Subtasks (any state) lose their parent link (parent_id has no cascade: a child is a task of its own and is purged on its own clock);
 *    recurring instances lose their series link (series_id / occurrence_date null), so none dangle. Both bump `version`.
 *  - Files of the task go through B2's `expireFile` (soft delete + `file.delete-object` after commit; the unfinished uploads too), EXCEPT a voice file
 *    another task still points at (D21: the series shares one): that one is kept and its task_files row moves to the surviving task, so it stays reachable.
 */
export async function purgeArchivedTask(tx: TenantTx, enqueue: Enqueue, who: Who, row: TaskRow): Promise<void> {
  const { tenantId, now } = who
  const kids = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.parentId, row.id))).orderBy(asc(tasks.id)).for("update", { of: [tasks] })
  if (kids.length > 0) {
    await tx.update(tasks).set({ parentId: null, version: sql`${tasks.version} + 1`, updatedAt: now }).where(and(eq(tasks.tenantId, tenantId), inArray(tasks.id, kids.map((k) => k.id))))
    for (const k of kids) await writeHistory(tx, who, k.id, { kind: "detached", text: `${ref(row.refNo)} was removed; this is now a task of its own` })
  }
  await tx.update(tasks).set({ seriesId: null, occurrenceDate: null, version: sql`${tasks.version} + 1`, updatedAt: now }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.seriesId, row.id)))

  const mine = await tx.select({ fileId: taskFiles.fileId }).from(taskFiles).where(and(eq(taskFiles.tenantId, tenantId), eq(taskFiles.taskId, row.id))).orderBy(asc(taskFiles.fileId))
  const fileIds = mine.map((f) => f.fileId)
  const holders = fileIds.length
    ? await tx
        .select({ fileId: tasks.voiceFileId, holder: sql<string>`(array_agg(${tasks.id} order by (${tasks.archivedAt} is not null), ${tasks.id}))[1]` })
        .from(tasks)
        .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.voiceFileId, fileIds), sql`${tasks.id} <> ${row.id}`))
        .groupBy(tasks.voiceFileId)
    : []
  const kept = new Map(holders.map((h) => [h.fileId!, h.holder]))
  for (const fileId of fileIds) {
    const holder = kept.get(fileId)
    if (holder) await tx.update(taskFiles).set({ taskId: holder }).where(and(eq(taskFiles.tenantId, tenantId), eq(taskFiles.fileId, fileId)))
    else await expireFile(tx, tenantId, fileId, enqueue)
  }

  const gone = await tx.delete(tasks).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, tenantId))).returning({ id: tasks.id })
  if (gone.length !== 1) throw new Error("purge deleted an unexpected number of rows")
  await removeDocument(tx, tenantId, "task", row.id)
  await recordAudit(tx, tenantId, { action: "task.purged", entity: "task", entityId: row.id, actorId: who.actorId, before: { ref: ref(row.refNo), archivedAt: row.archivedAt!.toISOString() }, after: null }, now)
  await publishTaskEvent(tx, { tenantId, actorId: who.actorId, now }, { type: "task.purged", payload: { taskId: row.id } })
}

/** DELETE /v1/tasks/{id} (settings:write, human only): purges an already archived task at once, whatever its age. */
export async function purgeTask(c: Context<AppEnv>, id: string): Promise<void> {
  if (c.get("apiKey")) throw Forbidden("human_required") // a purge is a person's decision: no key, whatever its scopes
  const deps = c.get("deps")
  const tenantId = c.get("tenant")!.id
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockTaskGraph(tx, tenantId)
    await lockTaskPurge(tx, tenantId)
    await lockActor(tx, tenantId, actorIdOf(c), "settings", "write") // R25: the permission is re-read under lock
    const ctx = await loadTaskCtx(c, tx, "read")
    const row = await getTask(tx, ctx, id, { forUpdate: true, includeArchived: true }) // 404: unknown, another tenant's, out of the caller's scope
    if (!row.archivedAt) throw Conflict("task_not_archived")
    await purgeArchivedTask(tx, enqueue, { tenantId, actorId: ctx.actorId, now: ctx.now }, row)
  })
}

// ---------- the retention job ----------

/** One expired task in its own transaction; re-checked under the locks, so an id that was purged, restored or never expired is a no-op. */
async function purgeIfExpired(deps: Deps, tenantId: string, id: string, cutoff: Date): Promise<boolean> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockTaskGraph(tx, tenantId)
    await lockTaskPurge(tx, tenantId)
    const [row] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId), sql`${tasks.archivedAt} is not null`, sql`${tasks.archivedAt} <= ${cutoff.toISOString()}::timestamptz`))
      .for("update", { of: [tasks] })
    if (!row) return false
    await purgeArchivedTask(tx, enqueue, { tenantId, actorId: RETENTION_ACTOR, now: deps.clock.now() }, row)
    return true
  })
}

/** Re-queues `file.delete-object` for task files that were deleted but whose object removal never completed (a lost enqueue, a failed job). */
async function requeueObjects(deps: Deps, tenantId: string): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    const rows = await tx.execute(sql`
      select id from files
      where tenant_id = ${tenantId} and status = 'deleted' and object_removed_at is null and purpose like 'task!_%' escape '!'
      order by created_at, id limit ${PURGE_BATCH}`)
    for (const r of rows.rows as { id: string }[]) enqueue(DELETE_OBJECT_JOB, { fileId: r.id, tenantId }, { key: `${r.id}-${crypto.randomUUID()}` })
  })
}

/**
 * Job `tasks.archive-purge` (hourly, `{}`). Active tenants only (C14) that still have M1 and are not blocked for payment (C13); the others keep their
 * data. Per tenant: first re-queue unfinished object deletions, then purge tasks archived at least 30 days ago, 200 at a time, oldest first, each in its
 * own transaction (one failing task is logged by id and left archived; the rest go on and the next run tries it again). Idempotent, and safe with two
 * runs at once: the purge lock serialises them and the loser finds the rows gone. Time comes ONLY from deps.clock (ruling E3).
 */
export async function runArchivePurge(_data: unknown, deps: Deps): Promise<void> {
  const rows = await deps.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active")) // `tenants` has no RLS
  for (const { id: tenantId } of rows) {
    try {
      const now = deps.clock.now()
      const ent = await tenantEntitlements(deps.db, tenantId, now)
      if (!ent.allowed.includes("M1") || ent.billingState === "blocked") continue
      await requeueObjects(deps, tenantId)
      const cutoff = new Date(now.getTime() - ARCHIVE_DAYS * DAY_MS)
      let after: { at: Date; id: string } | null = null
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const page: { id: string; at: Date | null }[] = await withTenant(deps.db, tenantId, (tx) =>
          tx
            .select({ id: tasks.id, at: tasks.archivedAt })
            .from(tasks)
            .where(and(eq(tasks.tenantId, tenantId), sql`${tasks.archivedAt} is not null`, sql`${tasks.archivedAt} <= ${cutoff.toISOString()}::timestamptz`, after ? sql`(${tasks.archivedAt}, ${tasks.id}) > (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)` : undefined))
            .orderBy(asc(tasks.archivedAt), asc(tasks.id))
            .limit(PURGE_BATCH),
        )
        for (const t of page) {
          try {
            await purgeIfExpired(deps, tenantId, t.id, cutoff)
          } catch (err) {
            deps.logger.error({ tenantId, taskId: t.id, errCode: safeCode(err) }, "task purge failed; it stays archived")
          }
        }
        if (page.length < PURGE_BATCH) break
        const last = page[page.length - 1]
        after = { at: last.at!, id: last.id }
      }
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "task retention failed for a tenant")
    }
  }
}
