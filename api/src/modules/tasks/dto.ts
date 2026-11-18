import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import { evidenceState } from "@opsdesk/domain/task-evidence"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { TASK_STATUSES, taskChecklistItems, taskDependencies, tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { evidenceDtos, EVIDENCE_FILTERS, loadEvidence, stateItems } from "./evidence"
import { assigneesOf } from "./repo"
import type { HistoryDto } from "./history"
import { taskScopeWhere, type TaskCtx, type TaskRow } from "./scope"
import { wallOf } from "./time"

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
const WALL_EX = "2026-11-20T17:00:00"
const UTC_EX = "2026-11-20T17:00:00.000Z"

/**
 * The voice note as the task DTO shows it (ruling D21): metadata only. The file id, the file name and the play log never appear here: playing goes through
 * GET /voice-note (logged), and the log is read through GET /voice-note/plays by the managers of the task.
 */
export const voiceNoteOf = (r: Pick<TaskRow, "voiceFileId" | "voiceMeta">): { durationSec: number; mime: string; recordedBy: string; recordedAt: string } | null => {
  const m = r.voiceMeta as { durationSec?: number; mime?: string; recordedBy?: string; recordedAt?: string } | null
  return r.voiceFileId && m ? { durationSec: Number(m.durationSec), mime: String(m.mime), recordedBy: String(m.recordedBy), recordedAt: String(m.recordedAt) } : null
}

export const Status = z.enum(TASK_STATUSES)
export const EvidenceRuleSchema = z
  .object({
    mode: z.enum(["none", "optional", "required"]),
    types: z.array(z.enum(["photo", "image", "pdf", "office", "video", "checklist", "signature", "note", "drive"])).max(9),
    min: z.number().int().min(0).max(20),
    instruction: z.string().max(200),
    review: z.enum(["auto", "creator", "manager", "named"]),
    reviewer: z.string().max(128).optional(),
  })
  .openapi({ example: { mode: "none", types: [], min: 0, instruction: "", review: "manager" } })

const FieldChangeSchema = z.object({ field: z.string(), from: z.string(), to: z.string() })
export const HistoryItem = z
  .object({
    id: z.string(), at: z.string(), atUtc: z.string(), actorId: z.string().nullable(), by: z.string(), kind: z.string(), text: z.string(),
    changes: z.array(FieldChangeSchema), notified: z.array(z.string()), hiddenNotified: z.number().int(), hiddenDependencies: z.number().int(), updateId: z.string().optional(),
  })
  .openapi({ example: { id: TID, at: WALL_EX, atUtc: UTC_EX, actorId: UID, by: "Ann Byrne", kind: "updated", text: "Updated Due", changes: [{ field: "Due", from: "20 Nov 17:00", to: "21 Nov 17:00" }], notified: [], hiddenNotified: 0, hiddenDependencies: 0 } })

const ChecklistItemDto = z.object({ id: z.string(), text: z.string(), done: z.boolean() }).openapi({ example: { id: TID, text: "Ground floor", done: true } })
const SubtaskDto = z.object({ id: z.string(), ref: z.string(), title: z.string(), status: Status }).openapi({ example: { id: TID, ref: "TSK-1002", title: "Stairwell", status: "not_started" } })
const DepDto = z.object({ id: z.string(), ref: z.string(), title: z.string(), status: Status }).openapi({ example: { id: TID, ref: "TSK-1000", title: "Paint the hall", status: "in_progress" } })
const NoteDto = z
  .object({ at: z.string(), by: z.string(), text: z.string(), changes: z.array(FieldChangeSchema).optional(), notified: z.array(z.string()).optional(), updateId: z.string().optional() })
  .openapi({ example: { at: WALL_EX, by: "Ann Byrne", text: "Called the landlord" } })
const EvidenceItemDto = z
  .object({
    id: z.string(), kind: z.string(), name: z.string(), by: z.string(), at: z.string(), review: z.enum(["pending", "accepted", "rejected"]), reason: z.string().optional(), round: z.number().int(), locked: z.boolean(),
    source: z.string().optional(), capturedAt: z.string().optional(), url: z.string().optional(), size: z.number().optional(), fileId: z.string().optional(),
    fileStatus: z.enum(["pending", "clean", "infected", "deleted"]).optional(), reviewedBy: z.string().optional(), reviewedAt: z.string().optional(),
  })
  .openapi({ example: { id: TID, kind: "photo", name: "exit.jpg", by: "Ann Byrne", at: WALL_EX, review: "pending", round: 1, locked: false, fileId: TID, fileStatus: "clean", size: 1200 } })
const TimeEntryDto = z
  .object({ id: z.string(), at: z.string(), by: z.string(), minutes: z.number(), note: z.string(), source: z.string() })
  .openapi({ example: { id: TID, at: WALL_EX, by: "Ann Byrne", minutes: 30, note: "Walked it", source: "shift_report" } })
const ProposalDto = z
  .object({ start: z.string(), due: z.string(), reason: z.string(), by: z.string(), at: z.string() })
  .openapi({ example: { start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00", reason: "Waiting on keys", by: "Ann Byrne", at: WALL_EX } })
const RepeatRuleDto = z
  .object({ freq: z.enum(["daily", "weekdays", "weekly", "monthly", "per_shift"]), patternId: z.string().optional(), days: z.array(z.number().int()).optional(), dayOfMonth: z.number().int().optional(), until: z.string().optional() })
  .openapi({ example: { freq: "weekly", days: [1, 3], until: "2026-12-31" } })
const VoiceNoteDto = z
  .object({ durationSec: z.number(), mime: z.string(), recordedBy: z.string(), recordedAt: z.string() })
  .openapi({ example: { durationSec: 12, mime: "audio/webm", recordedBy: UID, recordedAt: UTC_EX } })

/** A task as the API returns it (ruling D2/D3/D4): the FE Task contract (features/tasks/types.ts) plus ids, version and UTC instants. Absent optional values are omitted. */
export const TaskDtoSchema = z
  .object({
    id: z.uuid(), ref: z.string(), version: z.number().int(), title: z.string(), description: z.string(),
    dept: z.string(), teamId: z.string().nullable(),
    assignee: z.string(), assignees: z.array(z.string()), creator: z.string(), priority: z.number().int().min(1).max(3),
    start: z.string(), due: z.string(), startAt: z.string(), dueAt: z.string(),
    status: Status, evidenceRule: EvidenceRuleSchema, client: z.string().optional(), tags: z.array(z.string()), estimate: z.number().int().optional(),
    projectId: z.string().optional(), milestoneId: z.string().optional(), parentRef: z.string().optional(), parentId: z.string().nullable(),
    checklist: z.array(ChecklistItemDto), subtasks: z.array(SubtaskDto), dependsOn: z.array(z.string()), dependsOnIds: z.array(z.string()),
    dependencies: z.array(DepDto), hiddenDependencies: z.number().int(), blocks: z.array(DepDto), hiddenBlocks: z.number().int(),
    archivedAt: z.string().optional(), archivedBy: z.string().optional(), proposal: ProposalDto.optional(), round: z.number().int(),
    repeat: RepeatRuleDto.optional(), seriesId: z.string().optional(), submittedAt: z.string().optional(), completedAt: z.string().optional(),
    notes: z.array(NoteDto), evidence: z.array(EvidenceItemDto), timeline: z.array(HistoryItem),
    overdue: z.object({ reason: z.string(), nextAction: z.string(), owner: z.string(), revisedDue: z.string() }).optional(),
    timeEntries: z.array(TimeEntryDto), evidenceState: z.string().nullable(), voiceNote: VoiceNoteDto.nullable(),
  })
  .openapi({
    example: {
      id: TID, ref: "TSK-1001", version: 1, title: "Check fire exits", description: "Walk every floor.", dept: "Cleaning", teamId: null,
      assignee: UID, assignees: [], creator: UID, priority: 2, start: "2026-11-20T09:00:00", due: WALL_EX, startAt: "2026-11-20T09:00:00.000Z", dueAt: UTC_EX,
      status: "not_started", evidenceRule: { mode: "none", types: [], min: 0, instruction: "", review: "manager" }, tags: ["safety"], parentId: null,
      checklist: [], subtasks: [], dependsOn: [], dependsOnIds: [], dependencies: [], hiddenDependencies: 0, blocks: [], hiddenBlocks: 0, round: 1, notes: [], evidence: [], timeline: [], timeEntries: [], evidenceState: null, voiceNote: null,
    },
  })
export type TaskDto = z.infer<typeof TaskDtoSchema>
type DateProposalDto = z.infer<typeof ProposalDto>

export const TaskList = z.object({ items: z.array(TaskDtoSchema), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })

const ref = (n: number) => `TSK-${n}`

/**
 * Rows → DTOs with ONE query per kind of side data (assignees, teams), never one per row. Drive links in the description are withheld
 * per request when the device policy says so (ruling D22). The timeline is attached by the caller (detail only).
 */
export async function taskDtos(tx: TenantTx, ctx: TaskCtx, rows: TaskRow[], timelines: Map<string, HistoryDto[]> = new Map()): Promise<TaskDto[]> {
  const people = await assigneesOf(tx, ctx.tenantId, rows.map((r) => r.id))
  const teamIds = [...new Set(rows.flatMap((r) => (r.teamId ? [r.teamId] : [])))]
  const teamRows = teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, teamIds))) : []
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))
  const parentIds = [...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))]
  const parentRows = parentIds.length ? await tx.select({ id: tasks.id, refNo: tasks.refNo }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, parentIds), taskScopeWhere(ctx.scope, ctx.reports))) : []
  const parentRef = new Map(parentRows.map((p) => [p.id, ref(p.refNo)]))
  const ids = rows.map((r) => r.id)
  const free = (v: string) => (ctx.drive ? v : withholdDriveText(v))
  const itemRows = ids.length
    ? await tx.select({ id: taskChecklistItems.id, taskId: taskChecklistItems.taskId, text: taskChecklistItems.text, done: taskChecklistItems.done }).from(taskChecklistItems).where(and(eq(taskChecklistItems.tenantId, ctx.tenantId), inArray(taskChecklistItems.taskId, ids))).orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.id))
    : []
  const checklists = new Map<string, { id: string; text: string; done: boolean }[]>()
  for (const i of itemRows) checklists.set(i.taskId, [...(checklists.get(i.taskId) ?? []), { id: i.id, text: free(i.text), done: i.done }])
  // Subtasks the caller may see (their own scope applies to children too), live ones only; tasks_parent_idx.
  const childRows = ids.length
    ? await tx.select({ id: tasks.id, parentId: tasks.parentId, refNo: tasks.refNo, title: tasks.title, status: tasks.status }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.parentId, ids), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports))).orderBy(asc(tasks.refNo))
    : []
  const children = new Map<string, { id: string; ref: string; title: string; status: z.infer<typeof Status> }[]>()
  for (const c of childRows) children.set(c.parentId!, [...(children.get(c.parentId!) ?? []), { id: c.id, ref: ref(c.refNo), title: free(c.title), status: c.status as z.infer<typeof Status> }])
  // Dependencies the caller may see (their scope applies to the tasks they point at, so no ref of an unseen task leaks), live ones only.
  const depRows = ids.length
    ? await tx
        .select({ taskId: taskDependencies.taskId, id: tasks.id, refNo: tasks.refNo, title: tasks.title, status: tasks.status })
        .from(taskDependencies)
        .innerJoin(tasks, and(eq(tasks.tenantId, taskDependencies.tenantId), eq(tasks.id, taskDependencies.dependsOnId)))
        .where(and(eq(taskDependencies.tenantId, ctx.tenantId), inArray(taskDependencies.taskId, ids), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
        .orderBy(asc(tasks.refNo))
    : []
  const deps = new Map<string, { id: string; ref: string; title: string; status: z.infer<typeof Status> }[]>()
  for (const d of depRows) deps.set(d.taskId, [...(deps.get(d.taskId) ?? []), { id: d.id, ref: ref(d.refNo), title: free(d.title), status: d.status as z.infer<typeof Status> }])
  // How many live dependencies the caller may NOT see: a number only, never a ref, title or status (D5, E7). One grouped statement for the page (task_dependencies_pkey).
  const allDeps = ids.length
    ? await tx
        .select({ taskId: taskDependencies.taskId, n: sql<number>`count(*)::int` })
        .from(taskDependencies)
        .innerJoin(tasks, and(eq(tasks.tenantId, taskDependencies.tenantId), eq(tasks.id, taskDependencies.dependsOnId)))
        .where(and(eq(taskDependencies.tenantId, ctx.tenantId), inArray(taskDependencies.taskId, ids), sql`${tasks.archivedAt} is null`))
        .groupBy(taskDependencies.taskId)
    : []
  const allDepCount = new Map(allDeps.map((r) => [r.taskId, r.n]))
  // The reverse edges (tasks waiting on these): the same scope rule, with the visible rows and a count of the rest (task_deps_on_idx).
  const blockRows = ids.length
    ? await tx
        .select({ onId: taskDependencies.dependsOnId, id: tasks.id, refNo: tasks.refNo, title: tasks.title, status: tasks.status, visible: sql<boolean>`${taskScopeWhere(ctx.scope, ctx.reports)}` })
        .from(taskDependencies)
        .innerJoin(tasks, and(eq(tasks.tenantId, taskDependencies.tenantId), eq(tasks.id, taskDependencies.taskId)))
        .where(and(eq(taskDependencies.tenantId, ctx.tenantId), inArray(taskDependencies.dependsOnId, ids), sql`${tasks.archivedAt} is null`))
        .orderBy(asc(tasks.refNo))
    : []
  const blocks = new Map<string, { id: string; ref: string; title: string; status: z.infer<typeof Status> }[]>()
  const hiddenBlocks = new Map<string, number>()
  for (const b of blockRows) {
    if (b.visible) blocks.set(b.onId, [...(blocks.get(b.onId) ?? []), { id: b.id, ref: ref(b.refNo), title: free(b.title), status: b.status as z.infer<typeof Status> }])
    else hiddenBlocks.set(b.onId, (hiddenBlocks.get(b.onId) ?? 0) + 1)
  }
  // Evidence of the whole page in ONE query (and one names lookup); items that are still scanning, infected or deleted do not count toward the state (ruling D10).
  const evidenceBy = await loadEvidence(tx, ctx.tenantId, ids)
  const evidenceDto = new Map((await evidenceDtos(tx, ctx, [...evidenceBy.values()].flat())).map((d) => [d.id, d]))
  return rows.map((r) => {
    const p = people.get(r.id)!
    const items = evidenceBy.get(r.id) ?? []
    const timeline = timelines.get(r.id) ?? []
    return {
      id: r.id, ref: ref(r.refNo), version: r.version, title: ctx.drive ? r.title : withholdDriveText(r.title),
      description: ctx.drive ? r.description : withholdDriveText(r.description),
      dept: r.teamId ? (teamName.get(r.teamId) ?? "") : "", teamId: r.teamId,
      assignee: p.primary ?? "", assignees: p.others, creator: r.creatorId ?? "", priority: r.priority,
      start: wallOf(r.startAt, ctx.tz), due: wallOf(r.dueAt, ctx.tz), startAt: r.startAt.toISOString(), dueAt: r.dueAt.toISOString(),
      status: r.status as TaskDto["status"], evidenceRule: r.evidenceRule, tags: r.labels,
      ...(r.client ? { client: r.client } : {}), ...(r.estimateMin ? { estimate: r.estimateMin } : {}),
      ...(r.projectId ? { projectId: r.projectId } : {}), ...(r.milestoneId ? { milestoneId: r.milestoneId } : {}),
      ...(r.parentId && parentRef.has(r.parentId) ? { parentRef: parentRef.get(r.parentId)! } : {}), parentId: r.parentId && parentRef.has(r.parentId) ? r.parentId : null, // a parent outside the caller's scope is dropped (no ref or id leaks)
      checklist: checklists.get(r.id) ?? [], subtasks: children.get(r.id) ?? [], dependsOn: (deps.get(r.id) ?? []).map((d) => d.ref), dependsOnIds: (deps.get(r.id) ?? []).map((d) => d.id), round: r.round,
      dependencies: deps.get(r.id) ?? [], hiddenDependencies: (allDepCount.get(r.id) ?? 0) - (deps.get(r.id) ?? []).length, blocks: blocks.get(r.id) ?? [], hiddenBlocks: hiddenBlocks.get(r.id) ?? 0,
      ...(r.archivedAt ? { archivedAt: wallOf(r.archivedAt, ctx.tz) } : {}), ...(r.archivedBy ? { archivedBy: r.archivedBy } : {}),
      ...(r.proposal ? { proposal: (ctx.drive ? r.proposal : { ...r.proposal, reason: withholdDriveText(String(r.proposal.reason ?? "")) }) as DateProposalDto } : {}), ...(r.repeat ? { repeat: r.repeat } : {}), ...(r.seriesId ? { seriesId: r.seriesId } : {}),
      ...(r.submittedAt ? { submittedAt: wallOf(r.submittedAt, ctx.tz) } : {}), ...(r.completedAt ? { completedAt: wallOf(r.completedAt, ctx.tz) } : {}),
      notes: [], evidence: items.map((e) => evidenceDto.get(e.id)!), timeline, ...(r.overduePlan ? { overdue: r.overduePlan } : {}), timeEntries: [],
      evidenceState: evidenceState(r.evidenceRule, stateItems(items), r.status), voiceNote: voiceNoteOf(r),
    }
  })
}

// ---------- request bodies and query (R5: every JSON body declares an example) ----------

export const Wall = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).openapi({ description: "Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)", example: WALL_EX })
export const Version = z.number().int().min(1).openapi({ description: "The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict", example: 1 })
const UserId = z.string().min(1).max(128)
const OverduePlan = z.object({ reason: z.string().max(500), nextAction: z.string().max(500), owner: z.string().max(200), revisedDue: z.string().max(40) })

