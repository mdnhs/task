import { createRoute } from "@hono/zod-openapi"
import { and, eq, sql } from "drizzle-orm"
import type { Context } from "hono"
import { todayUpdate } from "@opsdesk/domain/today"
import type { AppEnv } from "../../core/context"
import { AppError, Forbidden } from "../../core/errors"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { tasks } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { applyTaskUpdate, mutate, taskScopeWhere, TaskNotFound, wallOf } from "../tasks"
import { readModelKey, readModelTtl } from "./cache"
import { localDay } from "./days"
import { AttentionOut, AttentionQuery, DashboardOut, StaffOut, TeamTasksOut, TeamTasksQuery, TodayOut, TodayQuery, TodayUpdateBody, TodayUpdateOut } from "./dto"
import { attentionPage, loadAttention, loadDashboard, loadStaff, loadToday, loadTeamTasks } from "./service"
import { rmScope, scopeKeyOf, type RmScope } from "./scope"

// F17, F18, F21. Order of every read: route guards (module M1, permission) → the caller's scope → the cache keyed by that scope → the loader. A support session reads (never cached) the dashboard,
// team tasks and attention (task and report lists without free text), and is denied Today and the staff dashboard (personal briefings: SUPPORT_DENIED_ROUTES). An API key acts as its creator.

const guard = (module: "dashboard" | "tasks" | "attention", need: "read" | "write") => [requireTenant, requireModule("M1"), requirePermission(module, need)]
const json = <S extends object>(schema: S, description: string) => ({ description, content: { "application/json": { schema } } })

/** One read: a tenant tx, the scope, and (when `model` is given) the cache. `personal` models are keyed by user. */
async function readModel<T>(c: Context<AppEnv>, model: string | null, personal: boolean, load: (tx: TenantTx, s: RmScope) => Promise<T>): Promise<T> {
  const deps = c.get("deps")
  return withTenant(deps.db, c.get("tenant")!.id, async (tx) => {
    const s = await rmScope(c, tx)
    if (model === null) return load(tx, s)
    return deps.readModelCache.cached(readModelKey(c, model, scopeKeyOf(s, personal), s.drive, localDay(s.now, s.tz)), readModelTtl(s.support), () => load(tx, s), s.now)
  })
}

const dashboardR = createRoute({
  method: "get", path: "/v1/dashboard", middleware: guard("dashboard", "read"),
  responses: {
    200: json(DashboardOut, "The manager home bundle for the caller's scope (D5 tasks, F5 reports): summary (open, overdue, due today, completed today with a 7-day trend, awaiting review, evidence pending), tasks closed per tenant-local day (count, late, top closer), the status mix, the report deadline card (the caller's own next report; per-team counts for a manager) and the attention count (null without attention access). Cached 30 s per tenant and scope; never for a support session"),
  },
})
const teamTasksR = createRoute({
  method: "get", path: "/v1/dashboard/team-tasks", middleware: guard("tasks", "read"), request: { query: TeamTasksQuery },
  responses: { 200: json(TeamTasksOut, "Open tasks in the caller's scope, due first (the task list's own `status=open` order): the home table. Cursor paged (`limit` 1-100, 400 invalid_cursor)") },
})
const staffR = createRoute({
  method: "get", path: "/v1/dashboard/staff", middleware: guard("dashboard", "read"),
  responses: { 200: json(StaffOut, "The caller's OWN home (an API key: its creator's): my tasks (open, overdue, waiting for review, returned) and the open list, evidence waiting and returned with the reviewer's reason, the latest comments by others on my tasks, my next report. Personal: cached per user. 403 for a support session") },
})
const attentionR = createRoute({
  method: "get", path: "/v1/attention", middleware: guard("attention", "read"), request: { query: AttentionQuery },
  responses: { 200: json(AttentionOut, "FR-M1-79 feed, derived from tasks and reports in the caller's scope (nothing is stored): overdue, blocked, evidence awaiting review, reports missing and returned (last 7 days), in that order, then due time. One entry per task. `total` counts every item; each kind is capped at 200 (100 for reports). Cursor paged") },
})
const todayR = createRoute({
  method: "get", path: "/v1/today", middleware: guard("tasks", "read"), request: { query: TodayQuery },
  responses: { 200: json(TodayOut, "The Today card (FR-M1-70..80): numbers only in `counts` (safe for a lock screen), the working day start, the day's order (`mode` all | high-and-overdue), the written summary, the manager's team line (reviewers only) and the member's returned plus missing reports. Cached 30 s per user. 403 for a support session") },
})
const todayUpdateR = createRoute({
  method: "post", path: "/v1/today/updates", middleware: guard("tasks", "write"),
  request: { body: { content: { "application/json": { schema: TodayUpdateBody } }, required: true as const } },
  responses: {
    200: json(TodayUpdateOut, "Mark done or snooze from the Today card: one id per person, task, action and working day, so a repeat is `duplicate` and writes nothing (an 'evidence still needed' result does not count: a later done completes the task). 422 invalid_day_key unless `dayKey` is today's working day in the tenant timezone. A Required task without clean evidence stays open (`evidenceStillNeeded`). Snooze writes one history line. 403 human_required (an API key marking done); 404 task_not_found (unknown, another tenant's, archived or out of scope)"),
  },
})

