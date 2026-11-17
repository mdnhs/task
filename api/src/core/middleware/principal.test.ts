import { beforeEach, describe, expect, test } from "vitest"
import { makeApiKey, makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { requirePermission } from "./permission"
import { actorIdOf, subjectUserId } from "./principal"
import { requireTenant } from "./tenant"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

async function world() {
  const t = testApp()
  t.app.get("/v1/_probe/principal", requireTenant, requirePermission("tasks", "read"), (c) => c.json({ subject: subjectUserId(c), actor: actorIdOf(c) }))
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const who = async (role: string) => {
    const m = await makeMember(t.deps, tenant.id, role)
    return { ...m, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager")
  const staff = await who("employee")
  const mint = (as: { userId: string }, scopes: string[]) => makeApiKey(t.deps, tenant.id, as.userId, scopes)
  return { ...t, tenant, owner, manager, staff, mint }
}

describe("principal helpers", () => {
  test("subjectUserId is the creator for an api key and the member otherwise; actorIdOf is apikey:<id> for keys", async () => {
    const w = await world()
    const viaSession = (await (await call(w.app, "GET", "/v1/_probe/principal", { cookie: w.staff.cookie, tenant: "acme" })).json()) as Json
    expect(viaSession).toEqual({ subject: w.staff.userId, actor: w.staff.userId })
    const key = await w.mint(w.staff, ["tasks:read"])
    const viaKey = (await (await call(w.app, "GET", "/v1/_probe/principal", { headers: { authorization: `Bearer ${key.key}` } })).json()) as Json
    expect(viaKey).toEqual({ subject: w.staff.userId, actor: `apikey:${key.id}` })
  })

  test("/v1/people with an api key created by a team manager lists that manager's team (regression of the B3 follow-up)", async () => {
    const w = await world()
    expect((await call(w.app, "PUT", `/v1/members/${w.staff.userId}/manager`, { cookie: w.owner.cookie, tenant: "acme", body: { managerId: w.manager.userId } })).status).toBe(200)
    const key = await w.mint(w.manager, ["reports:read"])
    const r = await call(w.app, "GET", "/v1/people", { headers: { authorization: `Bearer ${key.key}` } })
    expect(r.status).toBe(200)
    const people = (await r.json()) as Json[]
    expect(people.map((p) => p.userId)).toEqual([w.staff.userId]) // the manager's direct reports, exactly what the manager sees
    const own = (await (await call(w.app, "GET", "/v1/people", { cookie: w.manager.cookie, tenant: "acme" })).json()) as Json[]
    expect(people).toEqual(own)
  })
})
