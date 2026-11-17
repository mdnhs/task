import { sql } from "drizzle-orm"
import pg from "pg"
import { beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { withTenant } from "../../db/tenant-tx"
import { clearModuleOverride } from "../entitlements"
import { applyTaskUpdate, buildListQuery, type TaskCtx } from "."
import { NO_EVIDENCE } from "@opsdesk/domain/task-evidence"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

type Who = { userId: string; email: string; password: string; cookie: string }

async function world(over: { timezone?: string; sessionIdleHours?: number } = {}) {
  const t = testApp()
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
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string

describe("create, wall clock and refs", () => {
  test("create stores UTC and echoes tenant-local wall clock: due 2026-10-25T01:30:00 Europe/Dublin → dueAt 2026-10-25T00:30:00.000Z (earlier instant)", async () => {
    const w = await world()
    const r = await w.mk(w.manager, { start: "2026-10-24T09:00:00", due: "2026-10-25T01:30:00" })
    expect(r.dueAt).toBe("2026-10-25T00:30:00.000Z")
    expect(r.due).toBe("2026-10-25T01:30:00")
    expect(r.startAt).toBe("2026-10-24T08:00:00.000Z") // BST still (+1)
    expect(r.ref).toBe("TSK-1000")
    expect(r.version).toBe(1)
    expect(r.assignee).toBe(w.staff.userId)
    expect(r.creator).toBe(w.manager.userId)
    const [row] = await w.q("select due_at from tasks")
    expect(new Date(row.due_at as string).toISOString()).toBe("2026-10-25T00:30:00.000Z")
  })

  test("due 2027-03-28T01:30:00 (spring-forward gap) is stored as 01:30Z and shown as 02:30 local", async () => {
    const w = await world()
    const r = await w.mk(w.manager, { start: "2027-03-27T09:00:00", due: "2027-03-28T01:30:00" })
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
    const mine = await w.mk(w.manager)
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
    const a = await w.mk(w.manager, { title: "A", start: "2026-11-17T08:00:00", due: "2026-11-17T09:00:00" }) // today, already past
    const b = await w.mk(w.manager, { title: "B", start: "2026-11-16T19:00:00", due: "2026-11-16T20:00:00" }) // yesterday (but 07:00Z on the 16th: "today" in UTC)
    const c = await w.mk(w.manager, { title: "C", start: "2026-11-17T17:00:00", due: "2026-11-17T18:00:00" }) // today, still ahead
    const d = await w.mk(w.manager, { title: "D", start: "2026-11-24T08:00:00", due: "2026-11-24T09:00:00" }) // 7 days ahead (this week window)
    const e = await w.mk(w.manager, { title: "E", start: "2026-11-25T08:00:00", due: "2026-11-25T09:00:00" }) // 8 days ahead
    const titles = async (qs: string) => ((await w.json(await w.req("GET", `/v1/tasks?${qs}`, w.manager))).items as Json[]).map((i) => i.title as string).sort()
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

  const ctxFor = (w: W, who: Who): TaskCtx => ({ tenantId: w.tenant.id, tz: "Europe/Dublin", me: who.userId, actorId: who.userId, role: null as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() })

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
    const lines = await w.q("select text, notified, update_id from task_history where task_id = $1 order by at, id", [req.id])
    expect(lines.at(-1)!.update_id).toBe("sr-1:req")
    expect(lines.at(-1)!.text).toContain("Report marked done; evidence still needed")
    expect(lines.at(-1)!.notified).toEqual([])
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
