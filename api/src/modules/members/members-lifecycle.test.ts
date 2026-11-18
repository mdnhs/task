import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { flushLastActive, touchLastActive } from "../../core/middleware/last-active"

// B8 Task 6: member deactivate / reactivate, last active, GET /v1/people status (the API behind Settings -> Users).

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string }
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const p: Record<string, Who> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) p[k] = await makeMember(t.deps, tenant.id, k)
  const cookies = new Map<string, string>()
  const cookie = async (who: Who) => {
    if (!cookies.has(who.email)) cookies.set(who.email, (await signIn(t.app, who.email, who.password)).cookie)
    return cookies.get(who.email)!
  }
  const req = async (method: string, path: string, who: Who, body?: unknown, slug = "acme") => call(t.app, method, path, { cookie: await cookie(who), tenant: slug, body })
  const ok = async (method: string, path: string, who: Who, body?: unknown, status = 200): Promise<Json> => {
    const r = await req(method, path, who, body)
    const text = await r.text()
    expect(r.status, `${method} ${path} -> ${text}`).toBe(status)
    return text ? JSON.parse(text) : {}
  }
  const code = async (method: string, path: string, who: Who, body: unknown, status: number): Promise<string> => {
    const r = await req(method, path, who, body)
    expect(r.status, `${method} ${path}`).toBe(status)
    return ((await r.json()) as Json).code as string
  }
  const rows = (sql: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sql, params) as Promise<Json[]>
  return { ...t, tenant, p, cookie, req, ok, code, rows }
}

