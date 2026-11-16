import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { withTenant } from "../../db/tenant-tx"
import { directReports } from "./index"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const who = async (key: string, slug = tenant.slug, tenantId = tenant.id) => {
    const m = await makeMember(t.deps, tenantId, key)
    return { ...m, slug, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager")
  const employee = await who("employee")
  const e2 = await who("employee")
  const req = (method: string, path: string, as: { cookie: string } | null, body?: unknown, slug = "acme") => call(t.app, method, path, { cookie: as?.cookie, tenant: slug, body })
  const lastAudit = async () => (await ownerTenantQuery(tenant.id, "select * from audit_events order by seq desc limit 1"))[0] as Json
  const mkTeam = async (name: string, kind?: string) => ((await (await req("POST", "/v1/teams", owner, { name, kind })).json()) as Json)
  const setMgr = (userId: string, managerId: string | null, as = owner) => req("PUT", `/v1/members/${userId}/manager`, as, { managerId })
  return { ...t, tenant, who, owner, manager, employee, e2, req, lastAudit, mkTeam, setMgr }
}

describe("teams", () => {
  test("a member can be in several teams", async () => {
    const w = await world()
    const a = await w.mkTeam("Alpha")
    const b = await w.mkTeam("Beta")
    expect((await w.req("PUT", `/v1/teams/${a.id}/members`, w.owner, { userIds: [w.employee.userId, w.e2.userId] })).status).toBe(200)
    expect((await w.req("PUT", `/v1/teams/${b.id}/members`, w.owner, { userIds: [w.employee.userId] })).status).toBe(200)
    const mine = (await (await w.req("GET", `/v1/teams?member=${w.employee.userId}`, w.employee)).json()) as Json[]
    expect(mine.map((x) => x.name).sort()).toEqual(["Alpha", "Beta"])
    const other = (await (await w.req("GET", `/v1/teams?member=${w.e2.userId}`, w.employee)).json()) as Json[]
    expect(other.map((x) => x.name)).toEqual(["Alpha"])
    expect(mine.find((x) => x.name === "Alpha")!.memberIds.sort()).toEqual([w.employee.userId, w.e2.userId].sort())
    expect(((await (await w.req("GET", "/v1/teams", w.employee)).json()) as Json[]).length).toBe(2)
  })

  test("PUT members replaces the set and audits before/after", async () => {
    const w = await world()
    const a = await w.mkTeam("Alpha")
    await w.req("PUT", `/v1/teams/${a.id}/members`, w.owner, { userIds: [w.employee.userId, w.e2.userId] })
    const r = await w.req("PUT", `/v1/teams/${a.id}/members`, w.owner, { userIds: [w.e2.userId] })
    expect(((await r.json()) as Json).memberIds).toEqual([w.e2.userId])
    const audit = await w.lastAudit()
    expect(audit.action).toBe("team.members_set")
    expect(audit.actor_id).toBe(w.owner.userId)
    expect(audit.before.userIds.sort()).toEqual([w.employee.userId, w.e2.userId].sort())
    expect(audit.after.userIds).toEqual([w.e2.userId])
  })

  test("create / patch / delete a team, each audited; name is unique per tenant", async () => {
    const w = await world()
    const created = await w.req("POST", "/v1/teams", w.owner, { name: "Night shift" })
    expect(created.status).toBe(201)
    const t = (await created.json()) as Json
    expect(t).toMatchObject({ name: "Night shift", kind: "team", memberIds: [] })
    expect((await w.lastAudit()).action).toBe("team.created")
    expect((await w.req("POST", "/v1/teams", w.owner, { name: "Night shift" })).status).toBe(409)
    const p = await w.req("PATCH", `/v1/teams/${t.id}`, w.owner, { name: "Late shift" })
    expect(p.status).toBe(200)
    expect(((await p.json()) as Json).name).toBe("Late shift")
    const a = await w.lastAudit()
    expect(a.action).toBe("team.updated")
    expect(a.before.name).toBe("Night shift")
    expect(a.after.name).toBe("Late shift")
    expect((await w.req("DELETE", `/v1/teams/${t.id}`, w.owner)).status).toBe(204)
    expect((await w.lastAudit()).action).toBe("team.deleted")
    expect((await w.req("DELETE", `/v1/teams/${t.id}`, w.owner)).status).toBe(404)
    expect(((await (await w.req("GET", "/v1/teams", w.owner)).json()) as Json[]).length).toBe(0)
  })

  test("deleting a team removes its memberships of the team", async () => {
    const w = await world()
    const a = await w.mkTeam("Alpha")
    await w.req("PUT", `/v1/teams/${a.id}/members`, w.owner, { userIds: [w.employee.userId] })
    await w.req("DELETE", `/v1/teams/${a.id}`, w.owner)
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from team_members")).toEqual([])
  })

  test("departments are teams with kind=department (A.5)", async () => {
    const w = await world()
    const d = await w.mkTeam("Security", "department")
    expect(d.kind).toBe("department")
    await w.mkTeam("Crew")
    const all = (await (await w.req("GET", "/v1/teams", w.employee)).json()) as Json[]
    expect(all.map((x) => `${x.name}:${x.kind}`).sort()).toEqual(["Crew:team", "Security:department"])
    const deps = (await (await w.req("GET", "/v1/teams?kind=department", w.employee)).json()) as Json[]
    expect(deps.map((x) => x.name)).toEqual(["Security"])
    expect((await w.req("POST", "/v1/teams", w.owner, { name: "X", kind: "squad" })).status).toBe(400)
    expect((await w.req("PATCH", `/v1/teams/${d.id}`, w.owner, { kind: "team" })).status).toBe(200)
  })

  test("mutations need settings:write; reads need only membership", async () => {
    const w = await world()
    const a = await w.mkTeam("Alpha")
    for (const [m, p, b] of [
      ["POST", "/v1/teams", { name: "Z" }],
      ["PATCH", `/v1/teams/${a.id}`, { name: "Z" }],
      ["DELETE", `/v1/teams/${a.id}`, undefined],
      ["PUT", `/v1/teams/${a.id}/members`, { userIds: [] }],
      ["PUT", `/v1/members/${w.employee.userId}/manager`, { managerId: null }],
    ] as const) {
      expect((await w.req(m, p, w.employee, b)).status, `${m} ${p} employee`).toBe(403)
      expect((await w.req(m, p, w.manager, b)).status, `${m} ${p} manager (settings read only)`).toBe(403)
    }
    expect((await w.req("GET", "/v1/teams", w.employee)).status).toBe(200)
    expect((await w.req("GET", "/v1/teams", null)).status).toBe(401)
  })

  test("ids from another tenant are 404; non-member ids in a body are 422 not_a_member", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "other" })
    const oOwner = await w.who("owner", "other", other.id)
    const oTeam = (await (await w.req("POST", "/v1/teams", oOwner, { name: "Theirs" }, "other")).json()) as Json
    expect((await w.req("PATCH", `/v1/teams/${oTeam.id}`, w.owner, { name: "x" })).status).toBe(404)
    expect((await w.req("DELETE", `/v1/teams/${oTeam.id}`, w.owner)).status).toBe(404)
    expect((await w.req("PUT", `/v1/teams/${oTeam.id}/members`, w.owner, { userIds: [] })).status).toBe(404)
    const mine = await w.mkTeam("Alpha")
    const r = await w.req("PUT", `/v1/teams/${mine.id}/members`, w.owner, { userIds: [oOwner.userId] })
    expect(r.status).toBe(422)
    expect(((await r.json()) as Json).code).toBe("not_a_member")
    // path user of another tenant -> 404; manager of another tenant in the body -> 422
    expect((await w.setMgr(oOwner.userId, w.manager.userId)).status).toBe(404)
    const m = await w.setMgr(w.employee.userId, oOwner.userId)
    expect(m.status).toBe(422)
    expect(((await m.json()) as Json).code).toBe("not_a_member")
    // the other tenant's team is not listed
    expect(((await (await w.req("GET", "/v1/teams", w.owner)).json()) as Json[]).length).toBe(1)
    // an unauthenticated-for-this-tenant user cannot even select it
    expect((await w.req("GET", "/v1/teams", oOwner)).status).toBe(404)
  })
})

