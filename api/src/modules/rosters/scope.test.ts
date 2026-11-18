import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import type { Context } from "hono"
import pg from "pg"
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { canSeeLocation, rosterAccess } from "@opsdesk/domain/roster-access"
import type { Role } from "@opsdesk/domain/types"
import { ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, roleIdOf, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import type { AppEnv } from "../../core/context"
import { AppError } from "../../core/errors"
import { loadRole } from "../../core/middleware/permission"
import { locations } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { SHIFT_LOCK_NS } from "../shifts"
import { ROSTER_LOCK_NS, assertLocation, inScopeSql, loadRosterCtx, lockRoster, weekEditGate, type RosterCtx } from "."

// B8 Task 4: the roster access boundary (R8-3, R8-4, R8-5, R8-8). A location the caller cannot see is a 404 with no oracle.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

const poolApp = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 })
afterAll(() => poolApp.end())

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const people: Record<string, { userId: string; email: string; password: string }> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) people[k] = await makeMember(t.deps, tenant.id, k)
  const noGrants = await makeMember(t.deps, tenant.id, "location-supervisor")
  const [l1, l2, l3, lb] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const loc = (tenantId: string, id: string, name: string) => ownerTenantQuery(tenantId, "insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, $3, now(), now())", [id, tenantId, name])
  for (const [id, name] of [[l1, "Alpha"], [l2, "Bravo"], [l3, "Charlie"]] as const) await loc(tenant.id, id, name)
  await loc(other.id, lb, "Alpha") // another tenant's site (same name on purpose)
  await ownerTenantQuery(tenant.id, "insert into location_supervisors (tenant_id, location_id, user_id, created_at) values ($1, $2, $3, now())", [tenant.id, l2, people["location-supervisor"].userId])
  await ownerTenantQuery(tenant.id, "insert into roster_office_limits (tenant_id, user_id, location_id) values ($1, $2, $3)", [tenant.id, people["roster-manager"].userId, l3])
  /** The caller's RosterCtx the way a handler gets it: a request context over the real role row, inside a real tenant tx. */
  const ctxOf = async (who: { userId: string }, need: "read" | "write" = "read"): Promise<RosterCtx> => {
    const [m] = await ownerTenantQuery(tenant.id, "select role_id from memberships where user_id = $1", [who.userId])
    const bag = new Map<string, unknown>([["tenant", { id: tenant.id, timezone: "Europe/Dublin" }], ["member", { userId: who.userId, roleId: m.role_id }], ["deps", t.deps]])
    const c = { get: (k: string) => bag.get(k), set: (k: string, v: unknown) => bag.set(k, v) } as unknown as Context<AppEnv>
    await loadRole(c)
    return withTenant(t.deps.db, tenant.id, async (tx) => {
      if (need === "write") await lockRoster(tx, tenant.id)
      return loadRosterCtx(c, tx, need)
    })
  }
  const cookie = async (who: { email: string; password: string }) => (await signIn(t.app, who.email, who.password)).cookie
  const req = async (method: string, path: string, who: { email: string; password: string }, slug = "acme") => call(t.app, method, path, { cookie: await cookie(who), tenant: slug })
  return { ...t, tenant, other, people, noGrants, l1, l2, l3, lb, ctxOf, req }
}

const thrown = async (fn: () => unknown): Promise<unknown> => {
  try {
    await fn()
  } catch (e) {
    return e
  }
  return undefined
}
const is404 = (e: unknown) => e instanceof AppError && e.status === 404 && e.code === "not_found"