describe("deactivate and reactivate", () => {
  test("deactivate revokes the member's sessions, blocks sign-in to the tenant, keeps their history and shifts; reactivate restores", async () => {
    const w = await world()
    const target = w.p.employee
    const loc = (await w.ok("POST", "/v1/locations", w.p.owner, { name: "Alpha" }, 201)).id as string
    const ty = (await w.ok("POST", `/v1/locations/${loc}/shift-types`, w.p.owner, { name: "Day", start: "07:00", end: "15:00", role: "Guard" }, 201)).id as string
    const [wk] = await w.rows("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2026-11-16', now(), now()) returning id", [w.tenant.id, loc])
    await w.rows("insert into roster_shifts (tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at) values ($1, $2, $3, '2026-11-17', $4, $5, 'Guard', '07:00', '15:00', '2026-11-17T07:00Z', '2026-11-17T15:00Z', now(), now())", [w.tenant.id, wk.id, loc, target.userId, ty])
    const before = await w.cookie(target)
    expect((await call(w.app, "GET", "/v1/me", { cookie: before })).status).toBe(200)
    const out = await w.ok("POST", `/v1/members/${target.userId}/deactivate`, w.p.owner)
    expect(out).toMatchObject({ userId: target.userId, status: "deactivated" })
    expect(out.deactivatedAt).toBe(w.clock.now().toISOString())
    // the member row stays, with the date; their shift stays; the session is gone (single workspace: signed out everywhere)
    const [m] = await w.rows("select status, deactivated_at from memberships where user_id = $1", [target.userId])
    expect(m.status).toBe("deactivated")
    expect(new Date(m.deactivated_at as string).toISOString()).toBe(w.clock.now().toISOString())
    expect((await w.rows("select user_id from roster_shifts where user_id = $1", [target.userId])).length).toBe(1)
    expect((await call(w.app, "GET", "/v1/me", { cookie: before })).status).toBe(401)
    // signing in again works (the account exists) but the workspace is closed to them: the same 404 as a stranger
    const again = (await signIn(w.app, target.email, target.password)).cookie
    expect((await call(w.app, "GET", "/v1/locations", { cookie: again, tenant: "acme" })).status).toBe(404)
    expect((await call(w.app, "GET", "/v1/people", { cookie: again, tenant: "acme" })).status).toBe(404)
    // audit and event
    const audit = await w.rows("select * from audit_events where action = 'member.deactivated'")
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entity_id: target.userId, actor_id: w.p.owner.userId, before: { status: "active" } })
    expect((await w.rows("select payload from domain_events where type = 'member.deactivated'")).map((r) => (r.payload as Json).userId)).toEqual([target.userId])
    // listed as deactivated for an admin view, never in the default list
    expect(((await w.ok("GET", "/v1/people", w.p.owner)) as Json[]).some((x) => x.userId === target.userId)).toBe(false)
    const all = (await w.ok("GET", "/v1/people?status=all", w.p.owner)) as Json[]
    expect(all.find((x) => x.userId === target.userId)).toMatchObject({ status: "deactivated" })
    expect(((await w.ok("GET", "/v1/people?status=deactivated", w.p.owner)) as Json[]).map((x) => x.userId)).toEqual([target.userId])
    // reactivate restores access; the shift is still theirs
    expect(await w.code("POST", `/v1/members/${target.userId}/deactivate`, w.p.owner, undefined, 409)).toBe("already_deactivated")
    expect(await w.ok("POST", `/v1/members/${target.userId}/reactivate`, w.p.owner)).toMatchObject({ status: "active", deactivatedAt: null })
    expect((await w.rows("select deactivated_at from memberships where user_id = $1", [target.userId]))[0].deactivated_at).toBeNull()
    const back = (await signIn(w.app, target.email, target.password)).cookie
    expect((await call(w.app, "GET", "/v1/locations", { cookie: back, tenant: "acme" })).status).toBe(200)
    expect((await w.rows("select 1 from audit_events where action = 'member.reactivated'")).length).toBe(1)
    expect(await w.code("POST", `/v1/members/${target.userId}/reactivate`, w.p.owner, undefined, 409)).toBe("not_deactivated")
  })

  test("a person who also belongs to another workspace keeps their sessions; only this workspace closes to them", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "other" })
    const dual = await makeMember(w.deps, w.tenant.id, "employee")
    await makeMember(w.deps, other.id, "employee", { email: dual.email })
    const ck = await w.cookie(dual)
    await w.ok("POST", `/v1/members/${dual.userId}/deactivate`, w.p.owner)
    expect((await call(w.app, "GET", "/v1/locations", { cookie: ck, tenant: "acme" })).status).toBe(404)
    expect((await call(w.app, "GET", "/v1/me", { cookie: ck })).status).toBe(200)
    expect((await call(w.app, "GET", "/v1/people", { cookie: ck, tenant: "other" })).status).not.toBe(404)
  })

  test("the last active owner cannot be deactivated (409 last_owner); guards on who may deactivate whom", async () => {
    const w = await world()
    // the sole owner, by themself or by an admin: 409 last_owner (the explicit answer comes first)
    expect(await w.code("POST", `/v1/members/${w.p.owner.userId}/deactivate`, w.p.owner, undefined, 409)).toBe("last_owner")
    expect(await w.code("POST", `/v1/members/${w.p.owner.userId}/deactivate`, w.p.admin, undefined, 409)).toBe("last_owner")
    expect((await w.rows("select status from memberships where user_id = $1", [w.p.owner.userId]))[0].status).toBe("active")
    // with a second owner: an admin may not touch an owner (R24), an owner cannot deactivate themself, one owner may deactivate the other
    const owner2 = await makeMember(w.deps, w.tenant.id, "owner")
    expect(await w.code("POST", `/v1/members/${w.p.owner.userId}/deactivate`, w.p.admin, undefined, 403)).toBe("role_escalation")
    expect(await w.code("POST", `/v1/members/${w.p.owner.userId}/deactivate`, w.p.owner, undefined, 422)).toBe("self_deactivation")
    await w.ok("POST", `/v1/members/${owner2.userId}/deactivate`, w.p.owner)
    // ... and now the first owner is the last one again
    expect(await w.code("POST", `/v1/members/${w.p.owner.userId}/deactivate`, w.p.admin, undefined, 409)).toBe("last_owner")
    // a reactivated owner counts again
    await w.ok("POST", `/v1/members/${owner2.userId}/reactivate`, w.p.owner)
    await w.ok("POST", `/v1/members/${w.p.owner.userId}/deactivate`, owner2)
  })

  test("last owner: the B1 count guard blocks the final deactivation even when two owners deactivate each other at once", async () => {
    const w = await world()
    const owner2 = await makeMember(w.deps, w.tenant.id, "owner")
    const [x, y] = await Promise.all([w.req("POST", `/v1/members/${owner2.userId}/deactivate`, w.p.owner), w.req("POST", `/v1/members/${w.p.owner.userId}/deactivate`, owner2)])
    const statuses = [x.status, y.status].sort()
    expect(statuses[0]).toBe(200) // exactly one wins
    expect(statuses[1]).not.toBe(200) // the loser: 401 (their session was revoked), 404 or 409 last_owner, never a second success
    const active = await w.rows("select user_id from memberships m join roles r on r.id = m.role_id where m.status = 'active' and r.key = 'owner'")
    expect(active).toHaveLength(1)
  })

  test("a role below settings:write is 403; a ghost member and another tenant's member are 404 member_not_found", async () => {
    const w = await world()
    for (const k of ["employee", "manager", "location-supervisor"]) expect((await w.req("POST", `/v1/members/${w.p.admin.userId}/deactivate`, w.p[k])).status, k).toBe(403)
    expect(await w.code("POST", "/v1/members/usr_ghost/deactivate", w.p.owner, undefined, 404)).toBe("member_not_found")
    const other = await makeTenant(w.deps, { slug: "other" })
    const foreign = await makeMember(w.deps, other.id, "employee")
    expect(await w.code("POST", `/v1/members/${foreign.userId}/deactivate`, w.p.owner, undefined, 404)).toBe("member_not_found")
    expect(await w.code("POST", `/v1/members/${foreign.userId}/reactivate`, w.p.owner, undefined, 404)).toBe("member_not_found")
    expect((await w.ok("POST", `/v1/members/${w.p["roster-manager"].userId}/deactivate`, w.p.admin)).status).toBe("deactivated") // admin deactivates a peer-or-below
  })

  test("reactivate needs a free seat (409 seat_limit)", async () => {
    const w = await world()
    await w.ok("POST", `/v1/members/${w.p.employee.userId}/deactivate`, w.p.owner)
    const [{ n }] = await w.rows("select count(*)::int as n from memberships where status = 'active'")
    await w.rows("update subscriptions set seats = $1", [n])
    expect(await w.code("POST", `/v1/members/${w.p.employee.userId}/reactivate`, w.p.owner, undefined, 409)).toBe("seat_limit")
    await w.rows("update subscriptions set seats = $1", [n + 1])
    expect((await w.ok("POST", `/v1/members/${w.p.employee.userId}/reactivate`, w.p.owner)).status).toBe("active")
  })

  test("a deactivated member's future draft shifts are untouched but flagged for the left rule; open assignments end, open requests close, history and notices are written", async () => {
    const w = await world()
    const target = w.p["location-supervisor"]
    const sup = await makeMember(w.deps, w.tenant.id, "location-supervisor")
    const loc = (await w.ok("POST", "/v1/locations", w.p.owner, { name: "Alpha" }, 201)).id as string
    await w.ok("PUT", `/v1/locations/${loc}/supervisors`, w.p.owner, { userIds: [sup.userId, target.userId] })
    const ty = (await w.ok("POST", `/v1/locations/${loc}/shift-types`, w.p.owner, { name: "Day", start: "07:00", end: "15:00", role: "Guard" }, 201)).id as string
    const [wk] = await w.rows("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2026-11-23', now(), now()) returning id", [w.tenant.id, loc])
    const shiftSql = "insert into roster_shifts (tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, 'Guard', '07:00', '15:00', $7, $8, now(), now()) returning id"
    const [future] = await w.rows(shiftSql, [w.tenant.id, wk.id, loc, "2026-11-24", target.userId, ty, "2026-11-24T07:00Z", "2026-11-24T15:00Z"])
    const [past] = await w.rows(shiftSql, [w.tenant.id, wk.id, loc, "2026-11-10", target.userId, ty, "2026-11-10T07:00Z", "2026-11-10T15:00Z"])
    const [open] = await w.rows(shiftSql, [w.tenant.id, wk.id, loc, "2026-11-25", null, ty, "2026-11-25T07:00Z", "2026-11-25T15:00Z"])
    await w.rows("insert into roster_exchanges (tenant_id, kind, shift_id, from_user_id, created_at, updated_at) values ($1, 'claim', $2, $3, now(), now())", [w.tenant.id, open.id, target.userId])
    await w.rows("insert into roster_exchanges (tenant_id, kind, shift_id, from_user_id, to_user_id, status, created_at, updated_at) values ($1, 'swap', $2, $3, $4, 'recommended', now(), now())", [w.tenant.id, future.id, sup.userId, target.userId])
    await w.rows("insert into roster_exchanges (tenant_id, kind, shift_id, from_user_id, status, created_at, updated_at) values ($1, 'claim', $2, $3, 'approved', now(), now())", [w.tenant.id, open.id, target.userId])
    await w.rows("insert into roster_change_requests (tenant_id, shift_id, shift_version, requested_by, patch, reason, created_at, updated_at) values ($1, $2, 1, $3, '{}', 'r', now(), now())", [w.tenant.id, future.id, target.userId])
    await w.rows("insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, created_at, updated_at) values ($1, $2, '2026-12-01', '2026-12-02', 'annual', now(), now())", [w.tenant.id, target.userId])
    await w.rows("insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, status, created_at, updated_at) values ($1, $2, '2026-12-08', '2026-12-09', 'annual', 'approved', now(), now())", [w.tenant.id, target.userId])
    // B5 pattern assignments: one open since before today, one that starts in the future
    const team = (await w.ok("POST", "/v1/teams", w.p.owner, { name: "Night", kind: "team" }, 201)).id as string
    const pat = (await w.ok("POST", "/v1/shifts/patterns", w.p.owner, { name: "Nights", teamId: team, start: "22:00", end: "06:00", days: [1, 2, 3] }, 201)).id as string
    const openA = (await w.ok("POST", "/v1/shifts/assignments", w.p.owner, { userId: target.userId, patternId: pat, from: "2026-10-01" }, 201)).id as string
    const futureA = await w.rows("insert into shift_assignments (tenant_id, user_id, pattern_id, from_date, created_at) values ($1, $2, $3, '2027-01-04', now()) returning id", [w.tenant.id, target.userId, pat])
    await w.ok("POST", `/v1/members/${target.userId}/deactivate`, w.p.owner)
    // shifts untouched (the left rule flags them from the deactivation date: Task 8)
    expect((await w.rows("select id, user_id, version from roster_shifts where id in ($1, $2)", [future.id, past.id])).map((r) => [r.user_id, r.version])).toEqual([[target.userId, 1], [target.userId, 1]])
    // assignments: the open one ends today (tenant date), the future one is gone
    expect((await w.rows("select until_date::text as u from shift_assignments where id = $1", [openA]))[0].u).toBe("2026-11-16")
    expect(await w.rows("select 1 from shift_assignments where id = $1", [futureA[0].id])).toHaveLength(0)
    // pending requests closed, decided ones untouched
    expect((await w.rows("select kind, status from roster_exchanges order by status, kind")).map((r) => `${r.kind}:${r.status}`)).toEqual(["claim:approved", "claim:cancelled", "swap:cancelled"])
    expect((await w.rows("select status, decision_note from roster_change_requests"))[0]).toMatchObject({ status: "rejected", decision_note: "member_deactivated" })
    expect((await w.rows("select status from leave_requests order by from_date")).map((r) => r.status)).toEqual(["cancelled", "approved"])
    // history: one line for the location with upcoming shifts (user ids only), notice to the OTHER supervisor (not the actor, not the person)
    const hist = await w.rows("select location_id, action, after from roster_history where action = 'member_deactivated'")
    expect(hist).toHaveLength(1)
    expect(hist[0]).toMatchObject({ location_id: loc, after: { userId: target.userId, leftOn: "2026-11-16", upcomingShifts: 1 } })
    const notes = await w.rows("select user_id, title, body, subject_user_id from notifications where title = 'Team member deactivated'")
    expect(notes.map((n) => n.user_id)).toEqual([sup.userId])
    expect(notes[0].body).toContain("{{subject}}")
    expect(JSON.stringify(notes)).not.toContain("Test Member")
    const a = (await w.rows("select after from audit_events where action = 'member.deactivated'"))[0].after as Json
    expect(a).toMatchObject({ leftOn: "2026-11-16", endedAssignments: 1, removedFutureAssignments: 1, cancelledExchanges: 2, rejectedChangeRequests: 1, cancelledLeave: 1 })
    // the grant stays in the table but the person is no longer listed as a supervisor; reactivation lists them again
    expect((await w.ok("GET", `/v1/locations/${loc}`, w.p.owner)).supervisorIds).toEqual([sup.userId])
    await w.ok("POST", `/v1/members/${target.userId}/reactivate`, w.p.owner)
    expect((await w.ok("GET", `/v1/locations/${loc}`, w.p.owner)).supervisorIds.sort()).toEqual([sup.userId, target.userId].sort())
  })
})