export const readModelRoutes = newRouter()
  // Every model is cached per user: "me" is in the numbers (awaiting review leaves out my own submitted tasks, the deadline card is my own next shift), so two people of the same scope must not share an entry.
  .openapi(dashboardR, async (c) => c.json(await readModel(c, "dashboard", true, loadDashboard), 200))
  .openapi(teamTasksR, async (c) => c.json(await readModel(c, null, false, (tx, s) => loadTeamTasks(tx, s, c.req.valid("query"))), 200))
  .openapi(staffR, async (c) => c.json(await readModel(c, "staff", true, loadStaff), 200))
  .openapi(attentionR, async (c) => {
    const q = c.req.valid("query")
    const feed = await readModel(c, "attention", true, loadAttention)
    return c.json(attentionPage(feed, q.limit, q.cursor), 200)
  })
  .openapi(todayR, async (c) => {
    const { mode } = c.req.valid("query")
    return c.json(await readModel(c, `today:${mode}`, true, (tx, s) => loadToday(tx, s, mode)), 200)
  })
  .openapi(todayUpdateR, async (c) => {
    const b = c.req.valid("json")
    if (b.action === "done" && c.get("apiKey")) throw Forbidden("human_required") // marking done is the person's attestation (like a report submit); refused before any lookup
    const out = await mutate(c, async (tx, _env, ctx) => {
      // H6: the day key is the server's working day (tenant timezone, deps.clock), never the client's word: otherwise a client could mint endless history lines with made-up days
      if (b.dayKey !== localDay(ctx.now, ctx.tz)) throw new AppError(422, "invalid_day_key", "Unprocessable Entity")
      const [row] = await tx.select().from(tasks).where(and(eq(tasks.id, b.taskId), eq(tasks.tenantId, ctx.tenantId), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
      if (!row) throw TaskNotFound() // unknown, another tenant's, archived and out of scope look alike
      const update = todayUpdate(b.action, `TSK-${row.refNo}`, ctx.tenantId, b.dayKey, ctx.actorId, wallOf(ctx.now, ctx.tz).slice(0, 16), ctx.actorId)
      const result = await applyTaskUpdate(tx, ctx, update)
      const [after] = await tx.select({ status: tasks.status }).from(tasks).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
      const status = after.status as (typeof TodayUpdateOut)["_output"]["status"]
      return { result, status, evidenceStillNeeded: b.action === "done" && result === "applied" && status !== "completed" && status !== "submitted" }
    })
    return c.json(out, 200)
  })
