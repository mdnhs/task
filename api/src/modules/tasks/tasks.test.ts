import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { publish, relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { withTenant } from "../../db/tenant-tx"
import { clearModuleOverride } from "../entitlements"
import { applyTaskUpdate, buildListQuery, type TaskCtx } from "."
import { NO_EVIDENCE } from "@opsdesk/domain/task-evidence"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

type Who = { userId: string; email: string; password: string; cookie: string }

async function world(over: { timezone?: string; sessionIdleHours?: number; env?: Partial<typeof testEnv> } = {}) {
  const t = testApp(over.env ? { env: { ...testEnv, ...over.env } } : {})
  const tenant = await makeTenant(t.deps, { slug: "acme", sessionIdleHours: over.sessionIdleHours })
  if (over.timezone) await ownerQuery("update tenants set timezone = $1 where id = $2", [over.timezone, tenant.id])
  const who = async (role: string, tenantId = tenant.id): Promise<Who> => {
    const m = await makeMember(t.deps, tenantId, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager") // manager-home, reportScope "team"
  const ops = await who("ops") // manager-home, all
  const staff = await who("employee")
  const staff2 = await who("employee")
  const req = (method: string, path: string, as: { cookie: string } | null, body?: unknown, slug = "acme") => call(t.app, method, path, { cookie: as?.cookie, tenant: slug, body })
  const json = async (r: Response) => (await r.json()) as Json
  const manages = async (mgr: Who, person: Who) => expect((await req("PUT", `/v1/members/${person.userId}/manager`, owner, { managerId: mgr.userId })).status).toBe(200)
  const base = (over2: Json = {}) => ({ title: "Check fire exits", description: "Walk every floor.", priority: 2, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: staff.userId, ...over2 })
  const mk = async (as: Who, over2: Json = {}) => {
    const r = await req("POST", "/v1/tasks", as, base(over2))
    expect(r.status, await r.clone().text()).toBe(201)
    return json(r)
  }
  const q = <R = Json>(sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<R[]>
  return { ...t, tenant, who, owner, manager, ops, staff, staff2, req, json, manages, base, mk, q }
}
type W = Awaited<ReturnType<typeof world>>
const ctxFor = (w: W, who: Who): TaskCtx => ({ tenantId: w.tenant.id, tz: "Europe/Dublin", me: who.userId, actorId: who.userId, role: { home: "staff", access: { tasks: "write" } } as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() })
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string

describe("create, wall clock and refs", () => {
  test("create stores UTC and echoes tenant-local wall clock: due 2026-10-25T01:30:00 Europe/Dublin → dueAt 2026-10-25T00:30:00.000Z (earlier instant)", async () => {
    const w = await world()
    const r = await w.mk(w.ops, { start: "2026-10-24T09:00:00", due: "2026-10-25T01:30:00" })
    expect(r.dueAt).toBe("2026-10-25T00:30:00.000Z")
    expect(r.due).toBe("2026-10-25T01:30:00")
    expect(r.startAt).toBe("2026-10-24T08:00:00.000Z") // BST still (+1)
    expect(r.ref).toBe("TSK-1000")
    expect(r.version).toBe(1)
    expect(r.assignee).toBe(w.staff.userId)
    expect(r.creator).toBe(w.ops.userId)
    const [row] = await w.q("select due_at from tasks")
    expect(new Date(row.due_at as string).toISOString()).toBe("2026-10-25T00:30:00.000Z")
  })

  test("due 2027-03-28T01:30:00 (spring-forward gap) is stored as 01:30Z and shown as 02:30 local", async () => {
    const w = await world()
    const r = await w.mk(w.ops, { start: "2027-03-27T09:00:00", due: "2027-03-28T01:30:00" })
    expect(r.dueAt).toBe("2027-03-28T01:30:00.000Z")
    expect(r.due).toBe("2027-03-28T02:30:00")
  })

  test("invalid dates are 422 invalid_dates (start after due, a date that does not exist)", async () => {
    const w = await world()
    expect(await code(await w.req("POST", "/v1/tasks", w.manager, w.base({ start: "2026-11-21T09:00:00", due: "2026-11-20T17:00:00" })))).toBe("invalid_dates")
    expect(await code(await w.req("POST", "/v1/tasks", w.manager, w.base({ due: "2026-13-40T17:00:00" })))).toBe("invalid_dates")
  })

  test("refs are sequential per tenant and never collide under 20 concurrent creates", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const cb = (await signIn(w.app, ob.email, ob.password)).cookie
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => w.req("POST", "/v1/tasks", w.owner, w.base({ title: `T${i}` }))))
    expect(rs.map((r) => r.status)).toEqual(Array(20).fill(201))
    const refs = (await Promise.all(rs.map((r) => w.json(r)))).map((t) => t.ref as string).sort()
    expect(new Set(refs).size).toBe(20)
    expect(refs).toEqual(Array.from({ length: 20 }, (_, i) => `TSK-${1000 + i}`))
    const b = await w.json(await call(w.app, "POST", "/v1/tasks", { cookie: cb, tenant: "bravo", body: { ...w.base(), primary: ob.userId } }))
    expect(b.ref).toBe("TSK-1000") // each tenant has its own sequence
  }, 60_000)

  test("staff can create only for themselves (403 cannot_assign_others) and cannot PATCH dates (403 dates_manager_only)", async () => {
    const w = await world()
    expect(await code(await w.req("POST", "/v1/tasks", w.staff, w.base({ primary: w.staff2.userId })))).toBe("cannot_assign_others")
    expect(await code(await w.req("POST", "/v1/tasks", w.staff, w.base({ primary: w.staff.userId, others: [w.staff2.userId] })))).toBe("cannot_assign_others")
    const own = await w.json(await w.req("POST", "/v1/tasks", w.staff, w.base({ primary: undefined })))
    expect(own.assignee).toBe(w.staff.userId) // primary defaults to me
    const p = await w.req("PATCH", `/v1/tasks/${own.id}`, w.staff, { version: 1, due: "2026-11-25T17:00:00" })
    expect(p.status).toBe(403)
    expect(await code(p)).toBe("dates_manager_only")
    // …but the creator may fix title, description, priority and labels of their own task
    const ok = await w.req("PATCH", `/v1/tasks/${own.id}`, w.staff, { version: 1, title: "Fixed typo", labels: ["Safety", " safety ", "Fire"] })
    expect(ok.status).toBe(200)
    const j = await w.json(ok)
    expect(j.title).toBe("Fixed typo")
    expect(j.tags).toEqual(["safety", "fire"])
    expect(j.version).toBe(2)
    // a manager-created task: the assignee is not its creator, so a title edit is forbidden
    const mine = await w.mk(w.ops)
    expect((await w.req("PATCH", `/v1/tasks/${mine.id}`, w.staff, { version: 1, title: "x" })).status).toBe(403)
  })

  test("assignee from another tenant or an inactive member → 422 invalid_assignee (same code as a random id)", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const foreign = await makeMember(w.deps, other.id, "employee")
    await w.q("update memberships set status = 'suspended' where user_id = $1", [w.staff2.userId])
    for (const primary of [foreign.userId, w.staff2.userId, "usr_ghost_000"]) {
      const r = await w.req("POST", "/v1/tasks", w.owner, w.base({ primary }))
      expect(r.status, primary).toBe(422)
      expect(await code(r)).toBe("invalid_assignee")
    }
    expect(await code(await w.req("POST", "/v1/tasks", w.owner, w.base({ others: [foreign.userId] })))).toBe("invalid_assignee")
    expect((await w.q("select count(*)::int n from tasks"))[0].n).toBe(0)
  })

  test("department must be a team of kind department (422 invalid_team) and shows as dept", async () => {
    const w = await world()
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Cleaning", kind: "department" }))
    const plain = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Night", kind: "team" }))
    expect(await code(await w.req("POST", "/v1/tasks", w.owner, w.base({ teamId: plain.id })))).toBe("invalid_team")
    expect(await code(await w.req("POST", "/v1/tasks", w.owner, w.base({ teamId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" })))).toBe("invalid_team")
    const t = await w.mk(w.owner, { teamId: dept.id })
    expect(t.dept).toBe("Cleaning")
    // deleting the department keeps the task, without a department
    expect((await w.req("DELETE", `/v1/teams/${dept.id}`, w.owner)).status).toBe(204)
    const after = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))
    expect(after.dept).toBe("")
    expect(after.teamId).toBeNull()
  })
})

describe("scope (FR-M1-10, ruling D5)", () => {
  test("a task outside the caller's scope is 404 task_not_found on GET, PATCH, status and history (staff, team manager)", async () => {
    const w = await world()
    const t = await w.mk(w.owner) // staff is the assignee; staff2 and the manager have nothing to do with it
    await w.manages(w.manager, w.staff2)
    const calls: [string, string, unknown][] = [
      ["GET", `/v1/tasks/${t.id}`, undefined],
      ["PATCH", `/v1/tasks/${t.id}`, { version: 1, title: "x" }],
      ["POST", `/v1/tasks/${t.id}/status`, { version: 1, to: "in_progress" }],
      ["POST", `/v1/tasks/${t.id}/complete`, { version: 1 }],
      ["GET", `/v1/tasks/${t.id}/history`, undefined],
      ["PUT", `/v1/tasks/${t.id}/assignees`, { version: 1, primary: w.staff2.userId, others: [] }],
    ]
    for (const who of [w.staff2, w.manager]) {
      for (const [m, p, b] of calls) {
        const r = await w.req(m, p, who, b)
        expect(r.status, `${m} ${p}`).toBe(404)
        expect(await code(r)).toBe("task_not_found")
      }
    }
    expect((await w.req("GET", `/v1/tasks/${t.id}`, w.staff)).status).toBe(200) // the assignee still sees it
    expect((await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))).version).toBe(1) // and nothing above changed it
  })

  test("team manager sees tasks of direct reports, not of other teams; owner sees all; staff see their own, created or named-reviewer ones", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const t1 = await w.mk(w.owner, { primary: w.staff.userId, title: "Reports task" })
    const t2 = await w.mk(w.owner, { primary: w.staff2.userId, title: "Other team task" })
    const t3 = await w.mk(w.manager, { primary: w.staff.userId, title: "Created by manager" })
    const names = async (as: Who, qs = "") => ((await w.json(await w.req("GET", `/v1/tasks${qs}`, as))).items as Json[]).map((i) => i.title as string).sort()
    expect(await names(w.manager)).toEqual(["Created by manager", "Reports task"])
    expect(await names(w.owner)).toEqual(["Created by manager", "Other team task", "Reports task"])
    expect(await names(w.ops)).toHaveLength(3)
    expect(await names(w.staff)).toEqual(["Created by manager", "Reports task"])
    expect(await names(w.staff2)).toEqual(["Other team task"])
    expect((await w.req("GET", `/v1/tasks/${t2.id}`, w.manager)).status).toBe(404)
    expect((await w.req("GET", `/v1/tasks/${t1.id}`, w.manager)).status).toBe(200)
    expect(t3.creator).toBe(w.manager.userId)
    // a named evidence reviewer sees the task too
    const named = await w.mk(w.owner, { primary: w.staff2.userId, title: "Named", evidenceRule: { mode: "optional", types: ["note"], min: 0, instruction: "", review: "named", reviewer: w.staff.userId } })
    expect(await names(w.staff)).toContain("Named")
    expect(named.evidenceRule.reviewer).toBe(w.staff.userId)
  })

  test("a clone of manager keeps the team scope; a role without tasks:read cannot list", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await w.mk(w.owner, { primary: w.staff2.userId, title: "Elsewhere" })
    const [mgrRole] = await w.q("select id from roles where key = 'manager'")
    const cloned = await w.json(await w.req("POST", `/v1/roles/${mgrRole.id}/clone`, w.owner, { label: "Manager copy" }))
    const m2 = await makeMember(w.deps, w.tenant.id, "employee")
    await w.q("update memberships set role_id = $1 where user_id = $2", [cloned.id, m2.userId])
    await w.q("insert into reporting_lines (tenant_id, user_id, manager_id) values ($1, $2, $3)", [w.tenant.id, w.staff2.userId, m2.userId])
    const c2 = (await signIn(w.app, m2.email, m2.password)).cookie
    const names = ((await w.json(await w.req("GET", "/v1/tasks", { cookie: c2 }))).items as Json[]).map((i) => i.title)
    expect(names).toEqual(["Elsewhere"]) // its report's task only, not "all"
    const noRead = await makeMember(w.deps, w.tenant.id, "platform").catch(() => null)
    if (noRead) expect((await w.req("GET", "/v1/tasks", { cookie: (await signIn(w.app, noRead.email, noRead.password)).cookie })).status).toBe(403)
  })
})