describe("last active", () => {
  test("last_active_at moves at most once per 5 minutes and never makes a request fail when the update errors", async () => {
    const w = await world()
    const who = w.p.employee
    const stamp = async () => ((await w.rows("select last_active_at from memberships where user_id = $1", [who.userId]))[0].last_active_at as string | null)
    expect(await stamp()).toBeNull()
    const hit = async () => {
      const r = await w.req("GET", "/v1/locations", who)
      await flushLastActive()
      return r.status
    }
    expect(await hit()).toBe(200)
    const t0 = w.clock.now().toISOString()
    expect(new Date((await stamp())!).toISOString()).toBe(t0)
    w.clock.advance({ minutes: 4 })
    expect(await hit()).toBe(200)
    expect(new Date((await stamp())!).toISOString()).toBe(t0) // inside the gap: untouched
    w.clock.advance({ minutes: 2 })
    expect(await hit()).toBe(200)
    expect(new Date((await stamp())!).toISOString()).toBe(w.clock.now().toISOString()) // 6 minutes later: moved
    const t1 = w.clock.now().toISOString()
    // an UPDATE that errors: the request still answers 200, the failure is counted, the value stays
    await ownerQuery("create function lifecycle_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$")
    await ownerQuery("create trigger lifecycle_boom before update of last_active_at on memberships for each row execute function lifecycle_boom()")
    try {
      w.clock.advance({ minutes: 6 })
      expect(await hit()).toBe(200)
      expect(new Date((await stamp())!).toISOString()).toBe(t1)
      expect(w.metrics.render()).toContain('last_active_stamp_total{result="failed"} 1')
      expect(w.metrics.render()).toContain('last_active_stamp_total{result="ok"} 2')
    } finally {
      await ownerQuery("drop trigger lifecycle_boom on memberships")
      await ownerQuery("drop function lifecycle_boom()")
    }
    w.clock.advance({ minutes: 1 })
    expect(await hit()).toBe(200)
    expect(new Date((await stamp())!).toISOString()).toBe(w.clock.now().toISOString()) // recovers
  })

  test("GET /v1/people returns lastActiveAt null for a member never seen, and the status; deactivated people are an admin view", async () => {
    const w = await world()
    await w.ok("GET", "/v1/locations", w.p.manager)
    await flushLastActive()
    const list = (await w.ok("GET", "/v1/people?scope=all", w.p.owner)) as Json[]
    const by = Object.fromEntries(list.map((x) => [x.userId, x]))
    expect(by[w.p.employee.userId]).toMatchObject({ lastActiveAt: null, status: "active" })
    expect(by[w.p.manager.userId].lastActiveAt).toBe(w.clock.now().toISOString())
    expect(by[w.p.owner.userId]).toHaveProperty("lastActiveAt")
    // a role that reads reports but not settings may list people, never the deactivated ones
    await w.rows("insert into roles (tenant_id, key, label, home, access) select tenant_id, 'rep', 'Rep', home, '{\"reports\":\"read\"}'::jsonb from roles where key = 'manager'")
    const rep = await makeMember(w.deps, w.tenant.id, "rep")
    expect((await w.req("GET", "/v1/people", rep)).status).toBe(200)
    for (const q of ["status=all", "status=deactivated"]) expect((await w.req("GET", `/v1/people?${q}`, rep)).status, q).toBe(403)
    expect((await w.req("GET", "/v1/people?status=bogus", w.p.owner)).status).toBe(400)
  })
})