describe("reporting lines", () => {
  test("a member has exactly one primary manager; setting again replaces it", async () => {
    const w = await world()
    expect((await w.setMgr(w.employee.userId, w.manager.userId)).status).toBe(200)
    expect((await w.setMgr(w.employee.userId, w.e2.userId)).status).toBe(200)
    const rows = await ownerTenantQuery(w.tenant.id, "select manager_id from reporting_lines where user_id=$1", [w.employee.userId])
    expect(rows).toEqual([{ manager_id: w.e2.userId }])
    const a = await w.lastAudit()
    expect(a.action).toBe("member.manager_set")
    expect(a.before.managerId).toBe(w.manager.userId)
    expect(a.after.managerId).toBe(w.e2.userId)
    expect((await w.setMgr(w.employee.userId, null)).status).toBe(200)
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from reporting_lines")).toEqual([])
  })

  test("the database allows one manager row per member", async () => {
    const w = await world()
    await w.setMgr(w.employee.userId, w.manager.userId)
    await expect(
      ownerTenantQuery(w.tenant.id, "insert into reporting_lines (tenant_id,user_id,manager_id) values ($1,$2,$3)", [w.tenant.id, w.employee.userId, w.e2.userId]),
    ).rejects.toMatchObject({ code: "23505" }) // raw pg error (owner helper is not drizzle-wrapped)
  })

  test("reporting cycle A→B→A is rejected with 409 reporting_cycle", async () => {
    const w = await world()
    expect((await w.setMgr(w.employee.userId, w.manager.userId)).status).toBe(200) // employee -> manager
    const r = await w.setMgr(w.manager.userId, w.employee.userId) // manager -> employee closes the loop
    expect(r.status).toBe(409)
    expect(((await r.json()) as Json).code).toBe("reporting_cycle")
    // longer chain: e2 -> employee -> manager ; manager -> e2 is a cycle
    expect((await w.setMgr(w.e2.userId, w.employee.userId)).status).toBe(200)
    expect(((await (await w.setMgr(w.manager.userId, w.e2.userId)).json()) as Json).code).toBe("reporting_cycle")
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from reporting_lines where user_id=$1", [w.manager.userId])).toEqual([])
  })

  test("self as manager is 422", async () => {
    const w = await world()
    const r = await w.setMgr(w.employee.userId, w.employee.userId)
    expect(r.status).toBe(422)
    expect(((await r.json()) as Json).code).toBe("self_manager")
  })

  test("two simultaneous changes that together form a cycle cannot both succeed", async () => {
    for (let i = 0; i < 4; i++) {
      await resetDb()
      const w = await world()
      const [a, b] = await Promise.all([w.setMgr(w.employee.userId, w.e2.userId), w.setMgr(w.e2.userId, w.employee.userId)])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      expect((await ownerTenantQuery(w.tenant.id, "select 1 from reporting_lines")).length).toBe(1)
    }
  })

  test("directReports(tx, managerId) lists the user ids below a manager", async () => {
    const w = await world()
    await w.setMgr(w.employee.userId, w.manager.userId)
    await w.setMgr(w.e2.userId, w.manager.userId)
    const ids = await withTenant(w.deps.db, w.tenant.id, (tx) => directReports(tx, w.manager.userId))
    expect(ids.sort()).toEqual([w.employee.userId, w.e2.userId].sort())
    expect(await withTenant(w.deps.db, w.tenant.id, (tx) => directReports(tx, w.employee.userId))).toEqual([])
  })

  test("removing the membership drops its reporting line and team links (composite FKs)", async () => {
    const w = await world()
    const a = await w.mkTeam("Alpha")
    await w.req("PUT", `/v1/teams/${a.id}/members`, w.owner, { userIds: [w.employee.userId] })
    await w.setMgr(w.employee.userId, w.manager.userId)
    await ownerTenantQuery(w.tenant.id, "delete from memberships where user_id=$1", [w.employee.userId])
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from reporting_lines")).toEqual([])
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from team_members")).toEqual([])
    expect((await ownerQuery("select count(*)::int n from tenants"))[0].n).toBe(1)
  })
})