describe("list filters, cursor and indexes", () => {
  test("due=today and due=overdue follow the tenant timezone, not UTC (tenant in Pacific/Auckland at 23:30Z)", async () => {
    const w = await world({ timezone: "Pacific/Auckland", sessionIdleHours: 72 })
    // 2026-11-16T23:30Z = 2026-11-17 12:30 in Auckland (NZDT, +13)
    w.clock.advance({ hours: 14, minutes: 30 })
    const a = await w.mk(w.ops, { title: "A", start: "2026-11-17T08:00:00", due: "2026-11-17T09:00:00" }) // today, already past
    const b = await w.mk(w.ops, { title: "B", start: "2026-11-16T19:00:00", due: "2026-11-16T20:00:00" }) // yesterday (but 07:00Z on the 16th: "today" in UTC)
    const c = await w.mk(w.ops, { title: "C", start: "2026-11-17T17:00:00", due: "2026-11-17T18:00:00" }) // today, still ahead
    const d = await w.mk(w.ops, { title: "D", start: "2026-11-24T08:00:00", due: "2026-11-24T09:00:00" }) // 7 days ahead (this week window)
    const e = await w.mk(w.ops, { title: "E", start: "2026-11-25T08:00:00", due: "2026-11-25T09:00:00" }) // 8 days ahead
    const titles = async (qs: string) => ((await w.json(await w.req("GET", `/v1/tasks?${qs}`, w.ops))).items as Json[]).map((i) => i.title as string).sort()
    expect(await titles("due=today")).toEqual(["A", "C"])
    expect(await titles("due=overdue")).toEqual(["A", "B"])
    expect(await titles("due=week")).toEqual(["A", "C", "D"])
    expect(await titles("due=all")).toHaveLength(5)
    void [a, b, c, d, e]
  })

  test("filters: status, priority, assignee, label, ref, q (ref or title) and archived are excluded", async () => {
    const w = await world()
    const t1 = await w.mk(w.owner, { title: "Mop the lobby floor", priority: 3, labels: ["clean"] })
    const t2 = await w.mk(w.owner, { title: "Fire alarm test", priority: 1, primary: w.staff2.userId })
    const t3 = await w.mk(w.owner, { title: "Archived thing" })
    await w.req("POST", `/v1/tasks/${t2.id}/status`, w.staff2, { version: 1, to: "in_progress" })
    await w.q("update tasks set archived_at = now() where id = $1", [t3.id])
    const titles = async (qs: string) => ((await w.json(await w.req("GET", `/v1/tasks?${qs}`, w.owner))).items as Json[]).map((i) => i.title as string).sort()
    expect(await titles("")).toEqual(["Fire alarm test", "Mop the lobby floor"])
    expect(await titles("status=open")).toEqual(["Fire alarm test", "Mop the lobby floor"])
    expect(await titles("status=in_progress")).toEqual(["Fire alarm test"])
    expect(await titles("status=review")).toEqual([])
    expect(await titles("priority=3")).toEqual(["Mop the lobby floor"])
    expect(await titles(`assignee=${w.staff2.userId}`)).toEqual(["Fire alarm test"])
    expect(await titles("label=Clean")).toEqual(["Mop the lobby floor"])
    expect(await titles(`ref=${t2.ref}`)).toEqual(["Fire alarm test"])
    expect(await titles(`q=${t1.ref}`)).toEqual(["Mop the lobby floor"])
    expect(await titles("q=LOBBY")).toEqual(["Mop the lobby floor"])
    expect(await titles("q=100%25")).toEqual([]) // a LIKE wildcard in the query is literal
    expect(await titles("repeat=recurring")).toEqual([])
  })

  test("list uses tasks_live_due_idx (EXPLAIN) and returns 25 items + nextCursor; a bad cursor → 400 invalid_cursor", async () => {
    const w = await world()
    await w.mk(w.owner) // makes the tenant counter and a real row
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id)
       select $1::uuid, 2000 + g, 'Seed ' || g, $2::jsonb, now(), date_trunc('milliseconds', now()) + (g || ' minutes')::interval, now(), now(), $3 from generate_series(1, 4000) g`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE), w.owner.userId],
    )
    await ownerQuery("analyze tasks")
    const p1 = await w.json(await w.req("GET", "/v1/tasks", w.owner))
    expect(p1.items).toHaveLength(25)
    expect(p1.nextCursor).toEqual(expect.any(String))
    const p2 = await w.json(await w.req("GET", `/v1/tasks?cursor=${p1.nextCursor}&limit=100`, w.owner))
    expect(p2.items).toHaveLength(100)
    const ids = new Set([...p1.items, ...p2.items].map((i: Json) => i.id))
    expect(ids.size).toBe(125) // no overlap, no gap
    const dueOrder = [...p1.items, ...p2.items].map((i: Json) => i.dueAt as string)
    expect([...dueOrder].sort()).toEqual(dueOrder)
    for (const bad of ["garbage", Buffer.from("nope").toString("base64url"), Buffer.from("2026-11-16T09:00:00.000Z|not-a-uuid").toString("base64url")]) {
      const r = await w.req("GET", `/v1/tasks?cursor=${bad}`, w.owner)
      expect(r.status, bad).toBe(400)
      expect(await code(r)).toBe("invalid_cursor")
    }
    // the plan of the exact list query (all-scope owner): the partial index on (tenant, due, id)
    const plan = await withTenant(w.deps.db, w.tenant.id, async (tx) => {
      const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.owner.userId, actorId: w.owner.userId, role: null as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() }
      const { sql: text, params } = buildListQuery(tx, ctx, {}, 26).toSQL()
      return { text, params }
    })
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const rows = (await c.query(`explain ${plan.text}`, plan.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(rows).toContain("tasks_live_due_idx")
      expect(rows).not.toMatch(/Seq Scan on tasks/)
    } finally {
      await c.end()
    }
  }, 60_000)
})

describe("update, history and optimistic version (AC-M1-04, D4)", () => {
  test("a manager reschedules and reassigns a member's task: the member is notified and history has old and new values (AC-M1-04)", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await w.manages(w.manager, w.staff2)
    const t = await w.mk(w.manager)
    w.clock.advance({ minutes: 5 })
    const r = await w.req("PATCH", `/v1/tasks/${t.id}`, w.manager, { version: 1, due: "2026-11-21T17:00:00", start: "2026-11-20T09:00:00" })
    expect(r.status).toBe(200)
    const upd = await w.json(r)
    expect(upd.version).toBe(2)
    expect(upd.due).toBe("2026-11-21T17:00:00")
    const [h] = await w.q("select changes, notified, actor_id, kind from task_history where kind = 'updated'")
    expect(h.changes).toEqual([{ field: "due", from: "2026-11-20T17:00:00.000Z", to: "2026-11-21T17:00:00.000Z" }]) // start was unchanged, so not listed
    expect(h.notified).toEqual([w.staff.userId])
    expect(h.actor_id).toBe(w.manager.userId)
    w.clock.advance({ minutes: 5 })
    const a = await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.manager, { version: 2, primary: w.staff2.userId, others: [w.staff.userId] })
    expect(a.status).toBe(200)
    const asg = await w.json(a)
    expect(asg.assignee).toBe(w.staff2.userId)
    expect(asg.assignees).toEqual([w.staff.userId])
    expect(asg.version).toBe(3)
    const hist = await w.json(await w.req("GET", `/v1/tasks/${t.id}/history`, w.manager))
    expect(hist.nextCursor).toBeNull()
    expect(hist.items.map((i: Json) => i.kind)).toEqual(["assigned", "updated", "created"]) // newest first
    expect(hist.items[1].changes).toEqual([{ field: "Due", from: "20 Nov 17:00", to: "21 Nov 17:00" }])
    expect(hist.items[0].changes).toEqual([{ field: "Assignees", from: expect.any(String), to: expect.stringContaining(",") }])
    expect(hist.items[1].notified).toEqual([w.staff.userId])
    expect(hist.items[0].notified).toContain(w.staff2.userId)
    const notes = await w.q("select user_id, kind, body from notifications order by created_at")
    expect(notes.filter((n) => n.user_id === w.staff.userId).map((n) => n.kind)).toEqual(["task", "task", "task"]) // assigned at creation, rescheduled, still on it
    expect(notes.every((n) => n.kind === "task")).toBe(true)
    expect(JSON.stringify(notes)).not.toContain("Test Member") // no person's name in a notice
    // the same history is on the detail (oldest first)
    const detail = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.staff2))
    expect(detail.timeline.map((i: Json) => i.kind)).toEqual(["created", "updated", "assigned"])
    expect(detail.timeline[1].changes[0]).toEqual({ field: "Due", from: "20 Nov 17:00", to: "21 Nov 17:00" })
  })

  test("erased people show as Former member in old history lines (names are never snapshotted)", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.owner, { version: 1, primary: w.staff2.userId, others: [] })
    await w.q("select 1")
    await ownerQuery("update \"user\" set name = 'Erased Person', erased_at = now() where id = $1", [w.staff.userId])
    const hist = await w.json(await w.req("GET", `/v1/tasks/${t.id}/history`, w.owner))
    const change = hist.items.find((i: Json) => i.kind === "assigned").changes[0]
    expect(change.from).toBe("Former member")
    expect(JSON.stringify(hist)).not.toContain("Erased Person")
  })

  test("concurrent PATCH with the same version: one wins, one 409 version_conflict", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const rs = await Promise.all([
      w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, title: "From owner A" }),
      w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, title: "From ops B" }),
    ])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    const loser = rs.find((r) => r.status === 409)!
    expect(await code(loser)).toBe("version_conflict")
    const [row] = await w.q("select title, version from tasks")
    expect(row.version).toBe(2)
    expect(["From owner A", "From ops B"]).toContain(row.title)
    expect((await w.q("select count(*)::int n from task_history where kind = 'updated'"))[0].n).toBe(1) // the loser wrote nothing
    // a stale version later is the same 409; a missing version is a validation error
    expect(await code(await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, title: "late" }))).toBe("version_conflict")
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { title: "no version" })).status).toBe(400)
  })

  test("history pages newest first on (at, id) with a cursor; a bad cursor is 400 invalid_cursor", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    for (let v = 1; v <= 3; v++) {
      w.clock.advance({ minutes: 1 })
      expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: v, priority: v === 2 ? 3 : v === 1 ? 1 : 2 })).status).toBe(200)
    }
    const p1 = await w.json(await w.req("GET", `/v1/tasks/${t.id}/history?limit=3`, w.owner))
    expect(p1.items.map((i: Json) => i.kind)).toEqual(["updated", "updated", "updated"])
    expect(p1.items[0].changes).toEqual([{ field: "Priority", from: "High", to: "Medium" }]) // raw 3 → 2 shown by name
    expect(p1.nextCursor).toEqual(expect.any(String))
    const p2 = await w.json(await w.req("GET", `/v1/tasks/${t.id}/history?limit=3&cursor=${p1.nextCursor}`, w.owner))
    expect(p2.items.map((i: Json) => i.kind)).toEqual(["created"])
    expect(p2.nextCursor).toBeNull()
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/history?cursor=zzz`, w.owner))).toBe("invalid_cursor")
  })

  test("a PATCH that changes nothing keeps the version and writes no history", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const r = await w.json(await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, title: t.title, priority: 2 }))
    expect(r.version).toBe(1)
    expect((await w.q("select count(*)::int n from task_history"))[0].n).toBe(1) // only "created"
  })

  test("assignees need manage rights (staff 403), at most 9 others, and a stale version is 409", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    expect(await code(await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.staff, { version: 1, primary: w.staff.userId, others: [] }))).toBe("forbidden")
    expect((await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.owner, { version: 1, primary: w.staff.userId, others: Array.from({ length: 10 }, (_, i) => `usr_${i}`) })).status).toBe(400)
    expect(await code(await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.owner, { version: 7, primary: w.staff2.userId, others: [] }))).toBe("version_conflict")
    expect(await code(await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.owner, { version: 1, primary: "usr_ghost", others: [] }))).toBe("invalid_assignee")
    expect(await code(await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.owner, { version: 1, primary: w.staff.userId, others: [w.staff.userId] }))).toBe("invalid_assignee") // primary twice
  })
})