describe("deactivation lock timeout (minor 1)", () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 })
  afterAll(() => pool.end())
  test.each([["RBAC", 0x72626163], ["shift", 0x73686966]])("a stuck %s writer makes deactivate answer 409 retry after about 5 s, not hang", async (_n, ns) => {
    const w = await world()
    const holder = await pool.connect()
    try {
      await holder.query("begin")
      await holder.query("select pg_advisory_xact_lock($1::int, hashtext($2::text))", [ns, w.tenant.id])
      const started = Date.now()
      const r = await w.req("POST", `/v1/members/${w.p.employee.userId}/deactivate`, w.p.owner)
      const took = Date.now() - started
      expect(r.status).toBe(409)
      expect(((await r.json()) as Json).code).toBe("retry")
      expect(took).toBeGreaterThan(4000)
      expect(took).toBeLessThan(9000)
      expect((await w.rows("select status from memberships where user_id = $1", [w.p.employee.userId]))[0].status).toBe("active")
    } finally {
      await holder.query("rollback")
      holder.release()
    }
    expect((await w.req("POST", `/v1/members/${w.p.employee.userId}/deactivate`, w.p.owner)).status).toBe(200) // once released it goes through
  }, 30_000)
})

describe("last active dedupe (AC4)", () => {
  test("10 parallel requests of one page load produce exactly one stamp transaction; the next window stamps again", async () => {
    const w = await world()
    const who = w.p.employee
    const spy = vi.spyOn(w.deps.db, "transaction")
    for (let i = 0; i < 10; i++) touchLastActive(w.deps, w.tenant.id, who.userId, null) // ten requests that all read the membership before any stamp landed
    await flushLastActive()
    expect(spy.mock.calls.length).toBe(1)
    touchLastActive(w.deps, w.tenant.id, who.userId, null) // still inside the window on the fake clock
    await flushLastActive()
    expect(spy.mock.calls.length).toBe(1)
    w.clock.advance({ minutes: 6 })
    for (let i = 0; i < 10; i++) touchLastActive(w.deps, w.tenant.id, who.userId, null)
    await flushLastActive()
    expect(spy.mock.calls.length).toBe(2)
    expect(new Date((await w.rows("select last_active_at from memberships where user_id = $1", [who.userId]))[0].last_active_at as string).toISOString()).toBe(w.clock.now().toISOString())
    // other people and other tenants dedupe separately
    touchLastActive(w.deps, w.tenant.id, w.p.manager.userId, null)
    await flushLastActive()
    expect(spy.mock.calls.length).toBe(3)
    spy.mockRestore()
  })
})