export const CreateBody = z
  .object({
    title: z.string().trim().min(1).max(200), description: z.string().max(10_000).default(""), priority: z.number().int().min(1).max(3).default(2),
    start: Wall, due: Wall, primary: UserId.optional(), others: z.array(UserId).max(9).default([]),
    teamId: z.uuid().nullable().optional(), labels: z.array(z.string().max(100)).max(50).default([]), estimateMin: z.number().int().min(1).max(100_000).nullable().optional(),
    client: z.string().trim().min(1).max(120).nullable().optional(), evidenceRule: EvidenceRuleSchema.optional(), overduePlan: OverduePlan.nullable().optional(),
    templateId: z.uuid().optional().openapi({ description: "Only the template's evidence rule is applied here (ruling D23); a body rule wins, then the template's, then the project's default" }),
    projectId: z.uuid().nullable().optional(), milestoneId: z.uuid().nullable().optional(),
  })
  .openapi({ example: { title: "Check fire exits", description: "Walk every floor.", priority: 2, start: "2026-11-20T09:00:00", due: WALL_EX, primary: UID, others: [], labels: ["safety"] } })
export type CreateInput = z.infer<typeof CreateBody>

export const PatchBody = z
  .object({
    version: Version, title: z.string().trim().min(1).max(200).optional(), description: z.string().max(10_000).optional(), priority: z.number().int().min(1).max(3).optional(),
    labels: z.array(z.string().max(100)).max(50).optional(), estimateMin: z.number().int().min(1).max(100_000).nullable().optional(), client: z.string().trim().min(1).max(120).nullable().optional(),
    teamId: z.uuid().nullable().optional(), start: Wall.optional(), due: Wall.optional(), overduePlan: OverduePlan.nullable().optional(),
    projectId: z.uuid().nullable().optional(), milestoneId: z.uuid().nullable().optional(),
  })
  .openapi({ example: { version: 1, due: "2026-11-21T17:00:00" } })