describe("status and complete", () => {
  test("status moves follow nextStatuses; blocked → completed is 422 invalid_transition; manager may cancel any open task", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const st = (as: Who, version: number, to: string) => w.req("POST", `/v1/tasks/${t.id}/status`, as, { version, to })
    const a = await w.json(await st(w.staff, 1, "in_progress"))
    expect(a.status).toBe("in_progress")
    expect(a.version).toBe(2)
    const b = await w.json(await st(w.staff, 2, "blocked"))
    expect(b.status).toBe("blocked")
    const bad = await st(w.staff, 3, "completed")
    expect(bad.status).toBe(422)
    expect(await code(bad)).toBe("invalid_transition")
    expect(await code(await st(w.staff, 3, "submitted"))).toBe("invalid_transition")
    expect(await code(await st(w.staff, 3, "not_started"))).toBe("invalid_transition")
    expect(await code(await st(w.staff, 2, "in_progress"))).toBe("version_conflict")
    // an outsider who can see it but is not an assignee and not a manager is forbidden; the creator-staff case
    const own = await w.json(await w.req("POST", "/v1/tasks", w.staff2, w.base({ primary: undefined })))
    expect(await code(await w.req("POST", `/v1/tasks/${t.id}/status`, w.staff2, { version: 3, to: "in_progress" }))).toBe("task_not_found")
    expect(own.assignee).toBe(w.staff2.userId)
    // a manager may cancel; staff may not cancel
    expect(await code(await st(w.staff, 3, "cancelled"))).toBe("invalid_transition")
    const c = await w.json(await st(w.ops, 3, "cancelled"))
    expect(c.status).toBe("cancelled")
    expect(await code(await st(w.ops, 4, "cancelled"))).toBe("invalid_transition") // not open any more
    const hist = await w.q("select changes from task_history where kind = 'status' order by at, id")
    expect(hist).toHaveLength(3)
    const flat = hist.flatMap((h) => h.changes as Json[]).map((c2) => [c2.from, c2.to])
    expect(flat).toContainEqual(["in_progress", "blocked"])
    const ev = await w.q("select type, payload from domain_events where type = 'task.status_changed' order by occurred_at, id")
    expect(ev.map((e) => (e.payload as Json).to).sort()).toEqual(["blocked", "cancelled", "in_progress"])
  })

  test("complete on evidence 'none' → completed with completedAt; publishes task.completed { taskId } only", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    w.clock.advance({ minutes: 30 })
    const r = await w.req("POST", `/v1/tasks/${t.id}/complete`, w.staff, { version: 1 })
    expect(r.status).toBe(200)
    const j = await w.json(r)
    expect(j.status).toBe("completed")
    expect(j.completedAt).toBe("2026-11-16T09:30:00")
    expect(j.version).toBe(2)
    const ev = await w.q("select type, payload from domain_events where type like 'task.%' and type <> 'task.created' order by occurred_at, id")
    expect(ev).toEqual([{ type: "task.completed", payload: { taskId: t.id } }])
    // completing again is not a valid move
    expect(await code(await w.req("POST", `/v1/tasks/${t.id}/complete`, w.staff, { version: 2 }))).toBe("invalid_transition")
  })

  test("complete on a Required task with no evidence yet is 422 evidence_required (files arrive in T4.6); a manager outside the task cannot complete it as a stranger", async () => {
    const w = await world()
    const rule = { mode: "required", types: ["photo"], min: 1, instruction: "", review: "manager" }
    const t = await w.mk(w.owner, { evidenceRule: rule })
    expect(t.evidenceState).toBe("missing")
    const r = await w.req("POST", `/v1/tasks/${t.id}/complete`, w.staff, { version: 1 })
    expect(r.status).toBe(422)
    expect(await code(r)).toBe("evidence_required")
    expect((await w.q("select status, version from tasks"))[0]).toEqual({ status: "not_started", version: 1 })
    // a bad rule is 422
    expect(await code(await w.req("POST", "/v1/tasks", w.owner, w.base({ evidenceRule: { ...rule, types: [] } })))).toBe("invalid_evidence_rule")
    expect(await code(await w.req("POST", "/v1/tasks", w.owner, w.base({ evidenceRule: { ...rule, review: "named", reviewer: "usr_ghost" } })))).toBe("invalid_reviewer")
  })
})

