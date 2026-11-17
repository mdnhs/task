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
import { buildCommentsQuery } from "./collab"
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
    expect(await run(up("sr-1:req", req.ref))).toBe("applied") // H6: "evidence still needed" does not consume the id: a repeat is applied again, but adds no second line
    expect((await w.q("select status from tasks where id = $1", [req.id]))[0].status).toBe("not_started") // stays open
    expect((await w.q("select count(*)::int n from task_history where task_id = $1 and update_id like 'sr-1:req%'", [req.id]))[0].n).toBe(1)
    const [line] = await w.q("select text, notified, update_id from task_history where task_id = $1 and update_id = 'sr-1:req#evidence'", [req.id])
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
    const proj = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Parent project" }))
    expect((await w.req("PATCH", `/v1/tasks/${parent.id}`, w.ops, { version: 1, projectId: proj.id })).status).toBe(200)
    const projectId = proj.id
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
    expect(again.version).toBe(2) // 2 = the one PATCH that put it in the project; the subtask changed nothing
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

  test("team search (ruling E4): a report who is only the creator or the reviewer does not surface the task; an assignee report does; own scope unchanged", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await w.manages(w.manager, w.staff2)
    const rule = { mode: "optional", types: ["note"], min: 0, instruction: "", review: "named", reviewer: w.staff2.userId }
    const byReport = await w.mk(w.staff, { title: "Wombat creator-only", primary: w.staff.userId }) // staff creates for themself: a report as assignee
    const creatorOnly = await w.mk(w.ops, { title: "Wombat made-by-ops", primary: w.owner.userId })
    await w.q("update tasks set creator_id = $1 where id = $2", [w.staff.userId, creatorOnly.id]) // a report is only the creator
    const reviewerOnly = await w.mk(w.owner, { title: "Wombat reviewer-only", primary: w.owner.userId, evidenceRule: rule }) // staff2 is only the named reviewer
    const assigneeReport = await w.mk(w.owner, { title: "Wombat assignee", primary: w.staff2.userId })
    for (const t of [creatorOnly, reviewerOnly, assigneeReport]) await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "task.updated", payload: { taskId: t.id, historyId: "h", fields: [] }, actorId: null }, w.clock.now()))
    await relay(w)
    const titles = async (as: Who) => (((await w.json(await w.req("GET", "/v1/search?q=wombat", as))).hits as Json[]) ?? []).map((h) => (h.title as string).replace(/^TSK-\d+ /, "")).sort()
    const mine = await titles(w.manager)
    expect(mine).toEqual(["Wombat assignee", "Wombat creator-only"]) // assignee reports only
    for (const t of [creatorOnly, reviewerOnly]) expect((await w.req("GET", `/v1/tasks/${t.id}`, w.manager)).status).toBe(404) // search and GET agree (D5)
    expect(byReport.id).toBeTruthy()
    // own scope: a creator-only or reviewer-only staff member still finds their own
    expect(await titles(w.staff)).toEqual(["Wombat creator-only", "Wombat made-by-ops"])
    expect(await titles(w.staff2)).toEqual(["Wombat assignee", "Wombat reviewer-only"])
  })

  test("comments: the history line lists assignees and creator as notified, never mention recipients; the list query uses task_comments_task_idx", async () => {
    const w = await world()
    const t = await w.mk(w.owner)
    await w.req("POST", `/v1/tasks/${t.id}/comments`, w.staff, { body: "hi @ops", mentions: [w.ops.userId, w.staff2.userId] })
    const [h] = await w.q("select notified from task_history where task_id = $1 and kind = 'comment'", [t.id])
    expect(h.notified).toEqual([w.owner.userId]) // the creator; staff is the author; ops and staff2 (mentions) stay out
    await w.q("insert into task_comments (tenant_id, task_id, author_id, body, created_at) select $1, $2, $3, 'c' || g, now() + g * interval '1 second' from generate_series(1, 300) g", [w.tenant.id, t.id, w.owner.userId])
    await ownerQuery("analyze task_comments")
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      const plan = await withTenant(w.deps.db, w.tenant.id, async (tx) => buildCommentsQuery(tx, w.tenant.id, t.id, { at: new Date("2026-01-01T00:00:00Z"), id: "00000000-0000-4000-8000-000000000000" }, 26).toSQL())
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      await c.query("set local enable_seqscan = off")
      const text = (await c.query(`explain ${plan.sql}`, plan.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(text).toContain("task_comments_task_idx")
      expect(text).not.toMatch(/Seq Scan on task_comments/)
    } finally {
      await c.end()
    }
  })

  test("search body never contains a Drive URL or an email", async () => {
    const w = await world()
    const url = "https://drive.google.com/file/d/abc123/view"
    await w.mk(w.owner, { title: "Mail ann@example.com", description: `See ${url} or write bob@example.org today`, labels: ["Safety", "fire", "ops@example.com", "https://drive.google.com/x/y"] })
    await relay(w)
    const [doc] = await w.q("select title, body, audience from search_documents where entity = 'task'")
    expect(doc.body).toContain("safety fire")
    expect(`${doc.title} ${doc.body}`).not.toMatch(/drive\.google\.com|@|example\.(com|org)/) // labels are cleaned too
    expect(doc.audience).toEqual([`a:${w.staff.userId}`, `o:${w.owner.userId}`].sort()) // role-tagged (ruling E4)
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
    expect(await col("task_files")).toEqual(["created_by", "task_id"]) // task_id: T4.5 re-homes a shared voice file
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

describe("projects, milestones, dependencies, knock-on and date proposals (T4.3)", () => {
  const putDeps = (w: W, id: string, ids: string[], as: Who = w.ops, version = 1) => w.req("PUT", `/v1/tasks/${id}/dependencies`, as, { version, dependsOnIds: ids })
  const getT = async (w: W, id: string, as: Who = w.ops) => w.json(await w.req("GET", `/v1/tasks/${id}`, as))
  const hasCycle = async (w: W) =>
    (
      await w.q<{ c: boolean }>(
        `with recursive walk(start_id, cur, path, cyc) as (
           select task_id, depends_on_id, array[task_id, depends_on_id], task_id = depends_on_id from task_dependencies
           union all select walk.start_id, e.depends_on_id, walk.path || e.depends_on_id, e.depends_on_id = any(walk.path)
           from walk join task_dependencies e on e.task_id = walk.cur where not walk.cyc)
         select coalesce(bool_or(cyc), false) c from walk`,
      )
    )[0].c
  /** A chain A <- B <- C (B depends on A, C on B), all by ops, every task in the same day layout: start 09:00, due 17:00. */
  async function chain(w: W, primaries: Who[] = [w.staff, w.staff, w.staff]) {
    const a = await w.mk(w.ops, { title: "Task A", start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: primaries[0].userId })
    const b = await w.mk(w.ops, { title: "Task B", start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00", primary: primaries[1].userId })
    const c = await w.mk(w.ops, { title: "Task C", start: "2026-11-22T09:00:00", due: "2026-11-22T17:00:00", primary: primaries[2].userId })
    expect((await putDeps(w, b.id, [a.id])).status).toBe(200)
    expect((await putDeps(w, c.id, [b.id])).status).toBe(200)
    return { a, b, c }
  }
  const preview = async (w: W, id: string, start: string, due: string, as: Who = w.ops) => {
    const r = await w.req("POST", `/v1/tasks/${id}/reschedule/preview`, as, { start, due })
    expect(r.status, await r.clone().text()).toBe(200)
    return w.json(r)
  }
  const resched = (w: W, id: string, body: Json, as: Who = w.ops) => w.req("POST", `/v1/tasks/${id}/reschedule`, as, body)
  const tt = async (w: W, id: string) => (await w.q("select start_at, due_at, version from tasks where id = $1", [id]))[0]

  test("concurrent opposite dependency edits cannot form a cycle", async () => {
    for (let round = 0; round < 3; round++) {
      if (round) await resetDb()
      const w = await world()
      const A = await w.mk(w.ops, { title: "A" })
      const B = await w.mk(w.ops, { title: "B" })
      const [r1, r2] = await Promise.all([putDeps(w, A.id, [B.id]), putDeps(w, B.id, [A.id])])
      expect([r1.status, r2.status].sort(), `round ${round}`).toEqual([200, 422])
      const loser = r1.status === 422 ? r1 : r2
      expect(await code(loser)).toBe("dependency_cycle")
      expect(await hasCycle(w)).toBe(false)
      expect((await w.q("select count(*)::int n from task_dependencies"))[0].n).toBe(1)
    }
  }, 60_000)

  test("self-dependency and a 3-node loop → 422 dependency_cycle; a dependency id from tenant B, an unknown id and an archived task → 422 invalid_dependency", async () => {
    const w = await world()
    const { a, b, c } = await chain(w)
    const self = await putDeps(w, a.id, [a.id])
    expect(self.status).toBe(422)
    expect(await code(self)).toBe("dependency_cycle")
    const loop = await putDeps(w, a.id, [c.id]) // a <- b <- c, so a depending on c closes a 3-node loop
    expect(loop.status).toBe(422)
    expect(await code(loop)).toBe("dependency_cycle")
    expect(await hasCycle(w)).toBe(false)
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const cb = (await signIn(w.app, ob.email, ob.password)).cookie
    const theirs = await w.json(await call(w.app, "POST", "/v1/tasks", { cookie: cb, tenant: "bravo", body: { ...w.base(), primary: ob.userId } }))
    await w.q("update tasks set archived_at = now() where id = $1", [b.id])
    for (const id of [theirs.id, "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", b.id]) {
      const r = await putDeps(w, a.id, [id], w.ops, 1)
      expect(r.status, id).toBe(422)
      expect(await code(r)).toBe("invalid_dependency")
    }
    // more than 20 is a validation error, and the version guard still applies
    expect((await putDeps(w, a.id, [], w.ops, 99)).status).toBe(409)
  })

  test("dependencies: staff are refused (403), the DTO lists refs and ids, an unchanged set bumps nothing, and a replace keeps edges the caller cannot see", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const a = await w.mk(w.ops, { title: "A", primary: w.staff.userId })
    const b = await w.mk(w.ops, { title: "B", primary: w.staff.userId })
    const hid = await w.mk(w.ops, { title: "Hidden", primary: w.staff2.userId }) // outside the team manager's scope
    expect((await putDeps(w, b.id, [a.id], w.staff)).status).toBe(403)
    const ok = await w.json(await putDeps(w, b.id, [a.id]))
    expect(ok.dependsOn).toEqual([a.ref])
    expect(ok.dependsOnIds).toEqual([a.id])
    expect(ok.version).toBe(2)
    const same = await w.json(await putDeps(w, b.id, [a.id], w.ops, 2))
    expect(same.version).toBe(2) // nothing changed: no new version
    // the all-scope manager adds an edge to a task the team manager cannot see; the team manager's replace must keep it and cannot name it
    expect((await putDeps(w, b.id, [a.id, hid.id], w.ops, 2)).status).toBe(200)
    const asMgr = await getT(w, b.id, w.manager)
    expect(asMgr.dependsOn).toEqual([a.ref]) // the hidden task's ref is not shown
    expect(await code(await putDeps(w, b.id, [hid.id], w.manager, 3))).toBe("invalid_dependency") // out of scope looks like absent
    expect((await putDeps(w, b.id, [], w.manager, 3)).status).toBe(200)
    expect((await w.q("select depends_on_id from task_dependencies where task_id = $1", [b.id])).map((r) => r.depends_on_id)).toEqual([hid.id])
    const hist = await w.q("select kind, changes from task_history where task_id = $1", [b.id])
    expect(hist.flatMap((h) => h.changes as Json[])).toContainEqual({ field: "dependsOn", from: [a.ref], to: [] })
  })

  test("preview lists every pushed dependant down the chain; apply with the same hash moves exactly those", async () => {
    const w = await world()
    const { a, b, c } = await chain(w)
    const p = await preview(w, a.id, "2026-11-20T09:00:00", "2026-11-22T17:00:00")
    expect(p.moves.map((m: Json) => [m.ref, m.from, m.to, m.outOfScope])).toEqual([
      [b.ref, { start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" }, { start: "2026-11-23T09:00:00", due: "2026-11-23T17:00:00" }, false],
      [c.ref, { start: "2026-11-22T09:00:00", due: "2026-11-22T17:00:00" }, { start: "2026-11-24T09:00:00", due: "2026-11-24T17:00:00" }, false],
    ].sort((x, y) => ((p.moves as Json[]).findIndex((m) => m.ref === x[0]) - (p.moves as Json[]).findIndex((m) => m.ref === y[0]))))
    expect(p.previewHash).toMatch(/^[0-9a-f]{64}$/)
    expect((await tt(w, b.id)).version).toBe(2) // the preview writes nothing (B is at 2 after its dependency edit)
    const r = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00", reason: "Supplier is late", knockOn: { apply: true, previewHash: p.previewHash } })
    expect(r.status, await r.clone().text()).toBe(200)
    const moved = await w.json(r)
    expect(moved.due).toBe("2026-11-22T17:00:00")
    expect(moved.version).toBe(2)
    expect((await getT(w, b.id)).start).toBe("2026-11-23T09:00:00")
    expect((await getT(w, c.id)).due).toBe("2026-11-24T17:00:00")
    for (const id of [a.id, b.id, c.id]) {
      const [h] = await w.q("select kind, text, changes, notified from task_history where task_id = $1 and kind = 'rescheduled'", [id])
      expect(h, id).toBeTruthy()
      expect((h.changes as Json[]).map((x) => x.field)).toEqual(["start", "due"].filter((f) => (id === a.id ? f === "due" : true)))
    }
    expect((await w.q("select text from task_history where task_id = $1 and kind = 'rescheduled'", [a.id]))[0].text).toBe("Rescheduled: Supplier is late")
    expect((await w.q("select text from task_history where task_id = $1 and kind = 'rescheduled'", [b.id]))[0].text).toBe(`Moved because ${a.ref} was rescheduled`)
    const n = await w.q("select user_id, title from notifications where kind = 'task' and title = 'Task rescheduled' and user_id = $1", [w.staff.userId])
    expect(n.length).toBe(3) // one for each of the three tasks moved
    const ev = await w.q("select payload from domain_events where type = 'task.updated'")
    expect(JSON.stringify(ev)).not.toMatch(/Task [ABC]|Supplier/) // ids-only events (D14)
  })

  test("apply after a dependant changed → 409 knock_on_changed and nothing moves; an apply without a hash is a validation error; a stale version → 409 version_conflict", async () => {
    const w = await world()
    const { a, b, c } = await chain(w)
    const p = await preview(w, a.id, "2026-11-20T09:00:00", "2026-11-22T17:00:00")
    // a dependant changes after the preview (its version moves; here a title edit, versions are part of the hash)
    expect((await w.req("PATCH", `/v1/tasks/${c.id}`, w.ops, { version: 2, title: "Task C (edited)" })).status).toBe(200)
    const before = [await tt(w, a.id), await tt(w, b.id), await tt(w, c.id)]
    const r = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00", knockOn: { apply: true, previewHash: p.previewHash } })
    expect(r.status).toBe(409)
    expect(await code(r)).toBe("knock_on_changed")
    expect([await tt(w, a.id), await tt(w, b.id), await tt(w, c.id)]).toEqual(before)
    // a hash for different target dates is not the preview either
    const p2 = await preview(w, a.id, "2026-11-20T09:00:00", "2026-11-22T17:00:00")
    const other = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-23T17:00:00", knockOn: { apply: true, previewHash: p2.previewHash } })
    expect(await code(other)).toBe("knock_on_changed")
    expect((await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00", knockOn: { apply: true } })).status).toBe(400)
    const stale = await resched(w, a.id, { version: 7, start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00", knockOn: { apply: false } })
    expect(await code(stale)).toBe("version_conflict")
    expect(await code(await resched(w, a.id, { version: 1, start: "2026-11-22T09:00:00", due: "2026-11-21T09:00:00", knockOn: { apply: false } }))).toBe("invalid_dates")
  })

  test("a dependant outside a team manager's scope is flagged outOfScope; apply → 409 knock_on_out_of_scope; apply:false moves only the task", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const { a, b, c } = await chain(w, [w.staff, w.staff, w.staff2]) // C belongs to someone the manager does not manage
    const p = await preview(w, a.id, "2026-11-20T09:00:00", "2026-11-22T17:00:00", w.manager)
    // Ruling E7: the task outside the manager's scope is opaque: only { outOfScope: true } and a count, no id, ref, title or date
    const shown = (p.moves as Json[]).filter((m) => !m.outOfScope)
    const hiddenOnes = (p.moves as Json[]).filter((m) => m.outOfScope)
    expect(shown.map((m) => m.ref)).toEqual([b.ref])
    expect(hiddenOnes).toEqual([{ outOfScope: true }])
    expect(p.hiddenMoves).toBe(1)
    const raw = JSON.stringify(p)
    for (const secret of [c.id, c.ref, "Task C", "2026-11-24", "2026-11-23T09:00:00".replace("11-23", "11-25")]) expect(raw).not.toContain(secret)
    const before = [await tt(w, a.id), await tt(w, b.id), await tt(w, c.id)]
    const r = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00", knockOn: { apply: true, previewHash: p.previewHash } }, w.manager)
    expect(r.status).toBe(409)
    expect(await code(r)).toBe("knock_on_out_of_scope")
    expect([await tt(w, a.id), await tt(w, b.id), await tt(w, c.id)]).toEqual(before)
    const only = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00", knockOn: { apply: false } }, w.manager)
    expect(only.status).toBe(200)
    expect((await tt(w, b.id)).version).toBe(before[1].version) // untouched
    expect((await tt(w, c.id)).version).toBe(before[2].version)
    // a manager cannot preview or reschedule a task outside their scope: 404, and staff are refused with 403
    expect((await w.req("POST", `/v1/tasks/${c.id}/reschedule/preview`, w.manager, { start: "2026-11-20T09:00:00", due: "2026-11-21T09:00:00" })).status).toBe(404)
    expect((await w.req("POST", `/v1/tasks/${a.id}/reschedule/preview`, w.staff, { start: "2026-11-20T09:00:00", due: "2026-11-21T09:00:00" })).status).toBe(403)
    expect((await w.req("POST", `/v1/tasks/${c.id}/reschedule`, w.manager, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-21T09:00:00", knockOn: { apply: false } })).status).toBe(404)
  })

  test("knock-on across 25 Oct 2026 keeps 09:00 local (08:00Z before, 09:00Z after)", async () => {
    const w = await world({ timezone: "Europe/Dublin" })
    const a = await w.mk(w.ops, { title: "A", start: "2026-10-23T09:00:00", due: "2026-10-23T17:00:00" })
    const b = await w.mk(w.ops, { title: "B", start: "2026-10-24T09:00:00", due: "2026-10-24T17:00:00" })
    expect((await putDeps(w, b.id, [a.id])).status).toBe(200)
    expect((await tt(w, b.id)).start_at.toISOString()).toBe("2026-10-24T08:00:00.000Z") // BST (+1)
    const p = await preview(w, a.id, "2026-10-23T09:00:00", "2026-10-25T09:00:00")
    expect(p.moves).toHaveLength(1)
    expect(p.moves[0].to).toEqual({ start: "2026-10-25T09:00:00", due: "2026-10-25T17:00:00" })
    const r = await resched(w, a.id, { version: 1, start: "2026-10-23T09:00:00", due: "2026-10-25T09:00:00", knockOn: { apply: true, previewHash: p.previewHash } })
    expect(r.status, await r.clone().text()).toBe(200)
    const after = await tt(w, b.id)
    expect(after.start_at.toISOString()).toBe("2026-10-25T09:00:00.000Z") // GMT (+0): still 09:00 on the wall
    expect(after.due_at.toISOString()).toBe("2026-10-25T17:00:00.000Z")
    expect((await getT(w, b.id)).start).toBe("2026-10-25T09:00:00")
  })

  test("knock-on ignores archived, completed and cancelled dependants (and does not push through them)", async () => {
    const w = await world()
    const a = await w.mk(w.ops, { title: "A", start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00" })
    const mkDep = async (title: string) => {
      const t = await w.mk(w.ops, { title, start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" })
      expect((await putDeps(w, t.id, [a.id])).status).toBe(200)
      return t
    }
    const live = await mkDep("Live")
    const arch = await mkDep("Archived")
    const done = await mkDep("Completed")
    const canc = await mkDep("Cancelled")
    const behind = await w.mk(w.ops, { title: "Behind archived", start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" })
    expect((await putDeps(w, behind.id, [arch.id])).status).toBe(200)
    await w.q("update tasks set archived_at = now() where id = $1", [arch.id])
    await w.q("update tasks set status = 'completed' where id = $1", [done.id])
    await w.q("update tasks set status = 'cancelled' where id = $1", [canc.id])
    const p = await preview(w, a.id, "2026-11-20T09:00:00", "2026-11-23T17:00:00")
    expect((p.moves as Json[]).map((m) => m.ref)).toEqual([live.ref])
    const dto = await getT(w, behind.id)
    expect(dto.dependsOn).toEqual([]) // an archived dependency is not listed
    const r = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-23T17:00:00", knockOn: { apply: true, previewHash: p.previewHash } })
    expect(r.status).toBe(200)
    const untouched = await w.q("select id, version from tasks where id = any($1::uuid[])", [[arch.id, done.id, canc.id, behind.id]])
    expect(untouched.map((u) => u.version)).toEqual(Array(4).fill(untouched[0].version)) // none bumped beyond what the setup did
    expect((await w.q("select count(*)::int n from task_history where kind = 'rescheduled'"))[0].n).toBe(2) // A and Live only
    // an archived task cannot be previewed or moved (404)
    expect((await w.req("POST", `/v1/tasks/${arch.id}/reschedule/preview`, w.ops, { start: "2026-11-20T09:00:00", due: "2026-11-23T17:00:00" })).status).toBe(404)
  })

  test("concurrent knock-on reschedules and dependency edits on overlapping chains finish without deadlock and leave a consistent graph", async () => {
    const w = await world()
    const root1 = await w.mk(w.ops, { title: "R1", start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00" })
    const root2 = await w.mk(w.ops, { title: "R2", start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00" })
    const shared = await w.mk(w.ops, { title: "Shared", start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" })
    const tail = await w.mk(w.ops, { title: "Tail", start: "2026-11-22T09:00:00", due: "2026-11-22T17:00:00" })
    expect((await putDeps(w, shared.id, [root1.id, root2.id])).status).toBe(200)
    expect((await putDeps(w, tail.id, [shared.id])).status).toBe(200)
    const [p1, p2] = await Promise.all([preview(w, root1.id, "2026-11-20T09:00:00", "2026-11-23T17:00:00"), preview(w, root2.id, "2026-11-20T09:00:00", "2026-11-24T17:00:00")])
    const rs = await Promise.all([
      resched(w, root1.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-23T17:00:00", knockOn: { apply: true, previewHash: p1.previewHash } }),
      resched(w, root2.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-24T17:00:00", knockOn: { apply: true, previewHash: p2.previewHash } }),
      putDeps(w, root2.id, [tail.id], w.ops, 1),
    ])
    for (const r of rs) expect([200, 409, 422]).toContain(r.status) // never a 500 (a deadlock would surface as one)
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1)
    expect(await hasCycle(w)).toBe(false)
  }, 60_000)

  test("member proposes dates; manager approves with knock-on; history and notifications for both", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const { a, b } = await chain(w)
    // only an assignee proposes; the reason is required
    expect((await w.req("POST", `/v1/tasks/${a.id}/date-proposal`, w.staff2, { start: "2026-11-21T09:00:00", due: "2026-11-22T17:00:00", reason: "x" })).status).toBe(404) // out of staff2's scope
    expect((await w.req("POST", `/v1/tasks/${a.id}/date-proposal`, w.ops, { start: "2026-11-21T09:00:00", due: "2026-11-22T17:00:00", reason: "x" })).status).toBe(403) // a manager who is not an assignee reschedules directly
    expect((await w.req("POST", `/v1/tasks/${a.id}/date-proposal`, w.staff, { start: "2026-11-21T09:00:00", due: "2026-11-22T17:00:00", reason: "" })).status).toBe(400)
    const pr = await w.req("POST", `/v1/tasks/${a.id}/date-proposal`, w.staff, { start: "2026-11-21T09:00:00", due: "2026-11-22T17:00:00", reason: "The delivery is late" })
    expect(pr.status, await pr.clone().text()).toBe(200)
    const proposed = await w.json(pr)
    expect(proposed.proposal).toMatchObject({ start: "2026-11-21T09:00:00", due: "2026-11-22T17:00:00", reason: "The delivery is late", by: w.staff.userId })
    expect(proposed.version).toBe(2)
    // the managers in scope hear: ops and owner (all scope) and the team manager of this assignee; not the staff member themself
    const told = async (title: string) => (await w.q<{ user_id: string }>("select user_id from notifications where kind = 'task' and title = $1", [title])).map((r) => r.user_id).sort()
    expect(await told("Date change proposed")).toEqual([w.owner.userId, w.ops.userId, w.manager.userId].sort())
    const [ph] = await w.q("select kind, text, notified from task_history where task_id = $1 and kind = 'proposal'", [a.id])
    expect(ph.text).toContain("The delivery is late")
    // staff cannot approve or decline
    expect((await w.req("POST", `/v1/tasks/${a.id}/date-proposal/approve`, w.staff, { version: 2, knockOn: { apply: false } })).status).toBe(403)
    expect((await w.req("POST", `/v1/tasks/${a.id}/date-proposal/decline`, w.staff, { version: 2 })).status).toBe(403)
    // approve with the preview of the PROPOSED dates: B (start 21 Nov 09:00) is pushed because A is now due 22 Nov 17:00
    const p = await preview(w, a.id, "2026-11-21T09:00:00", "2026-11-22T17:00:00")
    expect(p.moves.length).toBeGreaterThanOrEqual(1)
    const stale = await w.req("POST", `/v1/tasks/${a.id}/date-proposal/approve`, w.ops, { version: 1, knockOn: { apply: false } })
    expect(await code(stale)).toBe("version_conflict")
    const ap = await w.req("POST", `/v1/tasks/${a.id}/date-proposal/approve`, w.ops, { version: 2, knockOn: { apply: true, previewHash: p.previewHash } })
    expect(ap.status, await ap.clone().text()).toBe(200)
    const done = await w.json(ap)
    expect(done.proposal).toBeUndefined()
    expect(done.start).toBe("2026-11-21T09:00:00")
    expect(done.due).toBe("2026-11-22T17:00:00")
    expect(done.version).toBe(3)
    expect((await getT(w, b.id)).start).toBe("2026-11-23T09:00:00")
    const kinds = (await w.q("select kind from task_history where task_id = $1 order by at, id", [a.id])).map((r) => r.kind)
    expect([...kinds].sort()).toEqual(["created", "proposal", "proposal_approved"])
    expect(await told("Date proposal approved")).toEqual([w.staff.userId]) // the proposer hears
    expect((await w.q("select 1 from task_history where task_id = $1 and kind = 'rescheduled'", [b.id])).length).toBe(1)
    // no proposal left: approve and decline are 422 no_proposal
    expect(await code(await w.req("POST", `/v1/tasks/${a.id}/date-proposal/approve`, w.ops, { version: 3, knockOn: { apply: false } }))).toBe("no_proposal")
    expect(await code(await w.req("POST", `/v1/tasks/${a.id}/date-proposal/decline`, w.ops, { version: 3 }))).toBe("no_proposal")
  })

  test("a declined proposal is cleared with the reason in history and the proposer is told; dates stay", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    expect((await w.req("POST", `/v1/tasks/${t.id}/date-proposal`, w.staff, { start: "2026-11-21T09:00:00", due: "2026-11-25T17:00:00", reason: "Need more time" })).status).toBe(200)
    const d = await w.req("POST", `/v1/tasks/${t.id}/date-proposal/decline`, w.ops, { version: 2, reason: "Not possible this week" })
    expect(d.status).toBe(200)
    const dto = await w.json(d)
    expect(dto.proposal).toBeUndefined()
    expect(dto.due).toBe("2026-11-20T17:00:00")
    expect((await w.q("select text from task_history where task_id = $1 and kind = 'proposal_declined'", [t.id]))[0].text).toBe("Date proposal declined: Not possible this week")
    expect((await w.q("select 1 from notifications where user_id = $1 and title = 'Date proposal declined'", [w.staff.userId])).length).toBe(1)
    // a direct PATCH of the dates also clears an open proposal (existing rule), and Drive links in a reason are withheld off the company PC
    expect((await w.req("POST", `/v1/tasks/${t.id}/date-proposal`, w.staff, { start: "2026-11-21T09:00:00", due: "2026-11-25T17:00:00", reason: "see https://drive.google.com/file/d/abc123/view" })).status).toBe(200)
    expect((await getT(w, t.id)).proposal.reason).toContain("drive.google.com")
  })

  test("projects: managers create, edit (version) and read; staff cannot create or edit (403 forbidden); invalid lead, team, rule → 422", async () => {
    const w = await world()
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Cleaning", kind: "department" }))
    expect((await w.req("POST", "/v1/projects", w.staff, { name: "Nope" })).status).toBe(403)
    expect(await code(await w.req("POST", "/v1/projects", w.staff, { name: "Nope" }))).toBe("forbidden")
    expect(await code(await w.req("POST", "/v1/projects", w.ops, { name: "P", leadId: "usr_ghost" }))).toBe("invalid_lead")
    expect(await code(await w.req("POST", "/v1/projects", w.ops, { name: "P", teamId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }))).toBe("invalid_team")
    expect(await code(await w.req("POST", "/v1/projects", w.ops, { name: "P", defaultEvidenceRule: { mode: "required", types: [], min: 1, instruction: "", review: "manager" } }))).toBe("invalid_evidence_rule")
    expect((await w.req("POST", "/v1/projects", w.ops, { name: "", due: "2026-12-18" })).status).toBe(400)
    expect((await w.req("POST", "/v1/projects", w.ops, { name: "P", due: "2026-02-31" })).status).toBe(400)
    const rule = { mode: "required", types: ["photo"], min: 1, instruction: "Show the result", review: "manager" }
    const r = await w.req("POST", "/v1/projects", w.ops, { name: "Office move", description: "Move floors.", teamId: dept.id, leadId: w.manager.userId, due: "2026-12-18", defaultEvidenceRule: rule })
    expect(r.status, await r.clone().text()).toBe(201)
    const p = await w.json(r)
    expect(p).toMatchObject({ name: "Office move", dept: "Cleaning", leadId: w.manager.userId, due: "2026-12-18", version: 1, progress: { done: 0, total: 0, pct: 0 }, milestones: [] })
    expect(p.defaultEvidenceRule).toMatchObject({ mode: "required", min: 1 })
    expect((await w.req("PATCH", `/v1/projects/${p.id}`, w.staff, { version: 1, name: "x" })).status).toBe(403)
    expect((await w.req("DELETE", `/v1/projects/${p.id}`, w.staff)).status).toBe(403)
    expect((await w.req("POST", `/v1/projects/${p.id}/milestones`, w.staff, { name: "M", due: "2026-12-04" })).status).toBe(403)
    const up = await w.json(await w.req("PATCH", `/v1/projects/${p.id}`, w.ops, { version: 1, name: "Office move 2", defaultEvidenceRule: null }))
    expect(up).toMatchObject({ name: "Office move 2", version: 2, defaultEvidenceRule: null })
    expect(await code(await w.req("PATCH", `/v1/projects/${p.id}`, w.ops, { version: 1, name: "late" }))).toBe("version_conflict")
    expect((await w.json(await w.req("PATCH", `/v1/projects/${p.id}`, w.ops, { version: 2, name: "Office move 2" }))).version).toBe(2) // unchanged: no bump
    const [row] = await w.q("select default_evidence_rule, due_date::text d from projects where id = $1", [p.id])
    expect(row.default_evidence_rule).toBeNull()
    expect(row.d).toBe("2026-12-18")
  })

  test("project and milestone placement: PATCH a task into a project and milestone; a milestone of another project → 422 invalid_milestone; unknown project → 422 invalid_project; staff cannot", async () => {
    const w = await world()
    const p1 = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "One" }))
    const p2 = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Two" }))
    const m1 = await w.json(await w.req("POST", `/v1/projects/${p1.id}/milestones`, w.ops, { name: "Phase 1", due: "2026-12-04" }))
    const m2 = await w.json(await w.req("POST", `/v1/projects/${p2.id}/milestones`, w.ops, { name: "Phase A", due: "2026-12-05" }))
    const t = await w.mk(w.ops)
    const bad = await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p1.id, milestoneId: m2.id })
    expect(bad.status).toBe(422)
    expect(await code(bad)).toBe("invalid_milestone")
    expect(await code(await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, milestoneId: m1.id }))).toBe("invalid_milestone") // no project yet
    expect(await code(await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }))).toBe("invalid_project")
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.staff, { version: 1, projectId: p1.id })).status).toBe(403)
    const ok = await w.json(await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p1.id, milestoneId: m1.id }))
    expect(ok).toMatchObject({ projectId: p1.id, milestoneId: m1.id, version: 2 })
    const [h] = await w.q("select changes from task_history where task_id = $1 and kind = 'updated'", [t.id])
    expect((h.changes as Json[]).map((c) => c.field).sort()).toEqual(["milestoneId", "projectId"])
    const hist = ((await w.json(await w.req("GET", `/v1/tasks/${t.id}/history`, w.ops))).items as Json[]).flatMap((i) => i.changes as Json[])
    expect(hist.find((c) => c.field === "Project")).toMatchObject({ from: "", to: "One" })
    // moving to another project without naming a milestone drops the milestone
    const moved = await w.json(await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 2, projectId: p2.id }))
    expect(moved.projectId).toBe(p2.id)
    expect(moved.milestoneId).toBeUndefined()
  })

  test("milestone date change notifies assignees of the milestone's open tasks with old and new dates", async () => {
    const w = await world()
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Launch" }))
    const m = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Go live", due: "2026-12-04" }))
    const t1 = await w.mk(w.ops, { title: "Open one", primary: w.staff.userId })
    const t2 = await w.mk(w.ops, { title: "Done one", primary: w.staff2.userId })
    for (const t of [t1, t2]) expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id, milestoneId: m.id })).status).toBe(200)
    await w.q("update tasks set status = 'completed' where id = $1", [t2.id])
    expect((await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.staff, { due: "2026-12-11" })).status).toBe(403)
    const r = await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops, { due: "2026-12-11" })
    expect(r.status, await r.clone().text()).toBe(200)
    expect((await w.json(r)).due).toBe("2026-12-11")
    const n = await w.q<{ user_id: string; body: string }>("select user_id, body from notifications where kind = 'task' and title = 'Milestone date changed'")
    expect(n.map((x) => x.user_id)).toEqual([w.staff.userId]) // the open task's assignee only
    expect(n[0].body).toContain("2026-12-04")
    expect(n[0].body).toContain("2026-12-11")
    const [h] = await w.q("select text, notified from task_history where task_id = $1 and kind = 'milestone'", [t1.id])
    expect(h.text).toContain("2026-12-04")
    expect(h.text).toContain("2026-12-11")
    expect(h.notified).toEqual([w.staff.userId])
    // a name-only edit tells nobody; an unknown milestone or a milestone of another project is 404 milestone_not_found
    const before = (await w.q("select count(*)::int n from notifications where title = 'Milestone date changed'"))[0].n
    expect((await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops, { name: "Launch day" })).status).toBe(200)
    expect((await w.q("select count(*)::int n from notifications where title = 'Milestone date changed'"))[0].n).toBe(before)
    const p2 = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Other" }))
    expect(await code(await w.req("PATCH", `/v1/projects/${p2.id}/milestones/${m.id}`, w.ops, { name: "x" }))).toBe("milestone_not_found")
  })

  test("project progress counts live tasks only; milestone 'late' uses the tenant-local today (not UTC)", async () => {
    const w = await world({ timezone: "Pacific/Auckland" })
    w.clock.advance({ hours: 5 }) // 14:00Z on 16 Nov = 03:00 on 17 Nov in Auckland (UTC+13)
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Progress" }))
    const mLate = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Yesterday locally", due: "2026-11-16" }))
    const mOpen = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Later", due: "2026-12-31" }))
    const mDone = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Finished", due: "2026-11-01" }))
    const mk = async (ms: string | null, status: string, archived = false) => {
      const t = await w.mk(w.ops, { title: `T ${status}${archived ? " archived" : ""}` })
      await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id, ...(ms ? { milestoneId: ms } : {}) })
      await w.q("update tasks set status = $2, archived_at = case when $3 then now() else null end where id = $1", [t.id, status, archived])
      return t
    }
    await mk(mLate.id, "not_started")
    await mk(mOpen.id, "completed")
    await mk(mOpen.id, "not_started")
    await mk(mOpen.id, "not_started", true) // archived: never counted
    await mk(null, "cancelled") // cancelled: not in the total
    await mk(mDone.id, "completed") // a milestone date in the past, but everything is done: "done"
    const got = await w.json(await w.req("GET", `/v1/projects/${p.id}`, w.ops))
    expect(got.progress).toEqual({ done: 2, total: 4, pct: 50 })
    const by = Object.fromEntries((got.milestones as Json[]).map((m) => [m.name, m]))
    expect(by["Yesterday locally"]).toMatchObject({ state: "late", done: 0, total: 1 })
    expect(by["Later"]).toMatchObject({ state: "open", done: 1, total: 2, pct: 50 })
    expect(by["Finished"]).toMatchObject({ state: "done", done: 1, total: 1, pct: 100 })
    const list = await w.json(await w.req("GET", "/v1/projects", w.ops))
    expect(list.items[0].progress).toEqual({ done: 2, total: 4, pct: 50 })
  })

  test("project progress and visibility never reach past the caller's task scope (no counting oracle)", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Shared project", description: "Plans https://drive.google.com/file/d/abc123/view" }))
    const empty = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Nobody's project" }))
    const mine = await w.mk(w.ops, { title: "Mine", primary: w.staff.userId })
    const theirs = await w.mk(w.ops, { title: "Theirs", primary: w.staff2.userId })
    const theirs2 = await w.mk(w.ops, { title: "Theirs too", primary: w.staff2.userId })
    for (const t of [mine, theirs, theirs2]) expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id })).status).toBe(200)
    await w.q("update tasks set status = 'completed' where id = any($1::uuid[])", [[theirs.id, theirs2.id]])
    // all-scope manager: tenant-wide; team manager: only their own reports' tasks; staff: only their own
    expect((await w.json(await w.req("GET", `/v1/projects/${p.id}`, w.ops))).progress).toEqual({ done: 2, total: 3, pct: 67 })
    expect((await w.json(await w.req("GET", `/v1/projects/${p.id}`, w.manager))).progress).toEqual({ done: 0, total: 1, pct: 0 })
    const asStaff = await w.json(await w.req("GET", `/v1/projects/${p.id}`, w.staff))
    expect(asStaff.progress).toEqual({ done: 0, total: 1, pct: 0 })
    // staff see only projects with a task of theirs (404 otherwise, the same as an unknown id); managers see all
    expect(await code(await w.req("GET", `/v1/projects/${empty.id}`, w.staff))).toBe("project_not_found")
    expect(await code(await w.req("GET", "/v1/projects/6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", w.staff))).toBe("project_not_found")
    expect(((await w.json(await w.req("GET", "/v1/projects", w.staff))).items as Json[]).map((i) => i.name)).toEqual(["Shared project"])
    expect(((await w.json(await w.req("GET", "/v1/projects", w.manager))).items as Json[]).map((i) => i.name).sort()).toEqual(["Nobody's project", "Shared project"])
    // a staff member who has a task there sees the project too (staff2 has two), but only the counts of their own scope
    expect(((await w.json(await w.req("GET", "/v1/projects", w.staff2))).items as Json[]).map((i) => i.name)).toEqual(["Shared project"])
    // Drive links in the description are withheld off the company PC (ruling D22)
    expect((await w.json(await w.req("GET", `/v1/projects/${p.id}`, w.ops))).description).toContain("drive.google.com")
  })

  test("project delete is audited and unlinks tasks without deleting them; milestone delete unlinks too", async () => {
    const w = await world()
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Doomed" }))
    const m = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Soon", due: "2026-12-04" }))
    const t1 = await w.mk(w.ops, { title: "Linked" })
    const t2 = await w.mk(w.ops, { title: "Linked archived" })
    for (const t of [t1, t2]) expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id, milestoneId: m.id })).status).toBe(200)
    await w.q("update tasks set archived_at = now() where id = $1", [t2.id])
    // deleting just the milestone unlinks it from the tasks
    expect((await w.req("DELETE", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops)).status).toBe(204)
    expect((await w.q("select milestone_id, project_id, version from tasks where id = $1", [t1.id]))[0]).toMatchObject({ milestone_id: null, project_id: p.id, version: 3 })
    expect(await code(await w.req("DELETE", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops))).toBe("milestone_not_found")
    const m2 = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Again", due: "2026-12-06" }))
    expect(m2.position).toBe(0) // numbering restarts when no milestone is left
    const del = await w.req("DELETE", `/v1/projects/${p.id}`, w.ops)
    expect(del.status).toBe(204)
    const rows = await w.q("select id, project_id, milestone_id, version, archived_at from tasks where id = any($1::uuid[]) order by ref_no", [[t1.id, t2.id]])
    expect(rows).toHaveLength(2) // nothing deleted
    expect(rows.map((r) => [r.project_id, r.milestone_id, r.version])).toEqual([[null, null, 4], [null, null, 4]])
    expect((await w.q("select count(*)::int n from projects"))[0].n).toBe(0)
    expect((await w.q("select count(*)::int n from project_milestones"))[0].n).toBe(0)
    const h = await w.q("select text, changes from task_history where task_id = $1 and text like 'Project%'", [t1.id])
    expect(h[0].text).toBe('Project "Doomed" was deleted')
    expect((h[0].changes as Json[]).map((c) => c.field)).toEqual(["projectId"])
    const audit = await w.q("select action, entity, entity_id, actor_id, before from audit_events where action = 'project.deleted'")
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entity: "project", entity_id: p.id, actor_id: w.ops.userId })
    expect(audit[0].before).toMatchObject({ name: "Doomed", milestones: 1, unlinkedTasks: 2 })
    expect(await code(await w.req("GET", `/v1/projects/${p.id}`, w.ops))).toBe("project_not_found")
    const ev = await w.q("select payload from domain_events where type = 'project.deleted'")
    expect(ev).toEqual([{ payload: { projectId: p.id } }])
  })

  test("projects list: cursor pagination with a bad cursor → 400, and the exact list statement uses projects_created_idx (EXPLAIN)", async () => {
    const w = await world()
    for (let i = 0; i < 3; i++) {
      await w.req("POST", "/v1/projects", w.ops, { name: `P${i}` })
      w.clock.advance({ minutes: 1 })
    }
    const p1 = await w.json(await w.req("GET", "/v1/projects?limit=2", w.ops))
    expect(p1.items.map((i: Json) => i.name)).toEqual(["P2", "P1"])
    const p2 = await w.json(await w.req("GET", `/v1/projects?limit=2&cursor=${p1.nextCursor}`, w.ops))
    expect(p2.items.map((i: Json) => i.name)).toEqual(["P0"])
    expect(p2.nextCursor).toBeNull()
    expect((await w.req("GET", "/v1/projects?cursor=garbage", w.ops)).status).toBe(400)
    await w.q(
      `insert into projects (tenant_id, name, created_at, updated_at) select $1::uuid, 'Seed ' || g, now() + (g || ' seconds')::interval, now() from generate_series(1, 3000) g`,
      [w.tenant.id],
    )
    await ownerQuery("analyze projects")
    const plan = await withTenant(w.deps.db, w.tenant.id, async (tx) => {
      const { buildProjectsQuery } = await import("../projects/service")
      const ctx: TaskCtx = { ...ctxFor(w, w.ops), role: { home: "manager", access: { tasks: "write" } } as never }
      const { sql: text, params } = buildProjectsQuery(tx, ctx, undefined, 26).toSQL()
      return { text, params }
    })
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const rows = (await c.query(`explain ${plan.text}`, plan.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(rows).toContain("projects_created_idx")
      expect(rows).not.toMatch(/Seq Scan on projects/)
    } finally {
      await c.end()
    }
  }, 60_000)

  test("grants: the new planning tables carry minimal app_user privileges and RLS rejects another tenant", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("projects")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("projects")).toEqual(["default_evidence_rule", "description", "due_date", "lead_id", "name", "team_id", "updated_at", "version"])
    expect(await tbl("project_milestones")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("project_milestones")).toEqual(["due_date", "name", "position"])
    expect(await tbl("task_dependencies")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("task_dependencies")).toEqual([])
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Mine" }))
    for (const stmt of [sql`update projects set tenant_id = gen_random_uuid()`, sql`update project_milestones set project_id = gen_random_uuid()`, sql`update task_dependencies set task_id = gen_random_uuid()`]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect((err as { cause?: { code?: string } })?.cause?.code, String(stmt)).toBe("42501")
    }
    const rows = await withTenant(w.deps.db, other.id, async (tx) => [await tx.execute(sql`select 1 from projects`), await tx.execute(sql`select 1 from project_milestones`), await tx.execute(sql`select 1 from task_dependencies`)])
    expect(rows.map((r) => r.rows.length)).toEqual([0, 0, 0])
    const err = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`insert into projects (tenant_id, name, created_at, updated_at) values (${w.tenant.id}, 'x', now(), now())`)).catch((e) => e)
    expect((err as { cause?: { code?: string } })?.cause?.code).toBe("42501")
    expect((await w.q("select name from projects where id = $1", [p.id]))[0].name).toBe("Mine")
  })

  test("deleting a department that is a project's team works: the project's team is cleared (no FK 500)", async () => {
    const w = await world()
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Cleaning", kind: "department" }))
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Dept project", teamId: dept.id }))
    expect(p.teamId).toBe(dept.id)
    const del = await w.req("DELETE", `/v1/teams/${dept.id}`, w.owner)
    expect(del.status, await del.clone().text()).toBe(204)
    const after = await w.json(await w.req("GET", `/v1/projects/${p.id}`, w.ops))
    expect(after.teamId).toBeNull()
    expect(after.dept).toBe("")
  })

  test("PUT dependencies drops edges to archived tasks, keeps live out-of-scope ones, and the cycle check still sees archived tasks while their edge exists", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const a = await w.mk(w.ops, { title: "A", primary: w.staff.userId })
    const x = await w.mk(w.ops, { title: "X", primary: w.staff.userId })
    expect((await putDeps(w, a.id, [x.id])).status).toBe(200) // a depends on x
    await w.q("update tasks set archived_at = now() where id = $1", [x.id])
    expect((await w.q("select count(*)::int n from task_dependencies where task_id = $1", [a.id]))[0].n).toBe(1) // still there, but invisible
    const gone = await putDeps(w, a.id, [], w.ops, 2)
    expect(gone.status, await gone.clone().text()).toBe(200)
    expect((await w.json(gone)).version).toBe(3)
    expect((await w.q("select count(*)::int n from task_dependencies where task_id = $1", [a.id]))[0].n).toBe(0)
    // a loop through an archived task is still refused while the edges exist: b depends on a, c on b, then b is archived; a cannot depend on c
    const b = await w.mk(w.ops, { title: "B", primary: w.staff.userId })
    const c = await w.mk(w.ops, { title: "C", primary: w.staff.userId })
    expect((await putDeps(w, b.id, [a.id])).status).toBe(200)
    expect((await putDeps(w, c.id, [b.id])).status).toBe(200)
    await w.q("update tasks set archived_at = now() where id = $1", [b.id])
    const loop = await putDeps(w, a.id, [c.id], w.ops, 3)
    expect(loop.status).toBe(422)
    expect(await code(loop)).toBe("dependency_cycle")
    // a live task outside a team manager's scope keeps its edge through the manager's replace (E5), an archived one does not
    const hid = await w.mk(w.ops, { title: "Hidden", primary: w.staff2.userId })
    const d = await w.mk(w.ops, { title: "D", primary: w.staff.userId })
    const arch = await w.mk(w.ops, { title: "Arch", primary: w.staff.userId })
    expect((await putDeps(w, d.id, [hid.id, arch.id])).status).toBe(200)
    await w.q("update tasks set archived_at = now() where id = $1", [arch.id])
    expect((await putDeps(w, d.id, [], w.manager, 2)).status).toBe(200)
    expect((await w.q("select depends_on_id from task_dependencies where task_id = $1", [d.id])).map((r) => r.depends_on_id)).toEqual([hid.id])
  })

  test("the cap of 20 dependencies counts the kept hidden edges too (422 invalid_dependency)", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const b = await w.mk(w.ops, { title: "B", primary: w.staff.userId })
    const hid = await w.mk(w.ops, { title: "Hidden", primary: w.staff2.userId })
    expect((await putDeps(w, b.id, [hid.id])).status).toBe(200)
    const many: string[] = []
    for (let i = 0; i < 20; i++) many.push((await w.mk(w.ops, { title: `Dep ${i}`, primary: w.staff.userId })).id)
    const over = await putDeps(w, b.id, many, w.manager, 2) // 20 asked + 1 kept hidden edge = 21
    expect(over.status).toBe(422)
    expect(await code(over)).toBe("invalid_dependency")
    expect((await putDeps(w, b.id, many.slice(0, 19), w.manager, 2)).status).toBe(200) // 19 + 1 = 20 fits
  }, 60_000)

  test("team-scope managers keep project and milestone create/edit, but project delete, milestone delete and a milestone date change are 403 forbidden (E6)", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const p = await w.json(await w.req("POST", "/v1/projects", w.manager, { name: "Team project" }))
    const m = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.manager, { name: "Phase", due: "2026-12-04" }))
    expect((await w.req("PATCH", `/v1/projects/${p.id}`, w.manager, { version: 1, name: "Renamed" })).status).toBe(200)
    expect((await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.manager, { name: "Phase 1" })).status).toBe(200)
    for (const [method, path, body] of [
      ["PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, { due: "2026-12-11" }],
      ["DELETE", `/v1/projects/${p.id}/milestones/${m.id}`, undefined],
      ["DELETE", `/v1/projects/${p.id}`, undefined],
    ] as [string, string, unknown][]) {
      const r = await w.req(method, path, w.manager, body)
      expect(r.status, `${method} ${path}`).toBe(403)
      expect(await code(r)).toBe("forbidden")
    }
    expect((await w.q("select due_date::text d from project_milestones where id = $1", [m.id]))[0].d).toBe("2026-12-04")
    expect((await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops, { due: "2026-12-11" })).status).toBe(200) // an all-scope manager may
    expect((await w.req("DELETE", `/v1/projects/${p.id}`, w.ops)).status).toBe(204)
  })

  test("unlinking by a project or milestone delete and a milestone date change publish ids-only task.updated like a PATCH", async () => {
    const w = await world()
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Evented" }))
    const m = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Mile", due: "2026-12-04" }))
    const t = await w.mk(w.ops, { title: "Secret title" })
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id, milestoneId: m.id })).status).toBe(200)
    const count = async () => (await w.q("select count(*)::int n from domain_events where type = 'task.updated' and payload->>'taskId' = $1", [t.id]))[0].n
    expect(await count()).toBe(1)
    expect((await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops, { due: "2026-12-11" })).status).toBe(200)
    expect(await count()).toBe(2)
    expect((await w.req("DELETE", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops)).status).toBe(204)
    expect(await count()).toBe(3)
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 3, milestoneId: null })).status).toBe(200)
    const m2 = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: "Mile 2", due: "2026-12-06" }))
    void m2
    expect((await w.req("DELETE", `/v1/projects/${p.id}`, w.ops)).status).toBe(204)
    expect(await count()).toBe(4) // PATCH, date change, milestone delete, project delete (the explicit milestoneId:null PATCH was a no-op: already unlinked)
    const ev = await w.q("select payload from domain_events where type = 'task.updated' and payload->>'taskId' = $1", [t.id])
    expect(JSON.stringify(ev)).not.toContain("Secret title")
    for (const e of ev) expect(Object.keys(e.payload as object).sort()).toEqual(["fields", "historyId", "taskId"])
  })

  test("a task's milestone must belong to its project (composite FK) and cannot exist without a project (check)", async () => {
    const w = await world()
    const p1 = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "One" }))
    const p2 = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Two" }))
    const m2 = await w.json(await w.req("POST", `/v1/projects/${p2.id}/milestones`, w.ops, { name: "Of two", due: "2026-12-05" }))
    const t = await w.mk(w.ops)
    await w.q("update tasks set project_id = $2 where id = $1", [t.id, p1.id])
    await expect(w.q("update tasks set milestone_id = $2 where id = $1", [t.id, m2.id])).rejects.toMatchObject({ code: "23503" })
    await expect(w.q("update tasks set project_id = null, milestone_id = $2 where id = $1", [t.id, m2.id])).rejects.toMatchObject({ code: "23514" })
  })

  test("staff reschedule and preview are 403 dates_manager_only", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const r = await resched(w, t.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-21T17:00:00", knockOn: { apply: false } }, w.staff)
    expect(r.status).toBe(403)
    expect(await code(r)).toBe("dates_manager_only")
    const pr = await w.req("POST", `/v1/tasks/${t.id}/reschedule/preview`, w.staff, { start: "2026-11-20T09:00:00", due: "2026-11-21T17:00:00" })
    expect(await code(pr)).toBe("dates_manager_only")
  })

  test("a knock-on larger than 500 tasks is refused: 422 knock_on_too_large (preview and apply), nothing moves", async () => {
    const w = await world()
    const a = await w.mk(w.ops, { title: "Root", start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00" })
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at)
       select $1::uuid, 3000 + g, 'Chain ' || g, $2::jsonb, '2026-11-21T09:00:00Z', '2026-11-21T17:00:00Z', now(), now() from generate_series(1, 502) g`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE)],
    )
    await w.q(
      `insert into task_dependencies (tenant_id, task_id, depends_on_id)
       select t.tenant_id, t.id, p.id from tasks t join tasks p on p.tenant_id = t.tenant_id and p.ref_no = case when t.ref_no = 3001 then $1::int else t.ref_no - 1 end where t.ref_no between 3001 and 3502`,
      [Number(a.ref.slice(4))],
    )
    const pr = await w.req("POST", `/v1/tasks/${a.id}/reschedule/preview`, w.ops, { start: "2026-11-20T09:00:00", due: "2026-12-25T17:00:00" })
    expect(pr.status).toBe(422)
    expect(await code(pr)).toBe("knock_on_too_large")
    const ap = await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-12-25T17:00:00", knockOn: { apply: true, previewHash: "0".repeat(64) } })
    expect(await code(ap)).toBe("knock_on_too_large")
    expect((await tt(w, a.id)).version).toBe(1)
    // apply:false is still fine
    expect((await resched(w, a.id, { version: 1, start: "2026-11-20T09:00:00", due: "2026-12-25T17:00:00", knockOn: { apply: false } })).status).toBe(200)
  }, 60_000)

  test("DST: a reschedule and a knock-on into the 28 Mar 2027 spring-forward gap (Europe/Dublin) land at 01:30Z and show 02:30", async () => {
    const w = await world({ timezone: "Europe/Dublin" })
    const a = await w.mk(w.ops, { title: "A", start: "2027-03-26T09:00:00", due: "2027-03-26T17:00:00" })
    const b = await w.mk(w.ops, { title: "B", start: "2027-03-27T01:30:00", due: "2027-03-27T17:00:00" })
    expect((await putDeps(w, b.id, [a.id])).status).toBe(200)
    expect((await tt(w, b.id)).start_at.toISOString()).toBe("2027-03-27T01:30:00.000Z") // GMT
    const p = await preview(w, a.id, "2027-03-26T09:00:00", "2027-03-27T09:00:00")
    expect(p.moves[0].to).toEqual({ start: "2027-03-28T01:30:00", due: "2027-03-28T17:00:00" })
    const r = await resched(w, a.id, { version: 1, start: "2027-03-26T09:00:00", due: "2027-03-28T01:30:00", knockOn: { apply: false } })
    const moved = await w.json(r)
    expect(moved.dueAt).toBe("2027-03-28T01:30:00.000Z") // 01:30 does not exist: it moves forward
    expect(moved.due).toBe("2027-03-28T02:30:00")
    const r2 = await resched(w, a.id, { version: 2, start: "2027-03-26T09:00:00", due: "2027-03-27T09:00:00", knockOn: { apply: true, previewHash: p.previewHash } })
    expect(r2.status, await r2.clone().text()).toBe(200)
    const after = await tt(w, b.id)
    expect(after.start_at.toISOString()).toBe("2027-03-28T01:30:00.000Z")
    expect((await getT(w, b.id)).start).toBe("2027-03-28T02:30:00")
    expect(after.due_at.toISOString()).toBe("2027-03-28T16:00:00.000Z") // 17:00 BST
  })

  test("projects list for a staff context and the progress aggregate use their indexes (EXPLAIN)", async () => {
    const w = await world()
    await w.mk(w.owner)
    await w.q(`insert into projects (tenant_id, name, created_at, updated_at) select $1::uuid, 'P ' || g, now() + (g || ' seconds')::interval, now() from generate_series(1, 3000) g`, [w.tenant.id])
    await w.q(
      `with pp as (select id, row_number() over (order by id) rn from projects)
       insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id, project_id)
       select $1::uuid, 5000 + g, 'T ' || g, $2::jsonb, now(), now() + interval '1 day', now(), now(), $3, pp.id from generate_series(1, 4000) g join pp on pp.rn = (g % 3000) + 1`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE), w.owner.userId],
    )
    await w.q("insert into task_assignees (tenant_id, task_id, user_id, is_primary) select tenant_id, id, $1, true from tasks where ref_no >= 5000 and ref_no % 50 = 0", [w.staff.userId])
    await ownerQuery("analyze projects")
    await ownerQuery("analyze tasks")
    await ownerQuery("analyze task_assignees")
    const { buildProjectsQuery, buildProgressQuery } = await import("../projects/service")
    const staffCtx: TaskCtx = { ...ctxFor(w, w.staff), role: { home: "staff", access: { tasks: "write" } } as never, scope: { kind: "own", personId: w.staff.userId } }
    const ids = (await w.q<{ id: string }>("select id from projects order by id limit 10")).map((r) => r.id)
    const plans = await withTenant(w.deps.db, w.tenant.id, async (tx) => ({
      staff: buildProjectsQuery(tx, staffCtx, undefined, 26).toSQL(),
      byProject: buildProgressQuery(tx, staffCtx, "project", ids).toSQL(),
      byMilestone: buildProgressQuery(tx, staffCtx, "milestone", ids).toSQL(),
    }))
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      const explain = async (q: { sql: string; params: unknown[] }) => {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
        const rows = (await c.query(`explain ${q.sql}`, q.params)).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
        await c.query("rollback")
        return rows
      }
      const staff = await explain(plans.staff)
      expect(staff).toContain("projects_created_idx")
      // The own-scope predicate (creator OR reviewer OR assignee) has no index, so the visibility subquery is ONE hashed pass over the tenant's
      // live tasks, never a per-project probe (no N+1). The projects side stays on its index. The aggregates below use the project/milestone indexes.
      expect(staff).toMatch(/hashed SubPlan/)
      expect(staff).not.toMatch(/Seq Scan on projects/)
      const byProject = await explain(plans.byProject)
      expect(byProject).toContain("tasks_project_idx")
      expect(byProject).not.toMatch(/Seq Scan on tasks/)
      const byMilestone = await explain(plans.byMilestone)
      expect(byMilestone).toContain("tasks_milestone_idx")
      expect(byMilestone).not.toMatch(/Seq Scan on tasks/)
    } finally {
      await c.end()
    }
  }, 60_000)

  test("M1 gate: project and planning routes are 403 module_not_entitled without M1; rows untouched", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Gated" }))
    expect((await w.req("GET", "/v1/projects", w.ops)).status).toBe(200) // cached now
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    const dep = { version: 1, dependsOnIds: [] }
    const resch = { version: 1, start: "2026-11-20T09:00:00", due: "2026-11-21T17:00:00", knockOn: { apply: false } }
    for (const [m, path, b] of [
      ["GET", "/v1/projects", undefined], ["POST", "/v1/projects", { name: "x" }], ["GET", `/v1/projects/${p.id}`, undefined], ["DELETE", `/v1/projects/${p.id}`, undefined],
      ["PUT", `/v1/tasks/${t.id}/dependencies`, dep], ["POST", `/v1/tasks/${t.id}/reschedule`, resch], ["POST", `/v1/tasks/${t.id}/reschedule/preview`, { start: resch.start, due: resch.due }],
    ] as [string, string, unknown][]) {
      const r = await w.req(m, path, w.ops, b)
      expect(r.status, `${m} ${path}`).toBe(403)
      expect(await code(r)).toBe("module_not_entitled")
    }
    expect((await w.q("select count(*)::int n from projects"))[0].n).toBe(1)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    expect((await w.req("GET", `/v1/projects/${p.id}`, w.ops)).status).toBe(200)
  })
})

describe("b4 fix wave (I1, I4, M8)", () => {
  const url = "https://drive.google.com/file/d/abc123/view"

  test("I1/E13: a Drive URL in a task title or checklist text never reaches a notification body or a history text, even for a member with Drive access", async () => {
    const w = await world()
    const t = await w.mk(w.owner, { title: `Plan ${url}` }) // assigned to staff, created by owner
    expect((await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.owner, { text: `Read ${url}` })).status).toBe(201)
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.owner, { version: 1, priority: 3 })).status).toBe(200)
    const notes = await w.q("select body from notifications")
    expect(notes.length).toBeGreaterThan(0)
    expect(JSON.stringify(notes)).not.toContain("drive.google.com")
    expect(JSON.stringify(notes)).toContain("Google Drive link")
    expect(JSON.stringify(await w.q("select text from task_history"))).not.toContain("drive.google.com")
    // the task row itself stays raw (the DTO withholds per device)
    expect((await w.q("select title from tasks"))[0].title).toContain("drive.google.com")
    expect((await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.owner))).title).toContain("drive.google.com")
  })

  test("I1/E13: a Drive URL in a milestone name or a linked task title stays out of the milestone notice and the history lines", async () => {
    const w = await world()
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Fit-out" }))
    const m = await w.json(await w.req("POST", `/v1/projects/${p.id}/milestones`, w.ops, { name: `Phase ${url}`, due: "2026-12-04" }))
    const t = await w.mk(w.ops, { title: `Paint ${url}` })
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id, milestoneId: m.id })).status).toBe(200)
    await w.q("delete from notifications")
    expect((await w.req("PATCH", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops, { due: "2026-12-10" })).status).toBe(200)
    const notes = await w.q("select body from notifications where title = 'Milestone date changed'")
    expect(notes).toHaveLength(1)
    expect(JSON.stringify(notes)).not.toContain("drive.google.com")
    const hist = await w.q("select text from task_history where kind = 'milestone'")
    expect(hist).toHaveLength(1)
    expect(JSON.stringify(hist)).not.toContain("drive.google.com")
    expect((await w.req("DELETE", `/v1/projects/${p.id}/milestones/${m.id}`, w.ops)).status).toBe(204)
    expect(JSON.stringify(await w.q("select text from task_history"))).not.toContain("drive.google.com")
  })

  test("I4: staff see a subtask but neither its parent's ref nor id; the parent's history names no child; a team manager reading the parent's history sees no out-of-scope child title", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff2) // the manager's team is staff2 only
    const parent = await w.mk(w.ops, { primary: w.staff2.userId })
    const r = await w.req("POST", `/v1/tasks/${parent.id}/subtasks`, w.ops, { title: "Secret child title" })
    const child = await w.json(r)
    await w.q("update task_assignees set user_id = $1 where task_id = $2", [w.staff.userId, child.id]) // the child now belongs to staff
    const asStaff = await w.json(await w.req("GET", `/v1/tasks/${child.id}`, w.staff))
    expect(asStaff.title).toBe("Secret child title")
    expect(asStaff.parentRef).toBeUndefined()
    expect(asStaff.parentId).toBeNull()
    expect(JSON.stringify(asStaff)).not.toContain(parent.ref)
    expect(JSON.stringify(asStaff)).not.toContain(parent.id)
    // someone who may see the parent still gets it
    const asOps = await w.json(await w.req("GET", `/v1/tasks/${child.id}`, w.ops))
    expect(asOps).toMatchObject({ parentRef: parent.ref, parentId: parent.id })
    // the manager sees the parent (a report is assigned) but not the child: its title and ref are in no history line
    expect((await w.req("GET", `/v1/tasks/${child.id}`, w.manager)).status).toBe(404)
    const hist = await w.json(await w.req("GET", `/v1/tasks/${parent.id}/history`, w.manager))
    expect(hist.items.some((i: Json) => i.kind === "subtask")).toBe(true)
    expect(JSON.stringify(hist)).not.toContain("Secret child title")
    expect(JSON.stringify(hist)).not.toContain(child.ref)
    const childHist = await w.q("select text from task_history where task_id = $1", [child.id])
    expect(JSON.stringify(childHist)).not.toContain(parent.ref)
  })

  test("E15: board and calendar cards null parentId when the parent is outside the caller's scope; a caller who may see the parent still gets it", async () => {
    const w = await world()
    const parent = await w.mk(w.ops, { primary: w.staff2.userId })
    const child = await w.json(await w.req("POST", `/v1/tasks/${parent.id}/subtasks`, w.ops, { title: "Secret child" }))
    await w.q("update task_assignees set user_id = $1 where task_id = $2", [w.staff.userId, child.id])
    const board = await w.json(await w.req("GET", "/v1/tasks/board", w.staff))
    const card = board.columns.flatMap((c: Json) => c.items).find((i: Json) => i.id === child.id)
    expect(card.parentId).toBeNull()
    expect(JSON.stringify(board)).not.toContain(parent.id)
    const cal = await w.json(await w.req("GET", "/v1/tasks/calendar?from=2026-11-16&to=2026-11-29", w.staff))
    const calCard = cal.days.flatMap((d: Json) => d.tasks).find((i: Json) => i.id === child.id)
    expect(calCard.parentId).toBeNull()
    expect(JSON.stringify(cal)).not.toContain(parent.id)
    const asOps = await w.json(await w.req("GET", "/v1/tasks/board", w.ops))
    expect(asOps.columns.flatMap((c: Json) => c.items).find((i: Json) => i.id === child.id).parentId).toBe(parent.id)
  })

  test("N2: dependencies carry their status and blocks lists the reverse edges; both are scoped (an out-of-scope task is only a count), archived ones are left out", async () => {
    const w = await world()
    const a = await w.mk(w.ops, { primary: w.staff.userId, title: "A" })
    const b = await w.mk(w.ops, { primary: w.staff.userId, title: "B" })
    const c = await w.mk(w.ops, { primary: w.staff2.userId, title: "Secret C" })
    const d = await w.mk(w.ops, { primary: w.staff.userId, title: "D archived" })
    const put = async (t: Json, ids: string[]) => expect((await w.req("PUT", `/v1/tasks/${t.id}/dependencies`, w.ops, { version: t.version, dependsOnIds: ids })).status).toBe(200)
    await put(a, [b.id, c.id, d.id])
    await put(c, [b.id]) // C (staff2's) also waits on B
    expect((await w.req("POST", `/v1/tasks/${d.id}/archive`, w.ops, { version: d.version })).status).toBe(200)
    // staff sees B (status, ref, title) and a COUNT for C; D is archived: not listed, not counted
    const asStaff = await w.json(await w.req("GET", `/v1/tasks/${a.id}`, w.staff))
    expect(asStaff.dependencies).toEqual([{ id: b.id, ref: b.ref, title: "B", status: "not_started" }])
    expect(asStaff.hiddenDependencies).toBe(1)
    expect(asStaff.dependsOn).toEqual([b.ref])
    // (the history line "Updated Depends on" names every ref the MANAGER typed: a pre-existing leak, reported, so only the dependency fields are checked here)
    const fields = (t: Json) => JSON.stringify([t.dependencies, t.blocks, t.dependsOn, t.dependsOnIds])
    expect(fields(asStaff)).not.toContain("Secret C")
    expect(fields(asStaff)).not.toContain(c.ref)
    // B blocks A (visible) and C (hidden from staff)
    const bStaff = await w.json(await w.req("GET", `/v1/tasks/${b.id}`, w.staff))
    expect(bStaff.blocks).toEqual([{ id: a.id, ref: a.ref, title: "A", status: "not_started" }])
    expect(bStaff.hiddenBlocks).toBe(1)
    expect(fields(bStaff)).not.toContain(c.ref)
    // ops sees everything
    const bOps = await w.json(await w.req("GET", `/v1/tasks/${b.id}`, w.ops))
    expect(bOps.blocks.map((x: Json) => x.ref).sort()).toEqual([a.ref, c.ref].sort())
    expect(bOps.hiddenBlocks).toBe(0)
    // a team manager whose team is staff only: C is hidden from them too
    await w.manages(w.manager, w.staff)
    const aMgr = await w.json(await w.req("GET", `/v1/tasks/${a.id}`, w.manager))
    expect(aMgr.hiddenDependencies).toBe(1)
    expect(aMgr.dependencies.map((x: Json) => x.ref)).toEqual([b.ref])
    // lists carry the fields too (one batch, no per row query)
    const list = await w.json(await w.req("GET", "/v1/tasks?limit=50", w.staff))
    expect(list.items.find((x: Json) => x.id === a.id).hiddenDependencies).toBe(1)
    // an API key acts with its creator's scope
    const key = await makeApiKey(w.deps, w.tenant.id, w.staff.userId, ["tasks:read"])
    const viaKey = await w.json(await call(w.app, "GET", `/v1/tasks/${a.id}`, { headers: { authorization: `Bearer ${key.key}` } }))
    expect(viaKey.hiddenDependencies).toBe(1)
    expect(fields(viaKey)).not.toContain(c.ref)
  })

  test("M8: an assignee needs tasks:read (422 invalid_assignee): a role without it cannot be assigned, on create or reassign", async () => {
    const w = await world()
    await w.q(`update roles set access = access || '{"tasks":"none"}'::jsonb where key = 'payroll'`)
    const noTasks = await w.who("payroll")
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ primary: noTasks.userId })))).toBe("invalid_assignee")
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ others: [noTasks.userId] })))).toBe("invalid_assignee")
    const t = await w.mk(w.ops)
    const put = await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.ops, { version: 1, primary: noTasks.userId, others: [] })
    expect(put.status).toBe(422)
    expect(await code(put)).toBe("invalid_assignee")
    expect((await w.q("select count(*)::int n from notifications where user_id = $1", [noTasks.userId]))[0].n).toBe(0)
  })
})