describe("people", () => {
  async function org() {
    const w = await world()
    await w.setMgr(w.employee.userId, w.manager.userId)
    await w.setMgr(w.manager.userId, w.owner.userId)
    return w
  }

  test("people?scope=team returns only direct reports for a manager role", async () => {
    const w = await org()
    const r = await w.req("GET", "/v1/people?scope=team", w.manager)
    expect(r.status).toBe(200)
    const rows = (await r.json()) as Json[]
    expect(rows.map((p) => p.userId)).toEqual([w.employee.userId])
    expect(rows[0]).toMatchObject({ email: w.employee.email, roleKey: "employee", managerId: w.manager.userId })
  })

  test("a team-scoped manager cannot ask for all; default scope is their own ceiling", async () => {
    const w = await org()
    expect((await w.req("GET", "/v1/people?scope=all", w.manager)).status).toBe(403)
    const dflt = (await (await w.req("GET", "/v1/people", w.manager)).json()) as Json[]
    expect(dflt.map((p) => p.userId)).toEqual([w.employee.userId])
    const own = (await (await w.req("GET", "/v1/people?scope=own", w.manager)).json()) as Json[]
    expect(own.map((p) => p.userId)).toEqual([w.manager.userId])
  })

  test("people?scope=all is 403 for an employee (staff role); own is allowed", async () => {
    const w = await org()
    expect((await w.req("GET", "/v1/people?scope=all", w.employee)).status).toBe(403)
    expect((await w.req("GET", "/v1/people?scope=team", w.employee)).status).toBe(403)
    const own = (await (await w.req("GET", "/v1/people?scope=own", w.employee)).json()) as Json[]
    expect(own.map((p) => p.userId)).toEqual([w.employee.userId])
    const dflt = (await (await w.req("GET", "/v1/people", w.employee)).json()) as Json[]
    expect(dflt.map((p) => p.userId)).toEqual([w.employee.userId])
  })

  test("an all-scope role (owner) sees every member; invalid scope is 400; another tenant's people never leak", async () => {
    const w = await org()
    const other = await makeTenant(w.deps, { slug: "other" })
    await w.who("owner", "other", other.id)
    const rows = (await (await w.req("GET", "/v1/people?scope=all", w.owner)).json()) as Json[]
    expect(rows.map((p) => p.userId).sort()).toEqual([w.owner.userId, w.manager.userId, w.employee.userId, w.e2.userId].sort())
    expect((await w.req("GET", "/v1/people?scope=everyone", w.owner)).status).toBe(400)
  })

  test("a clone of the manager role keeps the team ceiling (not widened to all)", async () => {
    const w = await org()
    const src = (await ownerTenantQuery(w.tenant.id, "select id from roles where key='manager'"))[0].id as string
    const cloned = (await (await w.req("POST", `/v1/roles/${src}/clone`, w.owner, { label: "Shift manager" })).json()) as Json
    const c = await w.who("employee")
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id=$1 where user_id=$2", [cloned.id, c.userId])
    const cc = { ...c, cookie: (await signIn(w.app, c.email, c.password)).cookie }
    expect((await w.req("GET", "/v1/people?scope=all", cc)).status).toBe(403)
    expect((await w.req("GET", "/v1/people?scope=team", cc)).status).toBe(200)
  })
})
