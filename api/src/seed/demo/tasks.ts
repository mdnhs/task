import { and, eq } from "drizzle-orm"
import { normaliseRule, type EvidenceRule } from "@opsdesk/domain/task-evidence"
import { files, taskAssignees, taskChecklistItems, taskComments, taskCounters, taskDependencies, taskEvidence, taskFiles, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { publishTaskEvent } from "../../modules/tasks/events"
import { writeHistory } from "../../modules/tasks/history"
import type { Anchor } from "./anchor"
import { detId } from "./ids"
import type { MockEvidence, MockRule, MockTask } from "./source"

const refNo = (ref: string): number => Number(ref.slice("TSK-".length))
const FILE_KINDS = new Set(["photo", "image", "pdf", "office", "video", "signature"])
const MIME: Record<string, string> = {
  photo: "image/jpeg", image: "image/png", signature: "image/png", video: "video/mp4", pdf: "application/pdf",
  office: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

export type TaskWorld = {
  tenantId: string
  now: Date
  anchor: Anchor
  actorId: string
  /** mock person id (p-..) or display name -> user id */
  userOfMock: (pid: string) => string
  userOfName: (name: string) => string
  teamId: (dept: string) => string | null
  projectId: (mockId: string) => string | null
  milestoneId: (mockId: string) => string | null
}

const rule = (w: TaskWorld, r: MockRule): EvidenceRule => {
  const out = { mode: r.mode, types: r.types, min: r.min, instruction: r.instruction, review: r.review, ...(r.reviewer ? { reviewer: w.userOfMock(r.reviewer) } : {}) } as EvidenceRule
  return normaliseRule(out)
}

/** The task a timeline line belongs to: only the kind label differs, the text is the mock's own. */
const kindOf = (text: string): string => (/^Created/.test(text) ? "created" : /archived/i.test(text) ? "archived" : "status")

/**
 * Inserts the mock's tasks for one tenant, keeping every ref and the per-tenant counter (the next created task is TSK-<max+1>). Raw inserts (the create
 * service always allocates the next ref and starts a task as not_started with no history), but with the same invariants the services keep: the composite
 * foreign keys, the assignee rows (one primary), the history lines through writeHistory (so a Drive link is withheld at write time), a clean evidence file row
 * with its task_files link, the counter row, and a `task.created` event per task so the search indexer (registered by the seed's relay) indexes it.
 * Rows carry deterministic ids (detId) so a deep link to a task survives a re-run.
 */
export async function seedTasks(tx: TenantTx, w: TaskWorld, mock: MockTask[]): Promise<{ ids: Map<string, string>; evidenceFiles: number }> {
  const ids = new Map(mock.map((t) => [t.ref, detId(w.tenantId, "task", t.ref)]))
  let evidenceFiles = 0
  for (const t of mock) {
    const id = ids.get(t.ref)!
    const status = t.status
    const archived = Boolean(t.archivedAt)
    await tx
      .insert(tasks)
      .values({
        id, tenantId: w.tenantId, refNo: refNo(t.ref), title: t.title, description: t.description, teamId: w.teamId(t.dept), creatorId: w.userOfMock(t.creator),
        priority: t.priority, startAt: w.anchor.instant(t.start), dueAt: w.anchor.instant(t.due), status,
        labels: [...new Set((t.tags ?? []).map((x) => x.trim().toLowerCase()))], estimateMin: t.estimate ?? null, client: t.client ?? null,
        projectId: t.projectId ? w.projectId(t.projectId) : null, milestoneId: t.milestoneId ? w.milestoneId(t.milestoneId) : null,
        evidenceRule: rule(w, t.evidenceRule), round: Math.max(1, ...t.evidence.map((e) => e.round ?? 1)),
        repeat: t.repeat ? ({ freq: t.repeat.freq, ...(t.repeat.days ? { days: t.repeat.days } : {}), ...(t.repeat.dayOfMonth ? { dayOfMonth: t.repeat.dayOfMonth } : {}), ...(t.repeat.until ? { until: w.anchor.day(t.repeat.until) } : {}) } as never) : null,
        seriesId: null, // a series ROOT has no series id: its instances point at it (recurrence.ts)
        // a series is materialised from tomorrow on (the job's catch-up window would otherwise back-fill the mock's past)
        repeatCursor: t.repeat ? w.anchor.today : null,
        proposal: t.proposal ? { start: w.anchor.wall(t.proposal.start), due: w.anchor.wall(t.proposal.due), reason: t.proposal.reason, by: w.userOfName(t.proposal.by), at: w.anchor.wall(t.proposal.at) } : null,
        overduePlan: t.overdue ? { ...t.overdue, revisedDue: w.anchor.wall(t.overdue.revisedDue) } : null,
        submittedAt: t.submittedAt ? w.anchor.instant(t.submittedAt) : null, completedAt: t.completedAt ? w.anchor.instant(t.completedAt) : null,
        archivedAt: archived ? w.anchor.instant(t.archivedAt!) : null, archivedBy: archived ? w.userOfName(t.archivedBy ?? "") : null, archiveBatchId: archived ? detId(w.tenantId, "archive", t.ref) : null,
        createdAt: w.anchor.instant(t.timeline[0]?.at ?? t.start), updatedAt: w.anchor.instant(t.timeline[t.timeline.length - 1]?.at ?? t.start),
      })
    const primary = w.userOfMock(t.assignee)
    const others = [...new Set((t.assignees ?? []).map(w.userOfMock))].filter((u) => u !== primary)
    await tx.insert(taskAssignees).values([{ tenantId: w.tenantId, taskId: id, userId: primary, isPrimary: true }, ...others.map((userId) => ({ tenantId: w.tenantId, taskId: id, userId, isPrimary: false }))])

    for (const [i, c] of (t.checklist ?? []).entries()) {
      await tx.insert(taskChecklistItems).values({ id: detId(w.tenantId, "check", t.ref, c.id), tenantId: w.tenantId, taskId: id, text: c.text, done: c.done, position: i, doneBy: c.done ? primary : null, doneAt: c.done ? w.anchor.instant(t.timeline[t.timeline.length - 1]?.at ?? t.start) : null })
    }
    for (const [i, n] of t.notes.entries()) {
      await tx.insert(taskComments).values({ id: detId(w.tenantId, "comment", t.ref, String(i)), tenantId: w.tenantId, taskId: id, authorId: w.userOfName(n.by), body: n.text, createdAt: w.anchor.instant(n.at) })
    }
    for (const h of t.timeline) {
      await writeHistory(tx, { tenantId: w.tenantId, actorId: w.userOfName(h.by), now: w.anchor.instant(h.at) }, id, { kind: kindOf(h.text), text: h.text })
    }
    for (const e of t.evidence) evidenceFiles += await seedEvidence(tx, w, t, id, e, w.userOfMock(t.creator))
  }
  // second pass: parents and dependencies point at tasks that now all exist
  for (const t of mock) {
    const id = ids.get(t.ref)!
    if (t.parentRef) await tx.update(tasks).set({ parentId: ids.get(t.parentRef)! }).where(and(eq(tasks.tenantId, w.tenantId), eq(tasks.id, id)))
    for (const d of t.dependsOn ?? []) await tx.insert(taskDependencies).values({ tenantId: w.tenantId, taskId: id, dependsOnId: ids.get(d)! })
  }
  // the counter: the next created task is TSK-<max+1>
  const next = Math.max(1000, ...mock.map((t) => refNo(t.ref))) + 1
  await tx.insert(taskCounters).values({ tenantId: w.tenantId, nextNo: next }).onConflictDoUpdate({ target: taskCounters.tenantId, set: { nextNo: next } })
  // events LAST (publish takes the relay-hint lock): the search indexer reads each task's final row
  for (const t of mock) {
    const row = (await tx.select({ projectId: tasks.projectId, parentId: tasks.parentId }).from(tasks).where(and(eq(tasks.tenantId, w.tenantId), eq(tasks.id, ids.get(t.ref)!))))[0]
    await publishTaskEvent(tx, { tenantId: w.tenantId, actorId: w.actorId, now: w.now }, { type: "task.created", payload: { taskId: ids.get(t.ref)!, parentId: row.parentId, projectId: row.projectId, seriesId: null } })
  }
  return { ids, evidenceFiles }
}

async function seedEvidence(tx: TenantTx, w: TaskWorld, t: MockTask, taskId: string, e: MockEvidence, reviewer: string): Promise<number> {
  const at = w.anchor.instant(e.at)
  const by = w.userOfName(e.by)
  const evId = detId(w.tenantId, "evidence", e.id)
  let fileId: string | null = null
  if (FILE_KINDS.has(e.kind)) {
    // Metadata only: the seed never writes to object storage (no R2, no MinIO), so the bytes do not exist and a download of a seeded file fails. The row is a clean,
    // scanned file of the task so counts, names, review states and the gallery render; the key follows the CHECK (`t/<tenant>/<id>`).
    fileId = detId(w.tenantId, "file", e.id)
    await tx.insert(files).values({
      id: fileId, tenantId: w.tenantId, ownerUserId: by, purpose: "task_evidence", key: `t/${w.tenantId}/${fileId}`, name: e.name, mime: MIME[e.kind] ?? "application/octet-stream",
      sizeBytes: 120_000, status: "clean", createdAt: at, uploadedAt: at, scannedAt: at,
    })
    await tx.insert(taskFiles).values({ fileId, tenantId: w.tenantId, taskId, purpose: "task_evidence", createdBy: by, createdAt: at })
  }
  const reviewed = e.review === "accepted" || e.review === "rejected"
  await tx.insert(taskEvidence).values({
    id: evId, tenantId: w.tenantId, taskId, round: e.round ?? 1, kind: e.kind, fileId,
    text: e.kind === "note" || e.kind === "checklist" ? e.name : null, url: e.kind === "drive" ? e.name : null,
    source: e.source === "camera" || e.source === "upload" ? e.source : null, capturedAt: e.source === "camera" ? at : null,
    review: e.review, reason: e.reason ?? null, reviewedBy: reviewed ? reviewer : null, reviewedAt: reviewed ? at : null, createdBy: by, createdAt: at, lockedAt: e.locked ? at : null,
  })
  return fileId ? 1 : 0
}