describe("roster scope (adapter over domain rosterAccess)", () => {
  test("owner and admin get scope all, every location, editPublished true", async () => {
    const w = await world()
    for (const k of ["owner", "admin"]) {
      const ctx = await w.ctxOf(w.people[k])
      expect(ctx.access).toMatchObject({ scope: "all", editDraft: true, editPublished: true, approve: true })
      expect([...ctx.access.locationIds!].sort()).toEqual([w.l1, w.l2, w.l3].sort())
      expect(ctx).toMatchObject({ tenantId: w.tenant.id, me: w.people[k].userId, actorId: w.people[k].userId, tz: "Europe/Dublin" })
      expect(ctx.now).toEqual(w.clock.now())
    }
  })

  test("new tenants' template roles carry roster_level (seed), so the adapter sees office and supervisor", async () => {
    const w = await world()
    const rows = (await ownerTenantQuery(w.tenant.id, "select key, roster_level from roles where is_template order by key")) as { key: string; roster_level: string | null }[]
    const m = Object.fromEntries(rows.map((r) => [r.key, r.roster_level]))
    expect(m).toMatchObject({ owner: "office", admin: "office", "roster-manager": "office", "location-supervisor": "supervisor", manager: null, employee: null })
  })

  test("roster manager with an except list sees every location except those; assertLocation throws 404 for an excepted one", async () => {
    const w = await world()
    const ctx = await w.ctxOf(w.people["roster-manager"])
    expect(ctx.access).toMatchObject({ scope: "all", editDraft: true, editPublished: true })
    expect([...ctx.access.locationIds!].sort()).toEqual([w.l1, w.l2].sort())
    expect(assertLocation(ctx, w.l1)).toBeUndefined()
    expect(is404(await thrown(() => assertLocation(ctx, w.l3)))).toBe(true)
    expect(is404(await thrown(() => assertLocation(ctx, randomUUID())))).toBe(true) // indistinguishable from a site that does not exist
    expect(is404(await thrown(() => assertLocation(ctx, w.lb)))).toBe(true) // another tenant's site
  })

  test("location supervisor sees only granted locations; a supervisor with no grants sees none", async () => {
    const w = await world()
    const ctx = await w.ctxOf(w.people["location-supervisor"])
    expect(ctx.access).toMatchObject({ scope: "locations", locationIds: [w.l2], editDraft: true, editPublished: false, approve: false })
    expect(assertLocation(ctx, w.l2)).toBeUndefined()
    for (const id of [w.l1, w.l3]) expect(is404(await thrown(() => assertLocation(ctx, id)))).toBe(true)
    const none = await w.ctxOf(w.noGrants)
    expect(none.access).toMatchObject({ scope: "locations", locationIds: [] })
    for (const id of [w.l1, w.l2, w.l3]) expect(is404(await thrown(() => assertLocation(none, id)))).toBe(true)
  })

  test("manager-home read role: scope all, no edit flags; staff-home role: scope own, no location listing, every location 404", async () => {
    const w = await world()
    const mgr = await w.ctxOf(w.people.manager)
    expect(mgr.access).toMatchObject({ scope: "all", editDraft: false, editPublished: false, approve: false })
    expect(mgr.access.locationIds).toHaveLength(3)
    const staff = await w.ctxOf(w.people.employee)
    expect(staff.access).toMatchObject({ scope: "own", locationIds: null, editDraft: false, editPublished: false, approve: false })
    for (const id of [w.l1, w.l2, w.l3]) expect(is404(await thrown(() => assertLocation(staff, id)))).toBe(true)
  })

  test("a role whose roster access is none cannot build a context (fail closed)", async () => {
    const w = await world()
    await ownerTenantQuery(w.tenant.id, "update roles set access = access || '{\"roster\":\"none\"}'::jsonb where key = 'employee'")
    expect(await thrown(() => w.ctxOf(w.people.employee))).toMatchObject({ status: 403 })
  })
})

describe("inScopeSql", () => {
  test("builds the same cut the adapter returns (property over 4 roles x 3 locations)", async () => {
    const w = await world()
    for (const who of [w.people["roster-manager"], w.people["location-supervisor"], w.noGrants, w.people.employee, w.people.manager]) {
      const ctx = await w.ctxOf(who)
      const got = await withTenant(w.deps.db, w.tenant.id, async (tx) => (await tx.select({ id: locations.id }).from(locations).where(inScopeSql(ctx, locations.id))).map((r) => r.id))
      expect(got.sort()).toEqual([...(ctx.access.locationIds ?? [])].sort())
      for (const id of [w.l1, w.l2, w.l3]) expect([id, got.includes(id)]).toEqual([id, canSeeLocation(ctx.access, id)])
    }
  })

  test("an empty or own scope is `false`, never everything; the SQL carries ids as parameters", async () => {
    const w = await world()
    const staff = await w.ctxOf(w.people.employee)
    const none = await w.ctxOf(w.noGrants)
    expect(inScopeSql(staff, locations.id)).toEqual(sql`false`)
    expect(inScopeSql(none, locations.id)).toEqual(sql`false`)
    const rm = await w.ctxOf(w.people["roster-manager"])
    const q = inScopeSql(rm, locations.id)
    expect(q.queryChunks.some((c) => typeof c === "string" && c.includes(w.l1))).toBe(false) // never interpolated text
  })
})

