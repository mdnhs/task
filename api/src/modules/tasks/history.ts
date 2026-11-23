import { and, desc, eq, inArray, lt, or } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { formatChange, type RawChange } from "@opsdesk/domain/task-history"
import type { FieldChange } from "@opsdesk/domain/task-model"
import { projectMilestones, projects, taskHistory, tasks, teams, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { taskScopeWhere, type TaskCtx } from "./scope"
import { readableProposalText } from "./proposal-text"
import { wallOf } from "./time"

export type HistoryInput = { kind: string; text?: string | null; changes?: RawChange[]; notified?: string[]; updateId?: string | null; causeTaskId?: string | null }
export type HistoryDto = { id: string; at: string; atUtc: string; actorId: string | null; by: string; kind: string; text: string; changes: FieldChange[]; notified: string[]; hiddenNotified: number; hiddenDependencies: number; updateId?: string }
type HistoryRow = typeof taskHistory.$inferSelect

/** Appends one history line (tenant-time instant = ctx.now). The text is device-agnostic, so a Drive link in it is always withheld at write time (ruling E13).  Returns its id. A repeated (task, update_id) is a unique violation: callers check first. */
export async function writeHistory(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "actorId" | "now">, taskId: string, h: HistoryInput): Promise<string> {
  const [row] = await tx
    .insert(taskHistory)
    .values({ tenantId: ctx.tenantId, taskId, at: ctx.now, actorId: ctx.actorId, kind: h.kind, text: h.text == null ? null : withholdDriveText(h.text), changes: h.changes ?? [], notified: h.notified ?? [], updateId: h.updateId ?? null, causeTaskId: h.causeTaskId ?? null })
    .returning({ id: taskHistory.id })
  return row.id
}

/** Lines that name another task (ruling S2): the stored text is neutral; a reader who can see the cause task gets its ref, anyone else the hidden form. `neutral` is what a row without a resolvable cause shows. */
const CAUSE_TEXT: Record<string, { visible: (ref: string) => string; hidden: string; neutral: string }> = {
  rescheduled: { visible: (r) => `Moved because ${r} was rescheduled`, hidden: "Moved because a task you cannot see was rescheduled", neutral: "Moved because another task was rescheduled" },
  archived: { visible: (r) => `Archived with ${r}`, hidden: "Archived with a task you cannot see", neutral: "Archived with another task" },
  restored: { visible: (r) => `Restored with ${r}`, hidden: "Restored with a task you cannot see", neutral: "Restored with another task" },
  created: { visible: (r) => `Created from recurring task ${r}`, hidden: "Created from a recurring task", neutral: "Created from a recurring task" },
}
const DETACHED_NEUTRAL = "The parent task was removed; this is now a task of its own"
// The exact legacy shapes (the ones migration 0040 rewrites); free text that merely mentions a ref is user text and renders as stored.
const LEGACY_CAUSE = /^(?:Moved because|Archived with|Restored with|Created from recurring task) TSK-\d+(?: was rescheduled)?$/
const LEGACY_DETACHED = /^TSK-\d+ was removed; this is now a task of its own$/

const FORMER = "Former member"
/** Display names NOW (never snapshotted): an erased or unknown person is "Former member"; keys and the system have fixed labels. */
export async function namesOf(tx: TenantTx, ids: string[]): Promise<(id: string) => string> {
  const real = [...new Set(ids)].filter((i) => !i.startsWith("apikey:") && !i.startsWith("system:"))
  const rows = real.length ? await tx.select({ id: user.id, name: user.name, erasedAt: user.erasedAt }).from(user).where(inArray(user.id, real)) : []
  const byId = new Map(rows.map((r) => [r.id, r.erasedAt ? FORMER : r.name]))
  return (id) => (id.startsWith("apikey:") ? "API key" : id.startsWith("system:") ? "System" : (byId.get(id) ?? FORMER))
}

/** Ids a set of raw changes refers to: people (assignees) and teams. */
function referenced(rows: HistoryRow[]): { users: string[]; teamIds: string[]; projectIds: string[]; milestoneIds: string[] } {
  const users = new Set<string>()
  const teamIds = new Set<string>()
  const projectIds = new Set<string>()
  const milestoneIds = new Set<string>()
  for (const r of rows) {
    if (r.actorId) users.add(r.actorId)
    for (const n of r.notified) users.add(n)
    for (const c of r.changes) {
      if (c.field === "assignees") for (const v of [c.from, c.to]) if (Array.isArray(v)) v.forEach((x) => users.add(String(x)))
      if (c.field === "teamId") for (const v of [c.from, c.to]) if (typeof v === "string") teamIds.add(v)
      if (c.field === "projectId") for (const v of [c.from, c.to]) if (typeof v === "string") projectIds.add(v)
      if (c.field === "milestoneId") for (const v of [c.from, c.to]) if (typeof v === "string") milestoneIds.add(v)
    }
  }
  return { users: [...users], teamIds: [...teamIds], projectIds: [...projectIds], milestoneIds: [...milestoneIds] }
}

/** Whether the caller may know this person exists in their scope (own: themself; team: themself and direct reports; all: everyone). Others are counted, never named or identified. */
export function personVisible(ctx: Pick<TaskCtx, "me" | "scope" | "reports">, id: string): boolean {
  if (id === ctx.me || id.startsWith("apikey:") || id.startsWith("system:")) return true
  const s = ctx.scope
  return s.kind === "all" || (s.kind === "team" && ctx.reports.includes(id))
}

export async function historyDtos(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "tz" | "drive" | "me" | "scope" | "reports">, rows: HistoryRow[]): Promise<HistoryDto[]> {
  const ref = referenced(rows)
  const nameOf = await namesOf(tx, ref.users)
  const teamRows = ref.teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, ref.teamIds))) : []
  const teamNames = new Map(teamRows.map((t) => [t.id, t.name]))
  const projectRows = ref.projectIds.length ? await tx.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.tenantId, ctx.tenantId), inArray(projects.id, ref.projectIds))) : []
  const projectNames = new Map(projectRows.map((p) => [p.id, p.name]))
  const milestoneRows = ref.milestoneIds.length ? await tx.select({ id: projectMilestones.id, name: projectMilestones.name }).from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), inArray(projectMilestones.id, ref.milestoneIds))) : []
  const milestoneNames = new Map(milestoneRows.map((m) => [m.id, m.name]))
  // "Updated Depends on" lines hold the task refs (TSK-n) the writer typed. A reader sees only the refs of tasks inside their own scope (the rule that decides
  // a dependency is visible); the others are a count, never the ref (no existence oracle).
  const depRefs = new Set<string>()
  for (const r of rows) for (const c of r.changes) if (c.field === "dependsOn") for (const v of [c.from, c.to]) if (Array.isArray(v)) v.forEach((x) => depRefs.add(String(x)))
  const refNos = [...depRefs].map((x) => /^TSK-(\d+)$/.exec(x)?.[1]).filter((n): n is string => !!n).map(Number)
  const seeable = refNos.length
    ? new Set((await tx.select({ refNo: tasks.refNo }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.refNo, refNos), taskScopeWhere(ctx.scope, ctx.reports)))).map((t) => `TSK-${t.refNo}`))
    : new Set<string>()
  // Knock-on / archive-batch lines: one batched lookup of the cause tasks the caller can see (the same scope rule as the dependency refs above).
  const causeIds = [...new Set(rows.filter((r) => r.causeTaskId && CAUSE_TEXT[r.kind]).map((r) => r.causeTaskId!))]
  const causeRef = new Map(
    causeIds.length
      ? (await tx.select({ id: tasks.id, refNo: tasks.refNo }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, causeIds), taskScopeWhere(ctx.scope, ctx.reports)))).map((t) => [t.id, `TSK-${t.refNo}`] as const)
      : [],
  )
  const textOf = (r: HistoryRow): string => {
    const c = CAUSE_TEXT[r.kind]
    if (c && r.causeTaskId) {
      const ref = causeRef.get(r.causeTaskId)
      return ref ? c.visible(ref) : c.hidden
    }
    // Safety net: a legacy row whose cause was purged (or never resolved) must not keep a raw ref in its text.
    if (r.text) {
      if (c && LEGACY_CAUSE.test(r.text)) return c.neutral
      if (r.kind === "detached" && LEGACY_DETACHED.test(r.text)) return DETACHED_NEUTRAL
    }
    return r.kind === "proposal" && r.text ? readableProposalText(r.text) : (r.text ?? "")
  }
  const depVisible = (x: unknown) => seeable.has(String(x))
  const fmt = {
    tz: ctx.tz, nameOf, teamName: (id: string) => teamNames.get(id) ?? "Former team",
    projectName: (id: string) => projectNames.get(id) ?? "Former project", milestoneName: (id: string) => milestoneNames.get(id) ?? "Former milestone",
  }
  // Drive links (ruling D22): old and new values of free text can hold one, so a device without Drive access gets them withheld here too.
  const free = (v: string) => (ctx.drive ? v : withholdDriveText(v))
  return rows.map((r) => {
    const hiddenDeps = new Set<string>()
    const changes = r.changes.map((c) => {
      if (c.field !== "dependsOn") return c
      const keep = (v: unknown) => (Array.isArray(v) ? v.filter((x) => (depVisible(x) ? true : (hiddenDeps.add(String(x)), false))) : v)
      return { ...c, from: keep(c.from), to: keep(c.to) }
    })
    return {
      id: r.id,
      at: wallOf(r.at, ctx.tz),
      atUtc: r.at.toISOString(),
      actorId: r.actorId,
      by: r.actorId ? nameOf(r.actorId) : FORMER,
      kind: r.kind,
      text: free(textOf(r)),
      changes: changes.map((c) => formatChange(c, fmt)).map((c) => ({ ...c, from: free(c.from), to: free(c.to) })),
      notified: r.notified.filter((n) => personVisible(ctx, n)),
      hiddenNotified: r.notified.filter((n) => !personVisible(ctx, n)).length, // out-of-scope people: a count only (as hidden dependencies), never their ids
      hiddenDependencies: hiddenDeps.size,
      ...(r.updateId ? { updateId: r.updateId } : {}),
    }
  })
}