export type PatchInput = z.infer<typeof PatchBody>

export const RepeatBody = z
  .object({
    version: Version,
    rule: z
      .object({
        freq: z.string().min(1).max(20).openapi({ description: "daily | weekdays | weekly | monthly | per_shift (one instance per shift of `patternId` for the primary assignee, start = shift start, due = shift end)", example: "weekly" }),
        days: z.array(z.number().int()).max(14).optional().openapi({ description: "Weekly: weekdays 0 = Sunday … 6 = Saturday" }),
        dayOfMonth: z.number().int().optional().openapi({ description: "Monthly: 1–31; a short month uses its last day" }),
        patternId: z.string().max(64).optional().openapi({ description: "per_shift: the shift pattern (a live pattern of this tenant, else 422 invalid_repeat)" }),
        until: z.string().max(10).optional().openapi({ description: "Last local day (YYYY-MM-DD), inclusive" }),
      })
      .nullable()
      .openapi({ description: "null stops the repetition" }),
  })
  .openapi({ example: { version: 1, rule: { freq: "weekly", days: [1, 3], until: "2026-12-31" } } })

export const AssigneesBody = z.object({ version: Version, primary: UserId, others: z.array(UserId).max(9) }).openapi({ example: { version: 1, primary: UID, others: [] } })
export const StatusBody = z.object({ version: Version, to: Status }).openapi({ example: { version: 1, to: "in_progress" } })
export const CompleteBody = z.object({ version: Version }).openapi({ example: { version: 1 } })

export const DUE_FILTERS = ["all", "today", "overdue", "week"] as const
export const STATUS_FILTERS = ["all", "open", "review", "stuck", ...TASK_STATUSES] as const
export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
  status: z.enum(STATUS_FILTERS).optional(),
  due: z.enum(DUE_FILTERS).optional(),
  priority: z.enum(["1", "2", "3"]).optional(),
  assignee: UserId.optional(),
  project: z.union([z.literal("none"), z.uuid()]).optional(),
  repeat: z.enum(["recurring"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ref: z.string().regex(/^(tsk-)?\d{1,9}$/i).optional(),
  label: z.string().trim().min(1).max(40).optional(),
  evidence: z.enum(EVIDENCE_FILTERS).optional(),
})
export type ListQueryInput = z.infer<typeof ListQuery>
export const HistoryQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() })
export const HistoryList = z.object({ items: z.array(HistoryItem), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })
export const IdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: TID }) })
