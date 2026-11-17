import { and, desc, eq, inArray, lt, or } from "drizzle-orm"
import { formatChange, type RawChange } from "@opsdesk/domain/task-history"
import type { FieldChange } from "@opsdesk/domain/task-model"
import { taskHistory, teams, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { decodeCursor, encodeCursor } from "./cursor"
import type { TaskCtx } from "./scope"
import { wallOf } from "./time"

export type HistoryInput = { kind: string; text?: string | null; changes?: RawChange[]; notified?: string[]; updateId?: string | null }
export type HistoryDto = { id: string; at: string; atUtc: string; actorId: string | null; by: string; kind: string; text: string; changes: FieldChange[]; notified: string[]; updateId?: string }
type HistoryRow = typeof taskHistory.$inferSelect

/** Appends one history line (tenant-time instant = ctx.now). Returns its id. A repeated (task, update_id) is a unique violation: callers check first. */
export async function writeHistory(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "actorId" | "now">, taskId: string, h: HistoryInput): Promise<string> {
  const [row] = await tx
    .insert(taskHistory)
    .values({ tenantId: ctx.tenantId, taskId, at: ctx.now, actorId: ctx.actorId, kind: h.kind, text: h.text ?? null, changes: h.changes ?? [], notified: h.notified ?? [], updateId: h.updateId ?? null })
    .returning({ id: taskHistory.id })
  return row.id
}

const FORMER = "Former member"
/** Display names NOW (never snapshotted): an erased or unknown person is "Former member"; keys and the system have fixed labels. */
export async function namesOf(tx: TenantTx, ids: string[]): Promise<(id: string) => string> {
  const real = [...new Set(ids)].filter((i) => !i.startsWith("apikey:") && !i.startsWith("system:"))
  const rows = real.length ? await tx.select({ id: user.id, name: user.name, erasedAt: user.erasedAt }).from(user).where(inArray(user.id, real)) : []
  const byId = new Map(rows.map((r) => [r.id, r.erasedAt ? FORMER : r.name]))
  return (id) => (id.startsWith("apikey:") ? "API key" : id.startsWith("system:") ? "System" : (byId.get(id) ?? FORMER))
}

/** Ids a set of raw changes refers to: people (assignees) and teams. */
function referenced(rows: HistoryRow[]): { users: string[]; teamIds: string[] } {
  const users = new Set<string>()
  const teamIds = new Set<string>()
  for (const r of rows) {
    if (r.actorId) users.add(r.actorId)
    for (const n of r.notified) users.add(n)
    for (const c of r.changes) {
      if (c.field === "assignees") for (const v of [c.from, c.to]) if (Array.isArray(v)) v.forEach((x) => users.add(String(x)))
      if (c.field === "teamId") for (const v of [c.from, c.to]) if (typeof v === "string") teamIds.add(v)
    }
  }
  return { users: [...users], teamIds: [...teamIds] }
}

export async function historyDtos(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "tz">, rows: HistoryRow[]): Promise<HistoryDto[]> {
  const ref = referenced(rows)
  const nameOf = await namesOf(tx, ref.users)
  const teamRows = ref.teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, ref.teamIds))) : []
  const teamNames = new Map(teamRows.map((t) => [t.id, t.name]))
  const fmt = { tz: ctx.tz, nameOf, teamName: (id: string) => teamNames.get(id) ?? "Former team" }
  return rows.map((r) => ({
    id: r.id,
    at: wallOf(r.at, ctx.tz),
    atUtc: r.at.toISOString(),
    actorId: r.actorId,
    by: r.actorId ? nameOf(r.actorId) : FORMER,
    kind: r.kind,
    text: r.text ?? "",
    changes: r.changes.map((c) => formatChange(c, fmt)),
    notified: r.notified,
    ...(r.updateId ? { updateId: r.updateId } : {}),
  }))
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