describe("principals and modules", () => {
  test("api key with tasks:read (staff creator) lists only the creator's tasks; tasks:read cannot POST (403); a write by key is recorded as apikey:<id> in history", async () => {
    const w = await world()
    await w.mk(w.owner, { title: "Mine", primary: w.staff.userId })
    await w.mk(w.owner, { title: "Theirs", primary: w.staff2.userId })
    const mint = (as: Who, scopes: string[]) => makeApiKey(w.deps, w.tenant.id, as.userId, scopes)
    const kRead = await mint(w.staff, ["tasks:read"])
    const bearer = (k: string) => ({ authorization: `Bearer ${k}` })
    const listed = await w.json(await call(w.app, "GET", "/v1/tasks", { headers: bearer(kRead.key) }))
    expect((listed.items as Json[]).map((i) => i.title)).toEqual(["Mine"])
    const denied = await call(w.app, "POST", "/v1/tasks", { headers: bearer(kRead.key), body: w.base() })
    expect(denied.status).toBe(403)
    // the creator's scope, not the key's: staff-home creator → own scope even though the key is "all" for nobody
    const kWrite = await mint(w.staff, ["tasks:write"])
    const created = await call(w.app, "POST", "/v1/tasks", { headers: bearer(kWrite.key), body: w.base({ primary: undefined, title: "By key" }) })
    expect(created.status, await created.clone().text()).toBe(201)
    const t = await w.json(created)
    expect(t.assignee).toBe(w.staff.userId) // me = the creator
    expect(t.creator).toBe(w.staff.userId)
    const [h] = await w.q("select actor_id from task_history where task_id = $1", [t.id])
    expect(h.actor_id).toBe(`apikey:${kWrite.id}`)
    const forStaff2 = await call(w.app, "POST", "/v1/tasks", { headers: bearer(kWrite.key), body: w.base({ primary: w.staff2.userId }) })
    expect(await code(forStaff2)).toBe("cannot_assign_others")
    // a key minted by a team manager sees that manager's team
    await w.manages(w.manager, w.staff)
    const kMgr = await mint(w.manager, ["tasks:read"])
    const mgrList = await w.json(await call(w.app, "GET", "/v1/tasks", { headers: bearer(kMgr.key) }))
    expect((mgrList.items as Json[]).map((i) => i.title).sort()).toEqual(["By key", "Mine"])
  })

  test("removing M1 → 403 module_not_entitled within 60 s; rows untouched; re-enable → 200", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    expect((await w.req("GET", `/v1/tasks/${t.id}`, w.owner)).status).toBe(200) // cached now
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    for (const [m, p, b] of [["GET", "/v1/tasks", undefined], ["GET", `/v1/tasks/${t.id}`, undefined], ["POST", "/v1/tasks", w.base()], ["PATCH", `/v1/tasks/${t.id}`, { version: 1, title: "x" }]] as [string, string, unknown][]) {
      const r = await w.req(m, p, w.owner, b)
      expect(r.status, `${m} ${p}`).toBe(403)
      expect(await code(r)).toBe("module_not_entitled")
    }
    expect((await w.q("select count(*)::int n from tasks"))[0].n).toBe(1)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    expect((await w.req("GET", `/v1/tasks/${t.id}`, w.owner)).status).toBe(200)
  })

  test("without drive access, Drive URLs in the description come back as 'Google Drive link' on every response; with access they are intact", async () => {
    const w = await world()
    const url = "https://drive.google.com/file/d/abc123/view"
    const desc = `Instructions at ${url} please`
    const t = await w.mk(w.owner, { description: desc })
    expect(t.description).toBe(desc)
    const all = async () => [
      (await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))).description,
      (await w.json(await w.req("GET", "/v1/tasks", w.owner))).items[0].description,
      (await w.json(await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, priority: 3 }))).description,
    ]
    expect(await all()).toEqual([desc, desc, desc])
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    const created = await w.json(await w.req("POST", "/v1/tasks", w.owner, w.base({ description: desc, title: "second" })))
    expect(created.description).toBe("Instructions at Google Drive link please")
    expect((await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))).description).toBe("Instructions at Google Drive link please")
    expect(((await w.json(await w.req("GET", "/v1/tasks", w.owner))).items as Json[]).every((i) => !String(i.description).includes("drive.google.com"))).toBe(true)
    expect((await w.q("select description from tasks where id = $1", [t.id]))[0].description).toBe(desc) // stored as written
    // an API key has no device: Drive text is withheld for it too
    const key = await w.json(await w.req("POST", "/v1/api-keys", w.owner, { name: "k", scopes: ["tasks:read"] }))
    const viaKey = await w.json(await call(w.app, "GET", `/v1/tasks/${t.id}`, { headers: { authorization: `Bearer ${key.key}` } }))
    expect(viaKey.description).toBe("Instructions at Google Drive link please")
  })
})

describe("events, applyTaskUpdate and RLS", () => {
  test("task events carry ids only (no title, description or names)", async () => {
    const w = await world()
    const t = await w.mk(w.owner, { title: "Secret-Title-77", description: "Secret-Desc-77" })
    await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, title: "Secret-Title-78", labels: ["secret-label"] })
    await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.owner, { version: 2, primary: w.staff2.userId, others: [w.staff.userId] })
    await w.req("POST", `/v1/tasks/${t.id}/status`, w.staff2, { version: 3, to: "in_progress" })
    await w.req("POST", `/v1/tasks/${t.id}/complete`, w.staff2, { version: 4 })
    const ev = await w.q("select type, payload, actor_id from domain_events where type like 'task.%' order by occurred_at, id")
    expect(ev.map((e) => e.type).sort()).toEqual(["task.assigned", "task.completed", "task.created", "task.status_changed", "task.updated"])
    const text = JSON.stringify(ev)
    for (const secret of ["Secret-Title", "Secret-Desc", "secret-label", "Test Member", "@x.ie"]) expect(text).not.toContain(secret)
    const byType = Object.fromEntries(ev.map((e) => [e.type as string, e.payload as Json]))
    const keys = Object.fromEntries(ev.map((e) => [e.type, Object.keys(e.payload as Json).sort()]))
    expect(keys).toEqual({
      "task.created": ["parentId", "projectId", "seriesId", "taskId"],
      "task.updated": ["fields", "historyId", "taskId"],
      "task.assigned": ["added", "removed", "taskId"],
      "task.status_changed": ["from", "taskId", "to"],
      "task.completed": ["taskId"],
    })
    expect(byType["task.updated"].fields).toEqual(["title", "labels"])
  })

  test("applyTaskUpdate is idempotent by update id, logs time, and never completes a Required task without evidence", async () => {
    const w = await world()
    const plain = await w.mk(w.owner, { title: "Plain" })
    const req = await w.mk(w.owner, { title: "Needs proof", evidenceRule: { mode: "required", types: ["photo"], min: 1, instruction: "", review: "manager" } })
    const ctx = ctxFor(w, w.staff)
    const up = (id: string, ref: string, over: Json = {}) => ({ id, tenantId: w.tenant.id, ref, itemStatus: "done" as const, minutes: 15, note: "all good", at: "2026-11-16T09:30", by: "Test Member", source: "shift report Day patrol, 2026-11-16", ...over })
    const run = (u: ReturnType<typeof up>) => withTenant(w.deps.db, w.tenant.id, (tx) => applyTaskUpdate(tx, ctx, u))
    expect(await run(up("sr-1:plain", plain.ref))).toBe("applied")
    expect(await run(up("sr-1:plain", plain.ref))).toBe("duplicate")
    expect((await w.q("select status, version, completed_at from tasks where id = $1", [plain.id]))[0]).toMatchObject({ status: "completed", version: 2 })
    expect(await w.q("select minutes, update_id, user_id from task_time_entries")).toEqual([{ minutes: 15, update_id: "sr-1:plain", user_id: w.staff.userId }])
    expect(await run(up("sr-1:req", req.ref))).toBe("applied")
    expect(await run(up("sr-1:req", req.ref))).toBe("duplicate")
    expect((await w.q("select status from tasks where id = $1", [req.id]))[0].status).toBe("not_started") // stays open
    const [line] = await w.q("select text, notified, update_id from task_history where task_id = $1 and update_id = 'sr-1:req'", [req.id])
    expect(line.text).toContain("Report marked done; evidence still needed")
    expect(line.notified).toEqual([])
    expect((await w.q("select count(*)::int n from task_time_entries"))[0].n).toBe(2)
    // a snooze logs a line only; zero minutes logs no time entry; an in_progress report moves the status
    expect(await run(up("sr-2:snooze", req.ref, { snooze: true, minutes: 0 }))).toBe("applied")
    expect(await run(up("sr-3:prog", req.ref, { itemStatus: "in_progress", minutes: 0 }))).toBe("applied")
    expect((await w.q("select status from tasks where id = $1", [req.id]))[0].status).toBe("in_progress")
    expect((await w.q("select count(*)::int n from task_time_entries"))[0].n).toBe(2)
    // an archived task is skipped; an unknown ref is 404
    await w.q("update tasks set archived_at = now() where id = $1", [plain.id])
    expect(await run(up("sr-4:arch", plain.ref))).toBe("skipped_archived")
    await expect(run(up("sr-5:none", "TSK-9999"))).rejects.toMatchObject({ code: "task_not_found" })
  })

  test("RLS: a tenant-A tx cannot read or insert tenant-B task rows (error on .cause)", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    await ownerTenantQuery(other.id, `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id) values ($1, 1000, 'B secret', $2::jsonb, now(), now(), now(), now(), $3)`, [other.id, JSON.stringify(NO_EVIDENCE), ob.userId])
    await w.mk(w.owner)
    const rows = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(sql`select title from tasks`))
    expect(rows.rows.map((r) => r.title)).not.toContain("B secret")
    expect(rows.rows).toHaveLength(1)
    const err = await withTenant(w.deps.db, w.tenant.id, (tx) =>
      tx.execute(sql`insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at) values (${other.id}, 1001, 'x', ${JSON.stringify(NO_EVIDENCE)}::jsonb, now(), now(), now(), now())`),
    ).catch((e) => e)
    expect(String(err?.cause?.message ?? "")).toMatch(/row-level security/)
    const err2 = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(sql`insert into task_counters (tenant_id) values (${other.id})`)).catch((e) => e)
    expect(String(err2?.cause?.message ?? "")).toMatch(/row-level security/)
  })

  test("erasure: the DSR handler exports the subject's tasks and history, and erase nulls creator and actor and removes their assignments", async () => {
    const w = await world()
    const t1 = await w.mk(w.owner, { primary: w.staff.userId, title: "Assigned to staff" })
    const t2 = await w.mk(w.staff, { primary: undefined, title: "Created by staff" })
    await w.req("POST", `/v1/tasks/${t1.id}/status`, w.staff, { version: 1, to: "in_progress" })
    const { dsrHandlers, registerDsrHandler: reg } = await import("../gdpr/registry")
    const { tasksDsrHandler } = await import("./dsr")
    reg("tasks", tasksDsrHandler)
    const handler = dsrHandlers().find(([m]) => m === "tasks")![1]
    const exp = (await withTenant(w.deps.db, w.tenant.id, (tx) => handler.export(tx, w.tenant.id, w.staff.userId))) as Json
    expect(exp.tasks.map((t: Json) => t.ref).sort()).toEqual([t1.ref, t2.ref])
    expect(exp.tasks.find((t: Json) => t.ref === t1.ref)).toMatchObject({ title: "Assigned to staff", role: expect.arrayContaining(["assignee"]) })
    expect(exp.history.length).toBeGreaterThanOrEqual(2) // the status line they wrote and their own "created" line
    await withTenant(w.deps.db, w.tenant.id, (tx) => handler.erase(tx, w.tenant.id, w.staff.userId, w.clock.now()))
    await withTenant(w.deps.db, w.tenant.id, (tx) => handler.erase(tx, w.tenant.id, w.staff.userId, w.clock.now())) // idempotent
    expect((await w.q("select creator_id from tasks where id = $1", [t2.id]))[0].creator_id).toBeNull()
    expect((await w.q("select count(*)::int n from task_assignees where user_id = $1", [w.staff.userId]))[0].n).toBe(0)
    expect((await w.q("select count(*)::int n from task_history where actor_id = $1", [w.staff.userId]))[0].n).toBe(0)
    expect((await w.q("select actor_id from task_history where task_id = $1 and kind = 'status'", [t1.id]))[0].actor_id).toBeNull()
  })
})