describe("weekEditGate (every roster_level x week state)", () => {
  const access = (level: "office" | "supervisor" | "read" | "own" | "none"): RosterCtx["access"] => {
    const role = { id: "r", label: "r", description: "", home: level === "own" ? "staff" : "manager", access: { roster: level === "read" || level === "own" ? "read" : level === "none" ? "none" : "write" }, rosterLevel: level === "office" || level === "supervisor" ? level : undefined } as unknown as Role
    return rosterAccess(role, "me", [{ locationId: "L", personId: "me" }], [], ["L"])
  }
  const ctx = (level: Parameters<typeof access>[0]) => ({ access: access(level) }) as RosterCtx
  const gate = (level: Parameters<typeof access>[0], status: "draft" | "published", reason?: string) => {
    try {
      weekEditGate(ctx(level), { status }, reason)
      return "ok"
    } catch (e) {
      return e instanceof AppError ? `${e.status} ${e.code}` : "other"
    }
  }

  test("draft week: office and supervisor pass with or without a reason; read-only, own and none are 403 forbidden", () => {
    for (const reason of [undefined, "", "because"]) {
      expect([gate("office", "draft", reason), gate("supervisor", "draft", reason)]).toEqual(["ok", "ok"])
      expect([gate("read", "draft", reason), gate("own", "draft", reason), gate("none", "draft", reason)]).toEqual(["403 forbidden", "403 forbidden", "403 forbidden"])
    }
  })

  test("published week: supervisor is 403 roster_locked whatever the reason; office needs a non-blank reason (422 reason_required); read-only, own, none are 403 forbidden", () => {
    for (const reason of [undefined, "", "because"]) expect(gate("supervisor", "published", reason)).toBe("403 roster_locked")
    expect([gate("office", "published"), gate("office", "published", ""), gate("office", "published", "   \n")]).toEqual(["422 reason_required", "422 reason_required", "422 reason_required"])
    expect(gate("office", "published", "Covering sickness")).toBe("ok")
    for (const reason of [undefined, "because"]) expect([gate("read", "published", reason), gate("own", "published", reason), gate("none", "published", reason)]).toEqual(["403 forbidden", "403 forbidden", "403 forbidden"])
  })
})

