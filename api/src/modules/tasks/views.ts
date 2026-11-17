import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { can } from "@opsdesk/domain/permissions"
import { addDays, wallToEpoch } from "@opsdesk/domain/shifts"
import { STATUS_ORDER } from "@opsdesk/domain/task-model"
import { archiveDaysLeft } from "@opsdesk/domain/task-planning"
import { AppError, Forbidden } from "../../core/errors"
import { tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { archiveExpired } from "./archive"
import { decodeCursor, encodeCursor } from "./cursor"
import { ListQuery, Status, type ListQueryInput } from "./dto"
import { assigneesOf } from "./repo"
import { taskScopeWhere, type TaskCtx, type TaskRow } from "./scope"
import { buildListQuery, listConditions } from "./service"
import { wallOf } from "./time"

// Board, calendar and archive list (FR-M1-04/05/13). All three apply the caller's task scope (ruling D5) and leave archived tasks out, except the archive
// list, which shows only them. Every statement is built by an exported function so the EXPLAIN test can plan exactly what runs.

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
const UTC_EX = "2026-11-20T17:00:00.000Z"

const CARD_EX = {
  id: TID, ref: "TSK-1001", version: 1, title: "Check fire exits", status: "not_started" as const, priority: 2, dept: "Cleaning", teamId: null, assignee: UID, assignees: [] as string[], creator: UID,
  start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", startAt: "2026-11-20T09:00:00.000Z", dueAt: UTC_EX, tags: ["safety"], parentId: null,
}

/** A task as a card on a board, calendar or archive list: what the cell shows, no timeline, checklist or evidence. */
export const TaskCardSchema = z
  .object({
    id: z.uuid(), ref: z.string(), version: z.number().int(), title: z.string(), status: Status, priority: z.number().int().min(1).max(3),
    dept: z.string(), teamId: z.string().nullable(), assignee: z.string(), assignees: z.array(z.string()), creator: z.string(),
    start: z.string(), due: z.string(), startAt: z.string(), dueAt: z.string(), tags: z.array(z.string()), projectId: z.string().optional(), parentId: z.string().nullable(),
  })
  .openapi({ example: CARD_EX })
export type TaskCard = z.infer<typeof TaskCardSchema>

/** Rows → cards with ONE query per kind of side data (assignees, teams). Drive links in the title are withheld per request (ruling D22). */
export async function taskCards(tx: TenantTx, ctx: TaskCtx, rows: TaskRow[]): Promise<TaskCard[]> {
  const people = await assigneesOf(tx, ctx.tenantId, rows.map((r) => r.id))
  const teamIds = [...new Set(rows.flatMap((r) => (r.teamId ? [r.teamId] : [])))]
  const teamRows = teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, teamIds))) : []
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))
  return rows.map((r) => {
    const p = people.get(r.id)!
    return {
      id: r.id, ref: `TSK-${r.refNo}`, version: r.version, title: ctx.drive ? r.title : withholdDriveText(r.title), status: r.status as TaskCard["status"], priority: r.priority,
      dept: r.teamId ? (teamName.get(r.teamId) ?? "") : "", teamId: r.teamId, assignee: p.primary ?? "", assignees: p.others, creator: r.creatorId ?? "",
      start: wallOf(r.startAt, ctx.tz), due: wallOf(r.dueAt, ctx.tz), startAt: r.startAt.toISOString(), dueAt: r.dueAt.toISOString(), tags: r.labels,
      ...(r.projectId ? { projectId: r.projectId } : {}), parentId: r.parentId,
    }
  })
}

// ---------- board ----------

export const BOARD_PAGE = 50
/** The list filters, minus the status filter (the column is the status) and paging (the board pages per column). */
export const BoardQuery = ListQuery.omit({ status: true, limit: true, cursor: true }).extend({
  column: Status.optional().openapi({ description: "Page ONE column: with `cursor` (that column's nextCursor)" }),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(BOARD_PAGE).default(BOARD_PAGE),
})
export type BoardInput = z.infer<typeof BoardQuery>
type Filters = Partial<Omit<ListQueryInput, "status" | "limit" | "cursor">>