describe("review fixes (I1, M2, M3, M5, E2)", () => {
  test("I1: Drive URLs in old and new description values do not leak through history, the detail timeline or the PATCH response without Drive access", async () => {
    const w = await world()
    const url = "https://drive.google.com/file/d/abc123/view"
    const t = await w.mk(w.owner, { description: "plain" })
    w.clock.advance({ minutes: 1 })
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, description: `See ${url}` })).status).toBe(200)
    w.clock.advance({ minutes: 1 })
    // with access: intact (the stored change really holds the URL)
    expect(JSON.stringify(await w.json(await w.req("GET", `/v1/tasks/${t.id}/history`, w.owner)))).toContain("drive.google.com")
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    const hist = await w.json(await w.req("GET", `/v1/tasks/${t.id}/history`, w.owner))
    expect(JSON.stringify(hist)).not.toContain("drive.google.com")
    expect(JSON.stringify(hist)).toContain("Google Drive link")
    expect(JSON.stringify(await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner)))).not.toContain("drive.google.com")
    const patched = await w.json(await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 2, title: `Look ${url}` }))
    expect(JSON.stringify(patched)).not.toContain("drive.google.com")
    // an API key has no device: withheld too
    const k = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["tasks:read"])
    const viaKey = await call(w.app, "GET", `/v1/tasks/${t.id}/history`, { headers: { authorization: `Bearer ${k.key}` } })
    expect(JSON.stringify(await viaKey.json())).not.toContain("drive.google.com")
  })

  test("M2: applyTaskUpdate answers task_not_found for an unknown ref, an out-of-scope task and a non-assignee, before any duplicate/archived answer", async () => {
    const w = await world()
    const t = await w.mk(w.owner) // assigned to staff
    const up = (id: string, ref: string) => ({ id, tenantId: w.tenant.id, ref, itemStatus: "in_progress" as const, minutes: 0, note: "", at: "2026-11-16T09:30", by: "x", source: "report" })
    const as = (who: Who, scope: TaskCtx["scope"], u: ReturnType<typeof up>) => withTenant(w.deps.db, w.tenant.id, (tx) => applyTaskUpdate(tx, { ...ctxFor(w, who), scope }, u))
    expect(await as(w.staff, { kind: "own", personId: w.staff.userId }, up("a1", t.ref))).toBe("applied")
    // staff2 sees nothing of it (own scope): the same 404 as a ref that does not exist, even for a duplicate id or an archived task
    await w.q("update tasks set archived_at = now() where id = $1", [t.id])
    for (const ref of [t.ref, "TSK-9999"]) {
      await expect(as(w.staff2, { kind: "own", personId: w.staff2.userId }, up("a1", ref))).rejects.toMatchObject({ code: "task_not_found" })
    }
    // an all-scope non-assignee without manage rights (staff-home role) is refused the same way
    await expect(as(w.staff2, { kind: "all" }, up("a1", t.ref))).rejects.toMatchObject({ code: "task_not_found" })
    expect(await as(w.staff, { kind: "own", personId: w.staff.userId }, up("a1", t.ref))).toBe("duplicate")
  })

  test("M3: app_user holds minimal grants on the task tables (no DELETE on counters and history, history UPDATE only actor_id and notified)", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("task_counters")).toEqual(["INSERT", "SELECT"])
    expect(await col("task_counters")).toEqual(["next_no"])
    expect(await tbl("task_history")).toEqual(["INSERT", "SELECT"])
    expect(await col("task_history")).toEqual(["actor_id", "notified"])
    expect(await tbl("task_time_entries")).toEqual(["INSERT", "SELECT"])
    expect(await col("task_time_entries")).toEqual(["user_id"])
    expect(await tbl("task_assignees")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await tbl("tasks")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("tasks")).not.toContain("tenant_id")
    expect(await col("tasks")).not.toContain("ref_no")
    expect(await col("tasks")).not.toContain("id")
    const w = await world()
    const t = await w.mk(w.owner)
    const code42501 = (e: unknown) => (e as { cause?: { code?: string } })?.cause?.code
    for (const stmt of [sql`delete from task_history`, sql`update task_history set text = 'x'`, sql`delete from task_counters`, sql`update tasks set ref_no = 5`]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect(code42501(err), String(stmt)).toBe("42501")
    }
    void t
  })

  test("M5: the own-scope and team-scope list queries also avoid a sequential scan at 4001 rows", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await w.mk(w.owner)
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id)
       select $1::uuid, 2000 + g, 'Seed ' || g, $2::jsonb, now(), date_trunc('milliseconds', now()) + (g || ' minutes')::interval, now(), now(), $3 from generate_series(1, 4000) g`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE), w.owner.userId],
    )
    await w.q("insert into task_assignees (tenant_id, task_id, user_id, is_primary) select tenant_id, id, $1, true from tasks where ref_no >= 2000 and ref_no % 40 = 0", [w.staff.userId])
    await w.q("insert into task_assignees (tenant_id, task_id, user_id, is_primary) select tenant_id, id, $1, true from tasks where ref_no % 40 = 1", [w.staff2.userId])
    await ownerQuery("analyze tasks")
    await ownerQuery("analyze task_assignees")
    const explain = async (scope: TaskCtx["scope"], reports: string[], me: string) => {
      const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me, actorId: me, role: null as never, scope, reports, drive: true, now: w.clock.now() }
      const { sql: text, params } = await withTenant(w.deps.db, w.tenant.id, async (tx) => buildListQuery(tx, ctx, {}, 26).toSQL())
      const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
      await c.connect()
      try {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
        const rows = (await c.query(`explain ${text}`, params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
        await c.query("rollback")
        return rows
      } finally {
        await c.end()
      }
    }
    const own = await explain({ kind: "own", personId: w.staff.userId }, [], w.staff.userId)
    const team = await explain({ kind: "team", managerId: w.manager.userId }, [w.staff.userId], w.manager.userId)
    for (const [name, plan] of [["own", own], ["team", team]] as const) {
      expect(plan, `${name}\n${plan}`).not.toMatch(/Seq Scan on tasks/)
      expect(plan, `${name}\n${plan}`).toMatch(/tasks_live_due_idx|tasks_live_status_due_idx|tasks_pkey|task_assignees_user_idx/)
    }
    // and the answers are right: staff see only their 100 of 4001 tasks
    const mine = await w.json(await w.req("GET", "/v1/tasks?limit=100", w.staff))
    expect(mine.items).toHaveLength(100)
  }, 60_000)

  test("E2: a team-scope manager assigns only themself or direct reports (assignee_out_of_scope), all-scope managers anyone; staff unchanged", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const out = await w.req("POST", "/v1/tasks", w.manager, w.base({ primary: w.staff2.userId }))
    expect(out.status).toBe(422)
    expect(await code(out)).toBe("assignee_out_of_scope")
    expect(await code(await w.req("POST", "/v1/tasks", w.manager, w.base({ primary: w.staff.userId, others: [w.staff2.userId] })))).toBe("assignee_out_of_scope")
    expect(await code(await w.req("POST", "/v1/tasks", w.manager, w.base({ primary: "usr_ghost" })))).toBe("assignee_out_of_scope") // no oracle: any outsider alike
    const ok = await w.json(await w.req("POST", "/v1/tasks", w.manager, w.base({ primary: w.staff.userId, others: [w.manager.userId] })))
    expect(ok.assignee).toBe(w.staff.userId)
    expect((await w.req("POST", "/v1/tasks", w.manager, w.base({ primary: w.manager.userId }))).status).toBe(201) // themself
    // PUT /assignees follows the same rule
    expect(await code(await w.req("PUT", `/v1/tasks/${ok.id}/assignees`, w.manager, { version: 1, primary: w.staff.userId, others: [w.staff2.userId] }))).toBe("assignee_out_of_scope")
    expect((await w.req("PUT", `/v1/tasks/${ok.id}/assignees`, w.manager, { version: 1, primary: w.manager.userId, others: [w.staff.userId] })).status).toBe(200)
    // all-scope managers: anyone (an invalid id is still invalid_assignee)
    expect((await w.req("POST", "/v1/tasks", w.ops, w.base({ primary: w.staff2.userId, others: [w.manager.userId] }))).status).toBe(201)
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ primary: "usr_ghost" })))).toBe("invalid_assignee")
    // staff: themselves only
    expect(await code(await w.req("POST", "/v1/tasks", w.staff, w.base({ primary: w.staff2.userId })))).toBe("cannot_assign_others")
  })
})

// ---------- T4.2: checklists, subtasks, comments, task uploads and search ----------

describe("collaboration (T4.2)", () => {
  beforeEach(() => {
    resetSubscribers()
    registerNotifications()
    registerFiles()
    registerSearchIndexers()
  })
  afterEach(resetSubscribers)

  const drain = async (w: W) => {
    for (let i = 0; i < 6 && w.queue.jobs.length > 0; i++) for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
  }
  const relay = async (w: W) => {
    for (let i = 0; i < 5 && (await relayOnce(w.deps)) > 0; i++);
  }
  const addItem = async (w: W, as: Who, taskId: string, text: string) => {
    const r = await w.req("POST", `/v1/tasks/${taskId}/checklist`, as, { text })
    expect(r.status, await r.clone().text()).toBe(201)
    return w.json(r)
  }
  /** Intent → browser-style PUT → complete → (optionally) scan jobs. Returns the file id. */
  const attach = async (w: W, as: Who, taskId: string, o: { purpose?: string; content?: string; mime?: string; name?: string; scan?: boolean } = {}) => {
    const buf = Buffer.from(o.content ?? "hello pdf")
    const r = await w.req("POST", `/v1/tasks/${taskId}/uploads`, as, { purpose: o.purpose ?? "attachment", name: o.name ?? "a.pdf", mime: o.mime ?? "application/pdf", sizeBytes: buf.length })
    expect(r.status, await r.clone().text()).toBe(201)
    const j = await w.json(r)
    const { "Content-Length": _len, ...headers } = j.upload.headers as Record<string, string>
    expect((await fetch(j.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
    expect((await w.req("POST", `/v1/tasks/${taskId}/uploads/${j.fileId}/complete`, as)).status).toBe(200)
    if (o.scan !== false) await drain(w)
    return j.fileId as string
  }

  test("concurrent checklist ticks on different items both persist (no lost update)", async () => {
    const w = await world()
    const t = await w.mk(w.ops) // staff is the assignee, ops the creator and manager
    const a = await addItem(w, w.ops, t.id, "Item A")
    const b = await addItem(w, w.ops, t.id, "Item B")
    const c = await addItem(w, w.ops, t.id, "Item C")
    const rs = await Promise.all([
      w.req("PATCH", `/v1/tasks/${t.id}/checklist/${a.id}`, w.staff, { done: true }),
      w.req("PATCH", `/v1/tasks/${t.id}/checklist/${b.id}`, w.ops, { done: true }),
      w.req("PATCH", `/v1/tasks/${t.id}/checklist/${c.id}`, w.owner, { done: true }),
    ])
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200])
    const rows = await w.q("select text, done, done_by from task_checklist_items order by position")
    expect(rows.map((r) => r.done)).toEqual([true, true, true])
    expect(rows.map((r) => r.done_by)).toEqual([w.staff.userId, w.ops.userId, w.owner.userId])
    const detail = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))
    expect(detail.checklist.map((i: Json) => [i.text, i.done])).toEqual([["Item A", true], ["Item B", true], ["Item C", true]])
  })

  test("checklist ticks do not bump task.version; a PATCH at the old version still succeeds; done is absolute", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const item = await addItem(w, w.ops, t.id, "Walk the corridor")
    for (let i = 0; i < 2; i++) {
      const r = await w.json(await w.req("PATCH", `/v1/tasks/${t.id}/checklist/${item.id}`, w.staff, { done: true })) // twice: absolute, never a toggle
      expect(r.done).toBe(true)
    }
    expect((await w.json(await w.req("PATCH", `/v1/tasks/${t.id}/checklist/${item.id}`, w.staff, { done: false }))).done).toBe(false)
    expect((await w.q("select version from tasks where id = $1", [t.id]))[0].version).toBe(1)
    const p = await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, priority: 3 })
    expect(p.status, await p.clone().text()).toBe(200)
    expect((await w.json(p)).version).toBe(2)
  })

  test("checklist rules: 50 items at most, text only for the creator or a manager, delete for the creator or a manager, out of scope is 404", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const item = await addItem(w, w.ops, t.id, "First")
    expect((await w.req("PATCH", `/v1/tasks/${t.id}/checklist/${item.id}`, w.staff, { text: "Edited" })).status).toBe(403) // assignee, not creator
    expect((await w.req("DELETE", `/v1/tasks/${t.id}/checklist/${item.id}`, w.staff)).status).toBe(403)
    expect((await w.json(await w.req("PATCH", `/v1/tasks/${t.id}/checklist/${item.id}`, w.ops, { text: "Edited" }))).text).toBe("Edited")
    expect((await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.staff, { text: "mine" })).status).toBe(201) // an assignee may add
    for (const [m, p, b] of [["POST", `/v1/tasks/${t.id}/checklist`, { text: "x" }], ["PATCH", `/v1/tasks/${t.id}/checklist/${item.id}`, { done: true }], ["DELETE", `/v1/tasks/${t.id}/checklist/${item.id}`, undefined]] as [string, string, unknown][]) {
      const r = await w.req(m, p, w.staff2, b)
      expect(r.status, `${m} ${p}`).toBe(404)
      expect(await code(r)).toBe("task_not_found")
    }
    await w.q("insert into task_checklist_items (tenant_id, task_id, text, position) select $1, $2, 'bulk ' || g, 100 + g from generate_series(1, 48) g", [w.tenant.id, t.id]) // now 50
    const over = await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.ops, { text: "one too many" })
    expect(over.status).toBe(422)
    expect(await code(over)).toBe("checklist_limit")
    expect((await w.req("DELETE", `/v1/tasks/${t.id}/checklist/${item.id}`, w.ops)).status).toBe(204)
    expect((await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.ops, { text: "fits now" })).status).toBe(201)
  })

  test("subtask copies team, assignee, project and due; a subtask of a subtask → 422 subtask_depth; the parent's version is untouched", async () => {
    const w = await world()
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Cleaning", kind: "department" }))
    const parent = await w.mk(w.ops, { teamId: dept.id, due: "2026-12-01T17:00:00" })
    await w.q("update tasks set project_id = gen_random_uuid() where id = $1", [parent.id]) // projects arrive with T4.3
    const [{ project_id: projectId }] = await w.q("select project_id from tasks where id = $1", [parent.id])
    const r = await w.req("POST", `/v1/tasks/${parent.id}/subtasks`, w.ops, { title: "Walk floor 1" })
    expect(r.status, await r.clone().text()).toBe(201)
    const child = await w.json(r)
    expect(child).toMatchObject({ parentId: parent.id, parentRef: parent.ref, teamId: dept.id, dept: "Cleaning", assignee: staffId(w), dueAt: parent.dueAt, projectId, title: "Walk floor 1", status: "not_started", creator: w.ops.userId })
    expect(child.evidenceRule.mode).toBe("none")
    expect(child.ref).not.toBe(parent.ref)
    const deeper = await w.req("POST", `/v1/tasks/${child.id}/subtasks`, w.ops, { title: "grandchild" })
    expect(deeper.status).toBe(422)
    expect(await code(deeper)).toBe("subtask_depth")
    const again = await w.json(await w.req("GET", `/v1/tasks/${parent.id}`, w.ops))
    expect(again.version).toBe(1)
    expect(again.subtasks.map((s: Json) => s.ref)).toEqual([child.ref])
    expect((await w.q("select count(*)::int n from tasks"))[0].n).toBe(2)
    // staff may add a subtask under their own task and get it assigned to themselves; a stranger gets 404
    const own = await w.json(await w.req("POST", "/v1/tasks", w.staff, w.base({ primary: undefined })))
    const mine = await w.json(await w.req("POST", `/v1/tasks/${own.id}/subtasks`, w.staff, { title: "step" }))
    expect(mine.assignee).toBe(w.staff.userId)
    expect(await code(await w.req("POST", `/v1/tasks/${own.id}/subtasks`, w.staff2, { title: "x" }))).toBe("task_not_found")
  })
  const staffId = (w: W) => w.staff.userId

  test("comment with @mention notifies a mentioned member who can see the task; a member who cannot see it gets nothing and the response is still 201", async () => {
    const w = await world()
    const t = await w.mk(w.owner) // staff assigned; staff2 has no access; ops (all scope) can see it
    const r = await w.req("POST", `/v1/tasks/${t.id}/comments`, w.staff, { body: "Please look @ops and @staff2", mentions: [w.ops.userId, w.staff2.userId, "usr_ghost_000"] })
    expect(r.status, await r.clone().text()).toBe(201)
    const c = await w.json(r)
    expect(c.mentions).toEqual([w.ops.userId, w.staff2.userId, "usr_ghost_000"]) // echoed as sent: the answer cannot tell who could see it
    expect(c.author).toBeTruthy()
    const inbox = (u: Who) => w.q("select title from notifications where user_id = $1 and kind = 'task' and title <> 'New task' order by title", [u.userId])
    expect((await inbox(w.ops)).map((n) => n.title)).toEqual(["You were mentioned"])
    expect(await inbox(w.staff2)).toEqual([])
    expect((await inbox(w.owner)).map((n) => n.title)).toEqual(["New comment"]) // the creator hears about it
    expect(await inbox(w.staff)).toEqual([]) // never the author
    const detail = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))
    expect(JSON.stringify(detail.timeline)).not.toContain(w.staff2.userId) // the history line carries no recipients
    const listed = await w.json(await w.req("GET", `/v1/tasks/${t.id}/comments`, w.staff))
    expect(listed.items.map((i: Json) => i.id)).toEqual([c.id])
    // staff2 still cannot read or write comments: 404, same as any unknown task
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/comments`, w.staff2))).toBe("task_not_found")
    expect(await code(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.staff2, { body: "hi" }))).toBe("task_not_found")
  })

  test("comments: list pages oldest first with a cursor; authors and managers delete, others get 403; deleted ones disappear; bad cursor 400", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const ids: string[] = []
    for (const body of ["one", "two", "three"]) {
      w.clock.advance({ minutes: 1 })
      ids.push((await w.json(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.staff, { body }))).id)
    }
    const p1 = await w.json(await w.req("GET", `/v1/tasks/${t.id}/comments?limit=2`, w.owner))
    expect(p1.items.map((i: Json) => i.body)).toEqual(["one", "two"])
    const p2 = await w.json(await w.req("GET", `/v1/tasks/${t.id}/comments?limit=2&cursor=${p1.nextCursor}`, w.owner))
    expect(p2.items.map((i: Json) => i.body)).toEqual(["three"])
    expect(p2.nextCursor).toBeNull()
    expect((await w.req("GET", `/v1/tasks/${t.id}/comments?cursor=zzz`, w.owner)).status).toBe(400)
    w.clock.advance({ minutes: 1 })
    const other = await w.json(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.ops, { body: "from ops" }))
    expect((await w.req("DELETE", `/v1/tasks/${t.id}/comments/${other.id}`, w.staff)).status).toBe(403) // not the author, not a manager
    expect((await w.req("DELETE", `/v1/tasks/${t.id}/comments/${ids[0]}`, w.staff)).status).toBe(204) // own
    expect((await w.req("DELETE", `/v1/tasks/${t.id}/comments/${ids[1]}`, w.ops)).status).toBe(204) // a manager
    expect(await code(await w.req("DELETE", `/v1/tasks/${t.id}/comments/${ids[1]}`, w.ops))).toBe("comment_not_found") // already gone
    const left = await w.json(await w.req("GET", `/v1/tasks/${t.id}/comments`, w.owner))
    expect(left.items.map((i: Json) => i.body)).toEqual(["three", "from ops"])
    expect((await w.q("select count(*)::int n from task_comments"))[0].n).toBe(4) // soft delete
    expect((await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))).version).toBe(1) // comments never bump the version
  })

  test("comment body Drive URLs are withheld off the company PC (and stay intact in storage and with access)", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const url = "https://drive.google.com/file/d/abc123/view"
    const body = `Plan at ${url} thanks`
    const posted = await w.json(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.owner, { body }))
    expect(posted.body).toBe(body)
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    const listed = await w.json(await w.req("GET", `/v1/tasks/${t.id}/comments`, w.owner))
    expect(listed.items[0].body).toBe("Plan at Google Drive link thanks")
    const second = await w.json(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.owner, { body }))
    expect(second.body).toBe("Plan at Google Drive link thanks")
    expect((await w.q("select body from task_comments order by created_at, id"))[0].body).toBe(body)
  })

  test("attachment upload via the task intent works for a tenant without M4 and without files:write; the comment can carry it", async () => {
    const w = await world()
    const t = await w.mk(w.owner) // staff: employee role, files none
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M4', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    expect((await w.req("POST", "/v1/files/uploads", w.staff, { name: "a.pdf", mime: "application/pdf", sizeBytes: 9 })).status).toBe(403) // the ordinary intent is closed to them
    const fileId = await attach(w, w.staff, t.id)
    const row = (await w.q("select purpose, status, owner_user_id from files where id = $1", [fileId]))[0]
    expect(row).toMatchObject({ purpose: "task_attachment", status: "clean", owner_user_id: w.staff.userId })
    expect(await w.q("select purpose, task_id from task_files where file_id = $1", [fileId])).toEqual([{ purpose: "task_attachment", task_id: t.id }])
    const c = await w.req("POST", `/v1/tasks/${t.id}/comments`, w.staff, { body: "see file", attachmentFileIds: [fileId] })
    expect(c.status, await c.clone().text()).toBe(201)
    expect((await w.json(c)).attachmentFileIds).toEqual([fileId])
    const bad = await w.req("POST", `/v1/tasks/${t.id}/comments`, w.staff, { body: "x", attachmentFileIds: [crypto.randomUUID()] })
    expect(await code(bad)).toBe("invalid_attachment")
    const dl = await call(w.app, "GET", `/v1/tasks/${t.id}/files/${fileId}/download`, { cookie: w.staff.cookie, tenant: "acme" })
    expect(dl.status).toBe(302)
    expect(dl.headers.get("location")).toContain(fileId)
  })

  test("GET /v1/files/{id} and /download for a task_% file → 404 file_not_found even with files:read", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const fileId = await attach(w, w.owner, t.id)
    for (const [m, p] of [["GET", `/v1/files/${fileId}`], ["GET", `/v1/files/${fileId}/download`], ["POST", `/v1/files/${fileId}/complete`], ["DELETE", `/v1/files/${fileId}`]]) {
      const r = await w.req(m, p, w.owner) // the owner holds files:write
      expect(r.status, `${m} ${p}`).toBe(404)
      expect(await code(r)).toBe("file_not_found")
    }
    expect((await w.q("select status from files where id = $1", [fileId]))[0].status).toBe("clean") // untouched by the attempts above
    await relay(w)
    expect(await w.q("select 1 from search_documents where entity = 'file'")).toEqual([]) // task files are not searchable by name
  })

  test("task file download needs task access: out of scope → 404 task_not_found; another task's fileId → 404 file_not_found; not scanned → 409; infected → 410", async () => {
    const w = await world()
    const t1 = await w.mk(w.owner)
    const t2 = await w.mk(w.owner, { title: "second" })
    const f1 = await attach(w, w.staff, t1.id)
    const dl = (as: Who, task: string, file: string) => w.req("GET", `/v1/tasks/${task}/files/${file}/download`, as)
    expect((await dl(w.staff, t1.id, f1)).status).toBe(302)
    const out = await dl(w.staff2, t1.id, f1)
    expect(out.status).toBe(404)
    expect(await code(out)).toBe("task_not_found")
    const cross = await dl(w.owner, t2.id, f1) // the file belongs to t1
    expect(cross.status).toBe(404)
    expect(await code(cross)).toBe("file_not_found")
    const pending = await attach(w, w.staff, t1.id, { scan: false })
    const np = await dl(w.staff, t1.id, pending)
    expect(np.status).toBe(409)
    expect(await code(np)).toBe("file_not_ready")
    const bad = await attach(w, w.staff, t1.id, { content: "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", mime: "text/plain", name: "x.txt" })
    const inf = await dl(w.staff, t1.id, bad)
    expect(inf.status).toBe(410)
    expect(await code(inf)).toBe("file_infected")
    // a stranger cannot complete or start uploads on it either
    expect(await code(await w.req("POST", `/v1/tasks/${t1.id}/uploads/${f1}/complete`, w.staff2))).toBe("task_not_found")
    expect(await code(await w.req("POST", `/v1/tasks/${t2.id}/uploads/${f1}/complete`, w.owner))).toBe("file_not_found")
    expect(await code(await w.req("POST", `/v1/tasks/${t1.id}/uploads`, w.staff2, { purpose: "attachment", name: "a.pdf", mime: "application/pdf", sizeBytes: 5 }))).toBe("task_not_found")
  })

  test("evidence purpose accepts video/mp4 up to TASK_VIDEO_MAX_BYTES; attachment purpose refuses video (422 mime_not_allowed); voice strips codec parameters", async () => {
    const w = await world({ env: { TASK_EVIDENCE_MAX_BYTES: 1000, TASK_VIDEO_MAX_BYTES: 5000, TASK_VOICE_MAX_BYTES: 3000 } })
    const t = await w.mk(w.ops)
    const intent = (as: Who, purpose: string, mime: string, sizeBytes: number) => w.req("POST", `/v1/tasks/${t.id}/uploads`, as, { purpose, name: "clip.mp4", mime, sizeBytes })
    expect((await intent(w.staff, "evidence", "video/mp4", 4000)).status).toBe(201)
    for (const m of ["video/quicktime", "video/webm"]) expect((await intent(w.staff, "evidence", m, 10)).status, m).toBe(201)
    const big = await intent(w.staff, "evidence", "video/mp4", 6000)
    expect(await code(big)).toBe("file_too_large")
    expect(await code(await intent(w.staff, "evidence", "application/pdf", 2000))).toBe("file_too_large") // non-video uses the evidence cap
    const refused = await intent(w.staff, "attachment", "video/mp4", 100)
    expect(refused.status).toBe(422)
    expect(await code(refused)).toBe("mime_not_allowed")
    expect(await code(await intent(w.staff, "evidence", "image/svg+xml", 100))).toBe("mime_not_allowed")
    expect(await code(await w.req("POST", "/v1/files/uploads", w.owner, { name: "c.mp4", mime: "video/mp4", sizeBytes: 100 }))).toBe("mime_not_allowed") // /v1/files never takes video
    // voice: creator or manager only; codec parameters are stripped and the signed type is the bare one
    expect((await intent(w.staff, "voice", "audio/webm", 100)).status).toBe(403)
    const v = await intent(w.ops, "voice", "audio/webm;codecs=opus", 100)
    expect(v.status, await v.clone().text()).toBe(201)
    expect((await w.json(v)).upload.headers["Content-Type"]).toBe("audio/webm")
    expect(await code(await intent(w.ops, "voice", "audio/webm", 4000))).toBe("file_too_large")
    expect(await code(await intent(w.ops, "voice", "audio/mpeg", 100))).toBe("mime_not_allowed")
  })

  test("every new task route is 404 task_not_found outside the caller's scope", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    const item = await addItem(w, w.owner, t.id, "x")
    const comment = await w.json(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.owner, { body: "c" }))
    const file = await attach(w, w.owner, t.id)
    const calls: [string, string, unknown][] = [
      ["POST", `/v1/tasks/${t.id}/checklist`, { text: "x" }], ["PATCH", `/v1/tasks/${t.id}/checklist/${item.id}`, { done: true }], ["DELETE", `/v1/tasks/${t.id}/checklist/${item.id}`, undefined],
      ["POST", `/v1/tasks/${t.id}/subtasks`, { title: "x" }], ["GET", `/v1/tasks/${t.id}/comments`, undefined], ["POST", `/v1/tasks/${t.id}/comments`, { body: "x" }],
      ["DELETE", `/v1/tasks/${t.id}/comments/${comment.id}`, undefined], ["POST", `/v1/tasks/${t.id}/uploads`, { purpose: "attachment", name: "a.pdf", mime: "application/pdf", sizeBytes: 5 }],
      ["POST", `/v1/tasks/${t.id}/uploads/${file}/complete`, undefined], ["GET", `/v1/tasks/${t.id}/files/${file}/download`, undefined],
    ]
    await w.manages(w.manager, w.staff2)
    for (const who of [w.staff2, w.manager]) {
      for (const [m, p, b] of calls) {
        const r = await w.req(m, p, who, b)
        expect(r.status, `${m} ${p}`).toBe(404)
        expect(await code(r)).toBe("task_not_found")
      }
    }
    expect((await w.q("select count(*)::int n from task_checklist_items"))[0].n).toBe(1)
    expect((await w.q("select count(*)::int n from tasks"))[0].n).toBe(1)
  })

  test("nested ids: A's task with B's commentId or itemId → 404 comment_not_found / checklist_item_not_found", async () => {
    const w = await world()
    const a = await w.mk(w.owner, { title: "Task A" })
    const b = await w.mk(w.owner, { title: "Task B" })
    const itemA = await addItem(w, w.owner, a.id, "A item")
    const itemB = await addItem(w, w.owner, b.id, "B item")
    const comB = await w.json(await w.req("POST", `/v1/tasks/${b.id}/comments`, w.owner, { body: "on B" }))
    const ghost = crypto.randomUUID()
    for (const [m, p, b2] of [
      ["PATCH", `/v1/tasks/${a.id}/checklist/${itemB.id}`, { done: true }], ["DELETE", `/v1/tasks/${a.id}/checklist/${itemB.id}`, undefined], ["PATCH", `/v1/tasks/${a.id}/checklist/${ghost}`, { done: true }],
    ] as [string, string, unknown][]) {
      const r = await w.req(m, p, w.owner, b2)
      expect(r.status, `${m} ${p}`).toBe(404)
      expect(await code(r)).toBe("checklist_item_not_found")
    }
    for (const id of [comB.id, ghost]) {
      const r = await w.req("DELETE", `/v1/tasks/${a.id}/comments/${id}`, w.owner)
      expect(r.status).toBe(404)
      expect(await code(r)).toBe("comment_not_found")
    }
    expect((await w.q("select done from task_checklist_items where id = $1", [itemB.id]))[0].done).toBe(false)
    expect((await w.q("select 1 from task_comments where id = $1 and deleted_at is null", [comB.id])).length).toBe(1)
    expect(itemA.id).toBeTruthy()
  })

  test("search: staff finds own task by ref and title, not a colleague's; team manager finds direct reports' tasks; owner finds all", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const t1 = await w.mk(w.owner, { primary: w.staff.userId, title: "Zebra fire exits" })
    const t2 = await w.mk(w.owner, { primary: w.staff2.userId, title: "Zebra stock count" })
    await relay(w)
    const titles = async (as: Who, q: string, extra = "") => (((await w.json(await w.req("GET", `/v1/search?q=${encodeURIComponent(q)}${extra}`, as))).hits as Json[]) ?? []).filter((h) => h.entity === "task").map((h) => h.title as string).sort()
    expect(await titles(w.staff, "zebra")).toEqual([`${t1.ref} Zebra fire exits`])
    expect(await titles(w.staff, "stock")).toEqual([]) // a colleague's task is not found, even by an exact word
    expect(await titles(w.staff, t1.ref)).toEqual([`${t1.ref} Zebra fire exits`])
    expect(await titles(w.staff, t2.ref)).not.toContain(`${t2.ref} Zebra stock count`) // the typo fallback may match their own task, never the colleague's
    expect(await titles(w.staff2, "zebra")).toEqual([`${t2.ref} Zebra stock count`])
    expect(await titles(w.manager, "zebra")).toEqual([`${t1.ref} Zebra fire exits`]) // a direct report's, not the other team's
    expect(await titles(w.owner, "zebra")).toEqual([`${t1.ref} Zebra fire exits`, `${t2.ref} Zebra stock count`])
    expect(await titles(w.ops, "zebra")).toHaveLength(2)
    const hit = ((await w.json(await w.req("GET", "/v1/search?q=zebra", w.owner))).hits as Json[]).find((h) => h.entity === "task")!
    expect(hit).toMatchObject({ entity: "task", module: "tasks" })
    // reassigning moves the task between audiences, archiving-style removal drops it
    expect((await w.req("PUT", `/v1/tasks/${t2.id}/assignees`, w.owner, { version: 1, primary: w.staff.userId, others: [] })).status).toBe(200)
    await relay(w)
    expect(await titles(w.staff, "zebra")).toEqual([`${t1.ref} Zebra fire exits`, `${t2.ref} Zebra stock count`])
    expect(await titles(w.staff2, "zebra")).toEqual([])
    await w.q("update tasks set archived_at = now() where id = $1", [t1.id])
    await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "task.archived", payload: { taskId: t1.id }, actorId: null }, w.clock.now()))
    await relay(w)
    expect(await titles(w.owner, "zebra")).toEqual([`${t2.ref} Zebra stock count`])
  })

  test("an API key cannot reach /v1/search at all (B3 deny-list), so no key can widen a task search; the scope still reads subjectUserId", async () => {
    const w = await world()
    await w.mk(w.owner, { primary: w.staff2.userId, title: "Quokka theirs" })
    await relay(w)
    const k = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["tasks:read"]) // minted by an all-scope owner
    const r = await call(w.app, "GET", "/v1/search?q=quokka", { headers: { authorization: `Bearer ${k.key}` } })
    expect(r.status).toBe(403)
    expect(await code(r)).toBe("api_key_forbidden_route")
  })

  test("search body never contains a Drive URL or an email", async () => {
    const w = await world()
    const url = "https://drive.google.com/file/d/abc123/view"
    await w.mk(w.owner, { title: "Mail ann@example.com", description: `See ${url} or write bob@example.org today`, labels: ["Safety", "fire"] })
    await relay(w)
    const [doc] = await w.q("select title, body, audience from search_documents where entity = 'task'")
    expect(doc.body).toContain("safety fire")
    expect(`${doc.title} ${doc.body}`).not.toMatch(/drive\.google\.com|@|example\.(com|org)/)
    expect(doc.audience).toEqual([w.owner.userId, w.staff.userId].sort())
    const long = await w.mk(w.owner, { title: "Longform", description: "word ".repeat(400) })
    await relay(w)
    const [d2] = await w.q("select body from search_documents where entity_id = $1", [long.id])
    expect((d2.body as string).length).toBeLessThanOrEqual(500)
  })

  test("grants: the new task tables carry minimal app_user privileges", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("task_checklist_items")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("task_checklist_items")).toEqual(["done", "done_at", "done_by", "position", "text"])
    expect(await tbl("task_comments")).toEqual(["INSERT", "SELECT"])
    expect(await col("task_comments")).toEqual(["author_id", "deleted_at", "mentions"])
    expect(await tbl("task_files")).toEqual(["INSERT", "SELECT"])
    expect(await col("task_files")).toEqual(["created_by"])
    const w = await world()
    const t = await w.mk(w.owner)
    const c = await w.json(await w.req("POST", `/v1/tasks/${t.id}/comments`, w.owner, { body: "keep" }))
    for (const stmt of [sql`update task_comments set body = 'edited'`, sql`delete from task_comments`, sql`delete from task_files`, sql`update task_checklist_items set task_id = gen_random_uuid()`]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect((err as { cause?: { code?: string } })?.cause?.code, String(stmt)).toBe("42501")
    }
    expect((await w.q("select body from task_comments where id = $1", [c.id]))[0].body).toBe("keep")
  })

  test("RLS: a tenant-A tx cannot read or insert tenant-B checklist, comment and file rows (error on .cause)", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const t = await w.mk(w.owner)
    await addItem(w, w.owner, t.id, "mine")
    const rows = await withTenant(w.deps.db, other.id, async (tx) => [await tx.execute(sql`select 1 from task_checklist_items`), await tx.execute(sql`select 1 from task_comments`), await tx.execute(sql`select 1 from task_files`)])
    expect(rows.map((r) => r.rows.length)).toEqual([0, 0, 0])
    const err = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`insert into task_checklist_items (tenant_id, task_id, text, position) values (${w.tenant.id}, ${t.id}, 'x', 1)`)).catch((e) => e)
    expect((err as { cause?: { code?: string } })?.cause?.code).toBe("42501")
  })
})