describe("guarded routes (HTTP)", () => {
  test("a role without roster access gets 403 on a guarded probe route; a tenant without M1A gets 403 module_not_entitled", async () => {
    const w = await world()
    await ownerTenantQuery(w.tenant.id, "update roles set access = access || '{\"roster\":\"none\"}'::jsonb where key = 'employee'")
    const r = await w.req("GET", "/v1/_probe/roster", w.people.employee)
    expect(r.status).toBe(403)
    expect(((await r.json()) as Json).code).toBe("forbidden")
    expect((await w.req("GET", "/v1/_probe/roster", w.people.owner)).status).toBe(200)
    // staff with read: allowed on the guard, but "own" scope
    expect((await w.req("POST", "/v1/_probe/roster-write", w.people.manager)).status).toBe(403) // read role on a write guard
    const starter = testApp()
    const t = await makeTenant(starter.deps, { slug: "small", subscription: { planId: "starter" } })
    const o = await makeMember(starter.deps, t.id, "owner")
    const s = await call(starter.app, "GET", "/v1/_probe/roster", { cookie: (await signIn(starter.app, o.email, o.password)).cookie, tenant: "small" })
    expect(s.status).toBe(403)
    expect(((await s.json()) as Json).code).toBe("module_not_entitled")
  })

  test("a location the caller cannot see answers the same 404 as one that does not exist or belongs to another tenant: no oracle, no counts", async () => {
    const w = await world()
    const body = async (id: string, who = w.people["roster-manager"]) => {
      const r = await w.req("GET", `/v1/_probe/roster/locations/${id}`, who)
      const j = (await r.json()) as Json
      return { status: r.status, body: { ...j, requestId: "x" } }
    }
    const hidden = await body(w.l3) // excepted for this roster manager, exists in this tenant
    expect(hidden.status).toBe(404)
    expect(await body(randomUUID())).toEqual(hidden) // missing
    expect(await body(w.lb)).toEqual(hidden) // another tenant's
    expect(await body("not-a-uuid")).toEqual(hidden)
    expect(JSON.stringify(hidden.body)).not.toMatch(/Charlie|location|count/i)
    expect((await body(w.l1)).status).toBe(200)
    const sup = w.people["location-supervisor"]
    expect((await body(w.l1, sup)).status).toBe(404)
    expect((await body(w.l2, sup)).status).toBe(200)
    expect((await body(w.l1, w.people.employee)).status).toBe(404) // staff-home: no location view
    // the listing probe carries ids the caller may see and nothing else (no totals of hidden sites)
    const list = (await (await w.req("GET", "/v1/_probe/roster", w.people["roster-manager"])).json()) as Json
    expect(list.locationIds.sort()).toEqual([w.l1, w.l2].sort())
    expect(Object.keys(list).sort()).toEqual(["approve", "editDraft", "editPublished", "locationIds", "scope"])
  })

  test("the write path re-reads the actor in the tx: a demoted caller is refused on the very next write even with a live session", async () => {
    const w = await world()
    const rm = w.people["roster-manager"]
    expect((await w.req("POST", "/v1/_probe/roster-write", rm)).status).toBe(200)
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [await roleIdOf(w.deps, w.tenant.id, "employee"), rm.userId])
    expect((await w.req("POST", "/v1/_probe/roster-write", rm)).status).toBe(403)
  })
})

