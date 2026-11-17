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
    changes: z.array(FieldChangeSchema), notified: z.array(z.string()), updateId: z.string().optional(),
  })
  .openapi({ example: { id: TID, at: WALL_EX, atUtc: UTC_EX, actorId: UID, by: "Ann Byrne", kind: "updated", text: "Updated Due", changes: [{ field: "Due", from: "20 Nov 17:00", to: "21 Nov 17:00" }], notified: [] } })

/** A task as the API returns it (ruling D2/D3/D4): the FE Task contract (features/tasks/types.ts) plus ids, version and UTC instants. Absent optional values are omitted. */
export const TaskDtoSchema = z
  .object({
    id: z.uuid(), ref: z.string(), version: z.number().int(), title: z.string(), description: z.string(),
    dept: z.string(), teamId: z.string().nullable(),
    assignee: z.string(), assignees: z.array(z.string()), creator: z.string(), priority: z.number().int().min(1).max(3),
    start: z.string(), due: z.string(), startAt: z.string(), dueAt: z.string(),
    status: Status, evidenceRule: EvidenceRuleSchema, client: z.string().optional(), tags: z.array(z.string()), estimate: z.number().int().optional(),
    projectId: z.string().optional(), milestoneId: z.string().optional(), parentRef: z.string().optional(), parentId: z.string().nullable(),
    checklist: z.array(z.unknown()), subtasks: z.array(z.unknown()), dependsOn: z.array(z.string()), dependsOnIds: z.array(z.string()),
    archivedAt: z.string().optional(), archivedBy: z.string().optional(), proposal: z.record(z.string(), z.unknown()).optional(), round: z.number().int(),
    repeat: z.record(z.string(), z.unknown()).optional(), seriesId: z.string().optional(), submittedAt: z.string().optional(), completedAt: z.string().optional(),
    notes: z.array(z.unknown()), evidence: z.array(z.unknown()), timeline: z.array(HistoryItem),
    overdue: z.object({ reason: z.string(), nextAction: z.string(), owner: z.string(), revisedDue: z.string() }).optional(),
    timeEntries: z.array(z.unknown()), evidenceState: z.string().nullable(), voiceNote: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi({
    example: {
      id: TID, ref: "TSK-1001", version: 1, title: "Check fire exits", description: "Walk every floor.", dept: "Cleaning", teamId: null,
      assignee: UID, assignees: [], creator: UID, priority: 2, start: "2026-11-20T09:00:00", due: WALL_EX, startAt: "2026-11-20T09:00:00.000Z", dueAt: UTC_EX,
      status: "not_started", evidenceRule: { mode: "none", types: [], min: 0, instruction: "", review: "manager" }, tags: ["safety"], parentId: null,
      checklist: [], subtasks: [], dependsOn: [], dependsOnIds: [], round: 1, notes: [], evidence: [], timeline: [], timeEntries: [], evidenceState: null, voiceNote: null,
    },
  })
export type TaskDto = z.infer<typeof TaskDtoSchema>

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
  const parentRows = parentIds.length ? await tx.select({ id: tasks.id, refNo: tasks.refNo }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, parentIds))) : []
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
  const children = new Map<string, { id: string; ref: string; title: string; status: string }[]>()
  for (const c of childRows) children.set(c.parentId!, [...(children.get(c.parentId!) ?? []), { id: c.id, ref: ref(c.refNo), title: free(c.title), status: c.status }])
  // Dependencies the caller may see (their scope applies to the tasks they point at, so no ref of an unseen task leaks), live ones only.
  const depRows = ids.length
    ? await tx
        .select({ taskId: taskDependencies.taskId, id: tasks.id, refNo: tasks.refNo })
        .from(taskDependencies)
        .innerJoin(tasks, and(eq(tasks.tenantId, taskDependencies.tenantId), eq(tasks.id, taskDependencies.dependsOnId)))
        .where(and(eq(taskDependencies.tenantId, ctx.tenantId), inArray(taskDependencies.taskId, ids), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
        .orderBy(asc(tasks.refNo))
    : []
  const deps = new Map<string, { id: string; ref: string }[]>()
  for (const d of depRows) deps.set(d.taskId, [...(deps.get(d.taskId) ?? []), { id: d.id, ref: ref(d.refNo) }])
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
      ...(r.parentId ? { parentRef: parentRef.get(r.parentId) ?? "" } : {}), parentId: r.parentId,
      checklist: checklists.get(r.id) ?? [], subtasks: children.get(r.id) ?? [], dependsOn: (deps.get(r.id) ?? []).map((d) => d.ref), dependsOnIds: (deps.get(r.id) ?? []).map((d) => d.id), round: r.round,
      ...(r.archivedAt ? { archivedAt: wallOf(r.archivedAt, ctx.tz) } : {}), ...(r.archivedBy ? { archivedBy: r.archivedBy } : {}),
      ...(r.proposal ? { proposal: ctx.drive ? r.proposal : { ...r.proposal, reason: withholdDriveText(String(r.proposal.reason ?? "")) } } : {}), ...(r.repeat ? { repeat: r.repeat as Record<string, unknown> } : {}), ...(r.seriesId ? { seriesId: r.seriesId } : {}),
      ...(r.submittedAt ? { submittedAt: wallOf(r.submittedAt, ctx.tz) } : {}), ...(r.completedAt ? { completedAt: wallOf(r.completedAt, ctx.tz) } : {}),
      notes: [], evidence: items.map((e) => evidenceDto.get(e.id)!), timeline, ...(r.overduePlan ? { overdue: r.overduePlan } : {}), timeEntries: [],
      evidenceState: evidenceState(r.evidenceRule, stateItems(items), r.status), voiceNote: null,
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
        freq: z.string().min(1).max(20).openapi({ description: "daily | weekdays | weekly | monthly (per_shift is not available yet: 422 unsupported_repeat)", example: "weekly" }),
        days: z.array(z.number().int()).max(14).optional().openapi({ description: "Weekly: weekdays 0 = Sunday … 6 = Saturday" }),
        dayOfMonth: z.number().int().optional().openapi({ description: "Monthly: 1–31; a short month uses its last day" }),
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
