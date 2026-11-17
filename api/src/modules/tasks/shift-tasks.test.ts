import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { taskScope } from "@opsdesk/domain/task-scope"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { withTenant } from "../../db/tenant-tx"
import { listTasksForPerson, shiftTasksQuery, type TaskCtx } from "."

// T5.2: listTasksForPerson (E3, F9, D5): the SQL form of the domain taskInShift, ANDed with the caller's task scope.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string; cookie: string }
const WIN = { fromUtc: new Date("2026-10-24T21:00:00.000Z"), toUtc: new Date("2026-10-25T06:00:00.000Z") }

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})
afterEach(resetSubscribers)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const who = async (role: string): Promise<Who> => {
    const m = await makeMember(t.deps, tenant.id, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const ops = await who("ops")
  const manager = await who("manager") // team scope
  const staff = await who("employee")
  const staff2 = await who("employee")
  const staff3 = await who("employee")
  const q = <R = Json>(sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<R[]>
  const mk = async (primary: Who, o: Json = {}) => {
    const { start = "2026-10-24T20:00:00.000Z", due = "2026-10-25T02:00:00.000Z", status, completedAt, submittedAt, archived, others, ...rest } = o
    const r = await call(t.app, "POST", "/v1/tasks", { cookie: ops.cookie, tenant: "acme", body: { title: "T", description: "d", priority: 2, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: primary.userId, ...rest } })
    expect(r.status, await r.clone().text()).toBe(201)
    const tk = (await r.json()) as Json
    await q("update tasks set start_at = $2, due_at = $3 where id = $1", [tk.id, start, due])
    if (status) await q("update tasks set status = $2, completed_at = $3, submitted_at = $4 where id = $1", [tk.id, status, completedAt ?? null, submittedAt ?? null])
    if (archived) await q("update tasks set archived_at = now() where id = $1", [tk.id])
    if (others) await q("insert into task_assignees (tenant_id, task_id, user_id, is_primary) select $1, $2, unnest($3::text[]), false", [tenant.id, tk.id, others])
    return tk
  }
  const ctx = (me: Who, scope: TaskCtx["scope"], reports: string[] = []): TaskCtx => ({ tenantId: tenant.id, tz: "Europe/Dublin", me: me.userId, actorId: me.userId, role: null as never, scope, reports, drive: true, now: t.clock.now() })
  const list = (c: TaskCtx, person: Who, window = WIN) => withTenant(t.deps.db, tenant.id, (tx) => listTasksForPerson(tx, c, person.userId, window))
  return { ...t, tenant, who, ops, manager, staff, staff2, staff3, q, mk, ctx, list }
}

describe("listTasksForPerson (F9)", () => {
  test("any assignee, not archived or cancelled, starts before window end, not finished before window start; due asc then ref", async () => {
    const w = await world()
    const all = { kind: "all" } as const
    const inT = await w.mk(w.staff, { due: "2026-10-25T03:00:00.000Z" })
    const co = await w.mk(w.staff2, { others: [w.staff.userId], due: "2026-10-25T01:00:00.000Z" }) // staff is a CO-assignee
    const sameDueA = await w.mk(w.staff, { due: "2026-10-25T01:00:00.000Z" }) // ties with co: ref breaks it (co has the lower ref)
    await w.mk(w.staff, { archived: true })
    await w.mk(w.staff, { status: "cancelled" })
    await w.mk(w.staff, { start: "2026-10-25T06:00:00.000Z", due: "2026-10-25T07:00:00.000Z" }) // starts AT the window end: out
    const justIn = await w.mk(w.staff, { start: "2026-10-25T05:59:59.999Z", due: "2026-10-25T07:00:00.000Z" }) // one ms before the end: in
    await w.mk(w.staff, { status: "completed", completedAt: "2026-10-24T20:59:59.999Z" }) // finished before the window: out
    const atStart = await w.mk(w.staff, { status: "completed", completedAt: "2026-10-24T21:00:00.000Z", due: "2026-10-25T01:30:00.000Z" }) // finished exactly at the start: in
    await w.mk(w.staff, { status: "submitted", submittedAt: "2026-10-24T20:00:00.000Z", due: "2026-10-24T23:00:00.000Z" }) // submitted before: out (submitted_at)
    await w.mk(w.staff, { status: "completed", due: "2026-10-24T20:00:00.000Z" }) // finished with no time at all: its due time decides: out
    const noTime = await w.mk(w.staff, { status: "completed", due: "2026-10-24T22:00:00.000Z" }) // no completed_at / submitted_at, due inside: in
    await w.mk(w.staff2) // someone else's
    const got = await w.list(w.ctx(w.ops, all), w.staff)
    const dues = got.map((r) => r.dueAt.getTime())
    expect([...dues].sort((a, b) => a - b)).toEqual(dues) // due ascending
    const tied = got.filter((r) => r.dueAt.toISOString() === "2026-10-25T01:00:00.000Z").map((r) => r.ref)
    expect(tied).toEqual([co.ref, sameDueA.ref]) // the same due: the lower TSK number first
    expect(new Set(got.map((r) => r.ref))).toEqual(new Set([inT, co, sameDueA, justIn, atStart, noTime].map((t) => t.ref)))
    expect(got[0]).toMatchObject({ taskId: expect.any(String), title: "T", status: expect.any(String), evidenceRequired: false })
  })

  test("evidenceRequired is true only for a Required rule", async () => {
    const w = await world()
    await w.mk(w.staff, { evidenceRule: { mode: "required", types: ["note"], min: 1, instruction: "", review: "manager" } })
    await w.mk(w.staff, { evidenceRule: { mode: "optional", types: ["note"], min: 0, instruction: "", review: "manager" } })
    const got = await w.list(w.ctx(w.ops, { kind: "all" }), w.staff)
    expect(got.map((r) => r.evidenceRequired).sort()).toEqual([false, true])
  })

  test("respects task scope: a team manager passing an out-of-team personId gets []; staff passing someone else gets [] (D5, subjectUserId for an api key = its creator)", async () => {
    const w = await world()
    await w.mk(w.staff)
    await w.mk(w.staff2)
    await w.q("insert into reporting_lines (tenant_id, user_id, manager_id) values ($1, $2, $3)", [w.tenant.id, w.staff.userId, w.manager.userId])
    const team = w.ctx(w.manager, taskScope({ home: "manager", access: { tasks: "write" } as never, reportScope: "team" } as never, w.manager.userId)!, [w.staff.userId])
    expect((await w.list(team, w.staff)).length).toBe(1) // a direct report
    expect(await w.list(team, w.staff2)).toEqual([]) // not in the manager's team
    const own = w.ctx(w.staff, { kind: "own", personId: w.staff.userId })
    expect((await w.list(own, w.staff)).length).toBe(1)
    expect(await w.list(own, w.staff2)).toEqual([]) // staff passing someone else
    expect(await w.list(own, w.staff3)).toEqual([])
    // a task both people are on is visible to staff through THEIR OWN assignment (the scope rule of /v1/tasks), and only that one
    const both = await w.mk(w.staff2, { others: [w.staff.userId] })
    expect((await w.list(own, w.staff2)).map((r) => r.taskId)).toEqual([both.id])
    // an api key acts as its creator: the HTTP path is exercised in reports.test.ts (open as a key), here the ctx.me is the creator
    expect((await w.list(w.ctx(w.staff3, { kind: "own", personId: w.staff3.userId }), w.staff)).length).toBe(0)
  })

  test("the statement uses task_assignees_user_idx and an index on tasks at 10k rows (EXPLAIN)", async () => {
    const w = await world()
    await w.mk(w.staff)
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id)
       select $1::uuid, 5000 + g, 'Seed ' || g, '{"mode":"none","types":[],"min":0,"instruction":"","review":"manager"}'::jsonb, timestamptz '2026-10-19T00:00:00Z', timestamptz '2026-10-20T00:00:00Z' + (g || ' minutes')::interval, now(), now(), $2 from generate_series(1, 10000) g`,
      [w.tenant.id, w.ops.userId],
    )
    await w.q(
      `insert into task_assignees (tenant_id, task_id, user_id, is_primary) select $1::uuid, id, case when ref_no % 400 = 0 then $2 else $3 end, true from tasks where ref_no > 5000`,
      [w.tenant.id, w.staff.userId, w.staff2.userId],
    )
    await ownerQuery("analyze tasks")
    await ownerQuery("analyze task_assignees")
    const plan = await withTenant(w.deps.db, w.tenant.id, async (tx) => {
      const { sql: text, params } = shiftTasksQuery(tx, w.ctx(w.ops, { kind: "all" }), w.staff.userId, WIN).toSQL()
      return { text, params }
    })
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const text = (await c.query(`explain ${plan.text}`, plan.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(text).toContain("task_assignees_user_idx")
      expect(text).not.toMatch(/Seq Scan on tasks/)
      expect(text).not.toMatch(/Seq Scan on task_assignees/)
      expect(text).toMatch(/tasks_live_due_idx|tasks_pkey|tasks_tenant_ref/)
    } finally {
      await c.end()
    }
    expect((await w.list(w.ctx(w.ops, { kind: "all" }), w.staff)).length).toBeGreaterThan(20)
    void sql
  }, 120_000)
})
