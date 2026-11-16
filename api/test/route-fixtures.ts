import type { AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { call } from "./harness"
import { makeMember, roleIdOf, signIn } from "./factories"

/**
 * Fixtures for the cross-tenant walker (isolation.test.ts, AC-M0-01).
 *
 * EVERY LATER PHASE ADDS ITS ROUTES HERE. A `/v1` route with a path param that has no entry in `ROUTE_PARAMS`
 * (or a param with no resource mapping) makes the walker fail by name, so a new endpoint cannot ship un-walked.
 *
 * Deviation from the brief's flat `Record<param, id>`: `{id}` means a role, a team or a device depending on the
 * route, so a flat map cannot give a real record per route. Fixtures are therefore keyed by the OpenAPI path
 * template, then by param name.
 *
 * `kind: "id"`     the value is a real record id belonging to that tenant (the walker asserts 404 for tenant B's).
 * `kind: "static"` the value is a fixed vocabulary word (e.g. a device feature), not a tenant record.
 */
export type Fixture = { kind: "id" | "static"; value: string }
export type TenantFixtures = Record<string, Record<string, Fixture>>

type Resource = "role" | "member" | "team" | "device" | "feature"

/** path template -> param -> which resource that param names on that route. */
export const ROUTE_PARAMS: Record<string, Record<string, Resource>> = {
  "/v1/roles/{id}": { id: "role" },
  "/v1/roles/{id}/clone": { id: "role" },
  "/v1/members/{userId}": { userId: "member" },
  "/v1/members/{userId}/manager": { userId: "member" },
  "/v1/teams/{id}": { id: "team" },
  "/v1/teams/{id}/members": { id: "team" },
  "/v1/devices/{id}": { id: "device" },
  "/v1/devices/{id}/bind": { id: "device" },
  "/v1/devices/{id}/enrolment-code": { id: "device" },
  "/v1/device-policies/{feature}": { feature: "feature" },
}

export type Actor = { userId: string; cookie: string; slug: string }
export type World = {
  tenant: { id: string; slug: string }
  owner: Actor
  staff: Actor
  /** a distinctive string per kind of tenant data; the walker greps 404 bodies for these */
  marks: string[]
  fixtures: TenantFixtures
  resources: Record<Exclude<Resource, "feature">, string>
}

let n = 0

/** One member with a signed-in session in `tenant`. */
export async function actorIn(t: { app: AppType; deps: Deps }, tenant: { id: string; slug: string }, roleKey: string): Promise<Actor & { email: string }> {
  const m = await makeMember(t.deps, tenant.id, roleKey)
  return { userId: m.userId, email: m.email, slug: tenant.slug, cookie: (await signIn(t.app, m.email, m.password)).cookie }
}

/** Creates one role/member/team/device in the tenant (through the real API as its owner) and maps every walked route param to them. */
export async function fixtureIds(t: { app: AppType; deps: Deps }, tenant: { id: string; slug: string }, owner: Actor, staff: Actor, deviceUser: Actor = staff): Promise<{ fixtures: TenantFixtures; resources: World["resources"]; marks: string[] }> {
  const uniq = `${tenant.slug}-${(n++).toString(36)}`
  const post = async (path: string, body: unknown) => {
    const r = await call(t.app, "POST", path, { cookie: owner.cookie, tenant: tenant.slug, body })
    if (r.status !== 201) throw new Error(`fixture POST ${path} failed: ${r.status} ${await r.text()}`)
    return (await r.json()) as { id: string; name?: string; label?: string }
  }
  const team = await post("/v1/teams", { name: `Team ${uniq}`, kind: "team" })
  const device = await post("/v1/devices", { userId: deviceUser.userId, type: "pc", owner: "company", label: `Device ${uniq}`, trusted: true })
  const resources = { role: await roleIdOf(t.deps, tenant.id, "employee"), member: staff.userId, team: team.id, device: device.id }
  const fixtures: TenantFixtures = {}
  for (const [path, params] of Object.entries(ROUTE_PARAMS)) {
    fixtures[path] = {}
    for (const [param, res] of Object.entries(params)) {
      fixtures[path][param] = res === "feature" ? { kind: "static", value: "drive" } : { kind: "id", value: resources[res] }
    }
  }
  return { fixtures, resources, marks: [tenant.id, tenant.slug, team.id, device.id, staff.userId, owner.userId, `Team ${uniq}`, `Device ${uniq}`] }
}