/** History newest first, keyset on (at, id) descending. `limit + 1` rows are read to know whether there is a next page. */
export async function listHistory(tx: TenantTx, ctx: TaskCtx, taskId: string, o: { limit: number; cursor?: string }): Promise<{ items: HistoryDto[]; nextCursor: string | null }> {
  const after = o.cursor ? decodeCursor(o.cursor) : null
  const rows = await tx
    .select()
    .from(taskHistory)
    .where(and(eq(taskHistory.tenantId, ctx.tenantId), eq(taskHistory.taskId, taskId), after ? or(lt(taskHistory.at, after.at), and(eq(taskHistory.at, after.at), lt(taskHistory.id, after.id))) : undefined))
    .orderBy(desc(taskHistory.at), desc(taskHistory.id))
    .limit(o.limit + 1)
  const page = rows.slice(0, o.limit)
  const last = page[page.length - 1]
  return { items: await historyDtos(tx, ctx, page), nextCursor: rows.length > o.limit && last ? encodeCursor(last.at, last.id) : null }
}

/** The latest `n` lines, oldest first (the task detail timeline). */
export async function recentHistory(tx: TenantTx, ctx: TaskCtx, taskId: string, n = 50): Promise<HistoryDto[]> {
  const rows = await tx.select().from(taskHistory).where(and(eq(taskHistory.tenantId, ctx.tenantId), eq(taskHistory.taskId, taskId))).orderBy(desc(taskHistory.at), desc(taskHistory.id)).limit(n)
  return historyDtos(tx, ctx, rows.reverse())
}

