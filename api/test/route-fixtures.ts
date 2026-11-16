import type { AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { ownerTenantQuery } from "./db"
import { call } from "./harness"
import { makeMember, roleIdOf, signIn } from "./factories"
import { notify, withTenantAfterCommit } from "../src/modules/notifications"

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

type Resource = "role" | "member" | "team" | "device" | "feature" | "notification" | "pushToken" | "file" | "integration" | "dataRequest"

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
  "/v1/notifications/{id}/read": { id: "notification" },
  "/v1/me/push-tokens/{id}": { id: "pushToken" },
  "/v1/files/{id}": { id: "file" },
  "/v1/files/{id}/complete": { id: "file" },
  "/v1/files/{id}/download": { id: "file" },
  "/v1/integrations/{id}": { id: "integration" },
  "/v1/data-requests/{id}": { id: "dataRequest" },
  "/v1/data-requests/{id}/complete": { id: "dataRequest" },
  "/v1/data-requests/{id}/reject": { id: "dataRequest" },
  "/v1/data-requests/{id}/retry": { id: "dataRequest" },
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
  // the owner's own notification and push token (the walker acts as the owner of A; ids of B's owner must 404)
  await withTenantAfterCommit(t.deps, tenant.id, (tx, enqueue) => notify(tx, tenant.id, { userId: owner.userId, kind: "system", title: `Notice ${uniq}`, body: "b" }, t.deps, enqueue))
  const [notif] = await ownerTenantQuery(tenant.id, "select id from notifications where title = $1", [`Notice ${uniq}`])
  const tokRes = await call(t.app, "POST", "/v1/me/push-tokens", { cookie: owner.cookie, tenant: tenant.slug, body: { token: `fcm-${uniq}-xxxxxxxx`, platform: "android" } })
  if (tokRes.status !== 201) throw new Error(`fixture push token failed: ${tokRes.status}`)
  const fileRes = await call(t.app, "POST", "/v1/files/uploads", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `File ${uniq}.pdf`, mime: "application/pdf", sizeBytes: 1024 } })
  if (fileRes.status !== 201) throw new Error(`fixture file intent failed: ${fileRes.status}`)
  const file = (await fileRes.json()) as { fileId: string }
  // the tenant's (single) google connection, reset to `connected` by every call; the ciphertext is junk on purpose (never opened by the walked route)
  const [integ] = await ownerTenantQuery(
    tenant.id,
    `insert into integration_connections (tenant_id, provider, status, scopes, account_email, token_ciphertext, connected_by, connected_at)
     values ($1::uuid, 'google', 'connected', array['openid'], $3, 'v2:junk', $2, now())
     on conflict (tenant_id, provider) do update set status = 'connected', token_ciphertext = 'v2:junk', account_email = $3 returning id`,
    [tenant.id, owner.userId, `drive-${uniq}@example.com`],
  )
  // a pending `correct` request about the staff member (correct is the one kind with no job and no open-request limit, so the fixture can be made again and again)
  const dsr = await post("/v1/data-requests", { subjectUserId: staff.userId, kind: "correct", reason: `Fix ${uniq}` })
  const resources = { dataRequest: dsr.id, integration: String(integ.id), file: file.fileId, role: await roleIdOf(t.deps, tenant.id, "employee"), member: staff.userId, team: team.id, device: device.id, notification: String(notif.id), pushToken: ((await tokRes.json()) as { id: string }).id }
  const fixtures: TenantFixtures = {}
  for (const [path, params] of Object.entries(ROUTE_PARAMS)) {
    fixtures[path] = {}
    for (const [param, res] of Object.entries(params)) {
      fixtures[path][param] = res === "feature" ? { kind: "static", value: "drive" } : { kind: "id", value: resources[res] }
    }
  }
  return { fixtures, resources, marks: [tenant.id, tenant.slug, String(integ.id), `drive-${uniq}@example.com`, team.id, device.id, file.fileId, dsr.id, `Fix ${uniq}`, `File ${uniq}.pdf`, staff.userId, owner.userId, `Team ${uniq}`, `Device ${uniq}`] }
}