export const BoardColumn = z.object({ status: Status, count: z.number().int(), items: z.array(TaskCardSchema), nextCursor: z.string().nullable() })
export const BoardSchema = z
  .object({ columns: z.array(BoardColumn) })
  .openapi({ example: { columns: [{ status: "not_started", count: 1, items: [CARD_EX], nextCursor: null }] } })

/** One column's page: the list query with `status = column` (tasks_live_status_due_idx), soonest due first, cursor on (due_at, id). */
export const boardItemsQuery = (tx: TenantTx, ctx: TaskCtx, f: Filters, status: z.infer<typeof Status>, take: number, after?: { at: Date; id: string }) =>
  buildListQuery(tx, ctx, { ...f, status, after }, take)

/** Counts per status over the same filters and scope (one grouped statement). */
export const boardCountsQuery = (tx: TenantTx, ctx: TaskCtx, f: Filters) =>
  tx
    .select({ status: tasks.status, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(...listConditions(ctx, { ...f, status: undefined })))
    .groupBy(tasks.status)

export async function boardView(tx: TenantTx, ctx: TaskCtx, q: BoardInput): Promise<z.infer<typeof BoardSchema>> {
  if (q.cursor && !q.column) throw new AppError(400, "invalid_cursor", "Bad Request") // a cursor belongs to one column
  const after = q.cursor ? decodeCursor(q.cursor) : undefined
  const limit = q.limit
  const filters: Filters = { due: q.due, priority: q.priority, assignee: q.assignee, project: q.project, repeat: q.repeat, q: q.q, ref: q.ref, label: q.label }
  const counts = new Map((await boardCountsQuery(tx, ctx, filters)).map((r) => [r.status, r.n]))
  const statuses: z.infer<typeof Status>[] = q.column ? [q.column] : STATUS_ORDER
  const pages = new Map<string, TaskRow[]>()
  for (const status of statuses) pages.set(status, await boardItemsQuery(tx, ctx, filters, status, limit + 1, status === q.column ? after : undefined))
  const shown = [...pages.values()].flatMap((rows) => rows.slice(0, limit))
  const cards = new Map((await taskCards(tx, ctx, shown)).map((c) => [c.id, c]))
  return {
    columns: statuses.map((status) => {
      const rows = pages.get(status)!
      const page = rows.slice(0, limit)
      const last = page[page.length - 1]
      return { status, count: counts.get(status) ?? 0, items: page.map((r) => cards.get(r.id)!), nextCursor: rows.length > limit && last ? encodeCursor(last.dueAt, last.id) : null }
    }),
  }
}

// ---------- calendar ----------

export const CALENDAR_MAX_DAYS = 42
/** One response never carries more than this many cards (the calendar is a month view; `truncated` says there were more). */
export const CALENDAR_CAP = 1000
export const CalendarQuery = z.object({
  from: z.string().max(10).optional().openapi({ description: "First tenant-local day, YYYY-MM-DD", example: "2026-11-16" }),
  to: z.string().max(10).optional().openapi({ description: "Last tenant-local day, inclusive; at most 42 days from `from`", example: "2026-11-29" }),
})
export const CalendarSchema = z
  .object({ days: z.array(z.object({ date: z.string(), tasks: z.array(TaskCardSchema) })), truncated: z.boolean() })
  .openapi({ example: { days: [{ date: "2026-11-20", tasks: [] }], truncated: false } })

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const realDay = (d: string | undefined): d is string => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = new Date(`${d}T00:00:00Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d)
}

/** Tasks due in [lo, hi) (UTC instants made from tenant-local midnights, so a DST day is 23 or 25 hours long): tasks_live_due_idx. */
export const calendarQuery = (tx: TenantTx, ctx: TaskCtx, lo: Date, hi: Date, take: number) =>
  tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports), sql`${tasks.dueAt} >= ${lo.toISOString()}::timestamptz`, sql`${tasks.dueAt} < ${hi.toISOString()}::timestamptz`))
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(take)

export async function calendarView(tx: TenantTx, ctx: TaskCtx, q: z.infer<typeof CalendarQuery>): Promise<{ days: { date: string; tasks: TaskCard[] }[]; truncated: boolean }> {
  if (!realDay(q.from) || !realDay(q.to) || q.to < q.from) throw unprocessable("invalid_range")
  const dates: string[] = []
  for (let d = q.from; d <= q.to && dates.length <= CALENDAR_MAX_DAYS; d = addDays(d, 1)) dates.push(d)
  if (dates.length > CALENDAR_MAX_DAYS) throw unprocessable("invalid_range")
  const lo = new Date(wallToEpoch(`${q.from}T00:00:00`, ctx.tz))
  const hi = new Date(wallToEpoch(`${addDays(q.to, 1)}T00:00:00`, ctx.tz))
  const rows = await calendarQuery(tx, ctx, lo, hi, CALENDAR_CAP + 1)
  const page = rows.slice(0, CALENDAR_CAP)
  const byDay = new Map<string, TaskCard[]>(dates.map((d) => [d, []]))
  for (const card of await taskCards(tx, ctx, page)) byDay.get(card.due.slice(0, 10))?.push(card) // the tenant-local day of the due instant
  return { days: dates.map((date) => ({ date, tasks: byDay.get(date)! })), truncated: rows.length > CALENDAR_CAP }
}

// ---------- archive list ----------

export const ArchiveListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() })
export const ArchivedCardSchema = TaskCardSchema.extend({
  archivedAt: z.string(), archivedAtUtc: z.string(), archivedBy: z.string().nullable(), daysLeft: z.number().int().min(0).max(30),
}).openapi({
  example: { ...CARD_EX, archivedAt: "2026-11-18T09:00:00", archivedAtUtc: "2026-11-18T09:00:00.000Z", archivedBy: UID, daysLeft: 27 },
})
export const ArchiveListSchema = z.object({ items: z.array(ArchivedCardSchema), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })

/** Archived tasks in the caller's scope, newest archive first, cursor on (archived_at desc, id desc): tasks_archived_idx, scanned backwards. */
export const archiveQuery = (tx: TenantTx, ctx: TaskCtx, after: { at: Date; id: string } | undefined, take: number) =>
  tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), sql`${tasks.archivedAt} is not null`, taskScopeWhere(ctx.scope, ctx.reports), after ? sql`(${tasks.archivedAt}, ${tasks.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)` : undefined))
    .orderBy(desc(tasks.archivedAt), desc(tasks.id))
    .limit(take)

export async function archiveListView(tx: TenantTx, ctx: TaskCtx, q: z.infer<typeof ArchiveListQuery>): Promise<{ items: z.infer<typeof ArchivedCardSchema>[]; nextCursor: string | null }> {
  // Only managers see (and restore from) the archive (ruling D6): a plain member has no business with other people's removed tasks.
  if (ctx.role.home !== "manager" || !can(ctx.role, "tasks", "write")) throw Forbidden("forbidden")
  const after = q.cursor ? decodeCursor(q.cursor) : undefined
  const rows = await archiveQuery(tx, ctx, after, q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  const cards = await taskCards(tx, ctx, page)
  const today = wallOf(ctx.now, ctx.tz)
  return {
    items: page.map((r, i) => ({
      ...cards[i], archivedAt: wallOf(r.archivedAt!, ctx.tz), archivedAtUtc: r.archivedAt!.toISOString(), archivedBy: r.archivedBy,
      daysLeft: archiveExpired(r.archivedAt!, ctx.now) ? 0 : archiveDaysLeft(wallOf(r.archivedAt!, ctx.tz), today),
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.archivedAt!, last.id) : null,
  }
}