describe("last active visibility (AC3)", () => {
  test("lastActiveAt is returned only to callers with settings:read, null for everyone else", async () => {
    const w = await world()
    await w.rows("insert into roles (tenant_id, key, label, home, access) select tenant_id, 'rep', 'Rep', home, '{\"reports\":\"read\"}'::jsonb from roles where key = 'manager'")
    const rep = await makeMember(w.deps, w.tenant.id, "rep")
    await w.ok("GET", "/v1/locations", w.p.employee)
    await flushLastActive()
    const seen = async (who: Who) => Object.fromEntries(((await w.ok("GET", "/v1/people?scope=all", who)) as Json[]).map((x) => [x.userId, x.lastActiveAt]))
    expect((await seen(w.p.owner))[w.p.employee.userId]).toBe(w.clock.now().toISOString())
    expect((await seen(w.p.admin))[w.p.employee.userId]).toBe(w.clock.now().toISOString())
    const asRep = await seen(rep)
    expect(Object.keys(asRep).length).toBeGreaterThan(3)
    for (const v of Object.values(asRep)) expect(v).toBeNull()
  })
})

describe("migration 0045 SQL run for real", () => {
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
  afterAll(() => owner.end())
  const file = readFileSync(new URL("../../db/migrations/0045_member_lifecycle.sql", import.meta.url), "utf8")

  test("the real file replayed as app_owner WITHOUT tenant context over 3 seeded tenants: nullable columns, existing rows untouched, composite FK SET NULL keeps tenant_id, app.tenant_id empty", async () => {
    const tenants: { id: string; users: string[]; location: string }[] = []
    for (const label of ["A", "B", "C"]) {
      const id = randomUUID()
      const users = [`u-${randomUUID()}`, `u-${randomUUID()}`]
      await owner.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [id, `m-${id.slice(0, 8)}`, label])
      for (const u of users) await owner.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [u, label, `${u}@example.test`])
      const location = randomUUID()
      const c = await owner.connect()
      try {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        const role = (await c.query("insert into roles (tenant_id, key, label, home, access) values ($1, 'staff', 'Staff', '/', '{}') returning id", [id])).rows[0].id
        for (const u of users) await c.query("insert into memberships (tenant_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', '2026-01-02T03:04:05Z')", [id, u, role])
        await c.query("insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, 'Site', now(), now())", [location, id])
        await c.query("commit")
      } finally {
        c.release()
      }
      tenants.push({ id, users, location })
    }
    const c = await owner.connect()
    try {
      await c.query("begin") // rolled back: nothing stays
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("") // the migrator has no tenant context
      await c.query("alter table memberships drop column deactivated_at, drop column last_active_at, drop column home_location_id cascade") // the state before 0045 (the FK and the index go with the column)
      for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt)
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      const cols = (await c.query("select column_name, is_nullable, data_type from information_schema.columns where table_name = 'memberships' and column_name in ('deactivated_at', 'last_active_at', 'home_location_id') order by 1")).rows
      expect(cols).toEqual([
        { column_name: "deactivated_at", is_nullable: "YES", data_type: "timestamp with time zone" },
        { column_name: "home_location_id", is_nullable: "YES", data_type: "uuid" },
        { column_name: "last_active_at", is_nullable: "YES", data_type: "timestamp with time zone" },
      ])
      // existing rows: per tenant (RLS FORCE), still active with their join date, the three new columns null
      for (const t of tenants) {
        await c.query("select set_config('app.tenant_id', $1, true)", [t.id])
        const rows = (await c.query("select user_id, status, joined_at, deactivated_at, last_active_at, home_location_id from memberships order by user_id")).rows
        expect(rows).toHaveLength(2)
        for (const r of rows) expect(r).toMatchObject({ status: "active", deactivated_at: null, last_active_at: null, home_location_id: null })
        expect(new Date(rows[0].joined_at).toISOString()).toBe("2026-01-02T03:04:05.000Z")
      }
      await c.query("select set_config('app.tenant_id', '', true)")
      expect((await c.query("select count(*)::int as n from memberships")).rows[0].n).toBe(0) // no tenant context: FORCE RLS still hides every row
      // the composite FK: a home location of ANOTHER tenant is refused; deleting the location clears only home_location_id (tenant_id stays)
      const [a, b] = tenants
      await c.query("select set_config('app.tenant_id', $1, true)", [a.id])
      await c.query("savepoint sp")
      await expect(c.query("update memberships set home_location_id = $1 where user_id = $2", [b.location, a.users[0]])).rejects.toMatchObject({ code: "23503" })
      await c.query("rollback to savepoint sp")
      await c.query("update memberships set home_location_id = $1 where user_id = $2", [a.location, a.users[0]])
      await c.query("delete from locations where id = $1", [a.location])
      const [after] = (await c.query("select tenant_id, home_location_id from memberships where user_id = $1", [a.users[0]])).rows
      expect(after).toEqual({ tenant_id: a.id, home_location_id: null })
      expect((await c.query("select indexdef from pg_indexes where indexname = 'memberships_home_location_idx'")).rows[0].indexdef).toContain("(tenant_id, home_location_id)")
    } finally {
      await c.query("rollback")
      c.release()
    }
  })

  test("the journal and the 0045 snapshot follow 0044", () => {
    const j = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] }
    expect(j.entries.slice(44, 46).map((e) => [e.idx, e.tag])).toEqual([[44, "0044_roster_weeks"], [45, "0045_member_lifecycle"]])
    const s = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0045_snapshot.json", import.meta.url), "utf8")) as { prevId: string }
    const prev = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0044_snapshot.json", import.meta.url), "utf8")) as { id: string }
    expect(s.prevId).toBe(prev.id)
  })
})