describe("roster lock (lock matrix)", () => {
  const key = (tenantId: string, ns = ROSTER_LOCK_NS) => poolApp.query("select pg_try_advisory_lock($1::int, hashtext($2::text)) as got", [ns, tenantId]).then(async (r) => {
    const got = r.rows[0].got as boolean
    if (got) await poolApp.query("select pg_advisory_unlock_all()") // a pooled session lock: release at once
    return got
  })
  const hold = async (w: Awaited<ReturnType<typeof world>>, tenantId: string, then: () => Promise<void>, end: "commit" | "rollback" = "commit") => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let held!: () => void
    const ready = new Promise<void>((r) => (held = r))
    const p = withTenant(w.deps.db, tenantId, async (tx) => {
      await lockRoster(tx, tenantId)
      held()
      await gate
      if (end === "rollback") throw new Error("boom")
    }).catch(() => undefined)
    await ready
    try {
      await then()
    } finally {
      release()
      await p
    }
  }

  test("ROSTER_LOCK_NS is 'rost' and distinct from every other advisory namespace", () => {
    expect(ROSTER_LOCK_NS).toBe(0x726f7374)
    expect(String.fromCharCode(...[24, 16, 8, 0].map((s) => (ROSTER_LOCK_NS >> s) & 0xff))).toBe("rost")
    const others = [SHIFT_LOCK_NS, 0x72626163, 0x73657474, 0x7470726e, 0x74677270, 0x74636865, 0x696e7467, 0x00647372, 0x7465616d]
    expect(others).not.toContain(ROSTER_LOCK_NS)
  })

  test("matrix: held -> same tenant blocked; other tenant free; other namespaces (shifts, rbac, settings) of the same tenant free; released on commit and on rollback", async () => {
    const w = await world()
    for (const end of ["commit", "rollback"] as const) {
      await hold(w, w.tenant.id, async () => {
        expect(await key(w.tenant.id)).toBe(false) // same tenant, same namespace
        expect(await key(w.other.id)).toBe(true) // other tenant
        for (const ns of [SHIFT_LOCK_NS, 0x72626163, 0x73657474]) expect(await key(w.tenant.id, ns)).toBe(true) // other namespaces never share the lock
      }, end)
      expect(await key(w.tenant.id)).toBe(true) // released
    }
  })

  test("two writers of one tenant are serialised: the second waits until the first commits", async () => {
    const w = await world()
    const order: string[] = []
    await hold(w, w.tenant.id, async () => {
      const second = withTenant(w.deps.db, w.tenant.id, async (tx) => {
        await lockRoster(tx, w.tenant.id)
        order.push("second-in")
      })
      await new Promise((r) => setTimeout(r, 300))
      expect(order).toEqual([]) // still waiting
      order.push("first-releasing")
      void second
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(order).toEqual(["first-releasing", "second-in"])
  })

  test("loadRosterCtx(write) refuses a transaction that does not hold the roster lock (the order rule is enforced, not documented)", async () => {
    const w = await world()
    const owner = w.people.owner
    const [m] = await ownerTenantQuery(w.tenant.id, "select role_id from memberships where user_id = $1", [owner.userId])
    const bag = new Map<string, unknown>([["tenant", { id: w.tenant.id, timezone: "Europe/Dublin" }], ["member", { userId: owner.userId, roleId: m.role_id }], ["deps", w.deps]])
    const c = { get: (k: string) => bag.get(k), set: (k: string, v: unknown) => bag.set(k, v) } as unknown as Context<AppEnv>
    await loadRole(c)
    await expect(withTenant(w.deps.db, w.tenant.id, (tx) => loadRosterCtx(c, tx, "write"))).rejects.toThrow(/lockRoster first/)
    // the lock of ANOTHER tenant does not count
    await expect(withTenant(w.deps.db, w.tenant.id, async (tx) => { await lockRoster(tx, w.other.id); return loadRosterCtx(c, tx, "write") })).rejects.toThrow(/lockRoster first/)
    expect((await withTenant(w.deps.db, w.tenant.id, async (tx) => { await lockRoster(tx, w.tenant.id); return loadRosterCtx(c, tx, "write") })).me).toBe(owner.userId)
  })

  test("lock order lockRoster -> actor FOR SHARE -> row FOR UPDATE never deadlocks under concurrency; the reverse order does (40P01)", async () => {
    const w = await world()
    const touch = (tenantId: string, order: "good" | "bad") => withTenant(w.deps.db, tenantId, async (tx) => {
      if (order === "good") await lockRoster(tx, tenantId)
      await tx.execute(sql`select id from locations where id = ${w.l1} for update`)
      if (order === "bad") await lockRoster(tx, tenantId)
      await tx.execute(sql`update locations set version = version + 1 where id = ${w.l1}`)
    })
    // 8 well-ordered writers: all succeed
    await Promise.all(Array.from({ length: 8 }, () => touch(w.tenant.id, "good")))
    expect((await ownerTenantQuery(w.tenant.id, "select version from locations where id = $1", [w.l1]))[0].version).toBe(9)
    // a well-ordered writer against one that takes the row first: the pair deadlocks (the reason the rule exists)
    const results = await Promise.allSettled([
      withTenant(w.deps.db, w.tenant.id, async (tx) => { await tx.execute(sql`select id from locations where id = ${w.l1} for update`); await new Promise((r) => setTimeout(r, 200)); await lockRoster(tx, w.tenant.id) }),
      withTenant(w.deps.db, w.tenant.id, async (tx) => { await lockRoster(tx, w.tenant.id); await new Promise((r) => setTimeout(r, 100)); await tx.execute(sql`select id from locations where id = ${w.l1} for update`) }),
    ])
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
    expect(String(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { cause?: { code?: string } }).cause?.code ?? "")).toBe("40P01")
  })
})

describe("source rules", () => {
  test("no new Date( or Date.now( in api/src/modules/rosters (deps.clock only)", () => {
    const dir = new URL(".", import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    expect(files).toContain("scope.ts")
    for (const f of files) expect([f, /new Date\(|Date\.now\(/.test(readFileSync(new URL(f, dir), "utf8"))]).toEqual([f, false])
  })
})
