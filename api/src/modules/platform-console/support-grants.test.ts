import { beforeEach, describe, expect, test, vi } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeStaff as rawStaff, makeTenant, makeUser, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { SUPPORT_DENIED_ROUTES, supportRole } from "../../core/middleware/support"
import { verifyChain } from "../audit"
import { verifyPlatformChain } from "../platform-audit"
import { MODULES } from "../rbac"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const NIL = "00000000-0000-4000-8000-000000000000"
beforeEach(resetDb)

/** A platform staff member with an MFA-passed `cookie` and a pre-MFA `staleCookie`. */
async function makeStaff(...a: Parameters<typeof rawStaff>) {
  const s = await rawStaff(...a)
  return { ...s, cookie: s.cookie!, staleCookie: s.staleCookie! }
}
const code = async (r: Response) => ((await r.clone().json()) as Json).code
const tenantAudit = async (tenantId: string): Promise<Json[]> => ownerTenantQuery(tenantId, "select seq, actor_id, action, entity, entity_id, before, after from audit_events where tenant_id = $1 order by seq", [tenantId])
const platAudit = async (): Promise<Json[]> => ownerQuery("select actor_id, action, entity, entity_id, target_tenant_id, before, after from platform_audit_events order by seq")
const actions = async (tenantId: string, action: string) => (await tenantAudit(tenantId)).filter((r) => r.action === action)

async function world() {
  const t = testApp()
  let probeRuns = 0
  // test-only probes guarded exactly like real routes (ruling 6: the synthetic role never reaches a write permission)
  for (const m of MODULES) {
    t.app.get(`/v1/_probe/support/${m}/read`, requireTenant, requirePermission(m, "read"), (c) => c.json({ ok: true }))
    t.app.get(`/v1/_probe/support/${m}/write`, requireTenant, requirePermission(m, "write"), (c) => c.json({ ok: true }))
  }
  t.app.get("/v1/_probe/support/count", requireTenant, (c) => {
    probeRuns++
    return c.json({ ok: true })
  })
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "bravo" })
  const who = async (key: string, tenantId = tenant.id) => {
    const m = await makeMember(t.deps, tenantId, key)
    return { ...m, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const support = await makeStaff(t.deps, "support")
  const platOwner = await makeStaff(t.deps, "owner")
  const req = (method: string, path: string, cookie: string | undefined, o: { tenant?: string; body?: unknown } = {}) => call(t.app, method, path, { cookie, tenant: o.tenant, body: o.body })
  const grant = async (staff: { cookie: string }, tenantId = tenant.id, body: unknown = { reason: "Ticket 4411: report totals look wrong", hours: 2 }) =>
    req("POST", `/v1/platform/tenants/${tenantId}/support-grants`, staff.cookie, { body })
  const asStaff = (method: string, path: string, staff: { cookie: string } = support, slug = tenant.slug, body?: unknown) => req(method, path, staff.cookie, { tenant: slug, body })
  const doc = (await (await call(t.app, "GET", "/v1/openapi.json")).json()) as { paths: Record<string, Record<string, Json>> }
  return { ...t, tenant, other, who, owner, support, platOwner, req, grant, asStaff, doc, probeRuns: () => probeRuns }
}
type W = Awaited<ReturnType<typeof world>>

/** Every REGISTERED tenant route: the ones whose middleware chain contains requireTenant (taken from app.routes, not hand-picked). */
function tenantRoutes(w: W): { method: string; path: string; url: string; body: unknown }[] {
  const seen = new Map<string, { method: string; path: string; url: string; body: unknown }>()
  for (const r of w.app.routes) {
    if (r.handler !== requireTenant || r.method === "ALL" || r.path.startsWith("/v1/_probe/")) continue
    const path = r.path.replace(/:(\w+)/g, "{$1}")
    const url = path.replace(/\{(\w+)\}/g, (_, p: string) => (p === "feature" ? "drive" : p === "userId" ? "usr_ghost" : NIL))
    const op = w.doc.paths[path]?.[r.method.toLowerCase()]
    const schema = op?.requestBody?.content?.["application/json"]?.schema as Json | undefined
    seen.set(`${r.method} ${path}`, { method: r.method, path, url, body: op?.requestBody ? (schema?.example ?? {}) : undefined })
  }
  return [...seen.values()]
}

const TABLES = ["roles", "memberships", "teams", "team_members", "reporting_lines", "devices", "device_policies", "invites", "tenant_settings", "notifications", "notification_preferences", "push_tokens", "files", "integration_connections", "public_holidays", "data_requests", "subscriptions", "support_grants"]
async function hashes(tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const tbl of TABLES) {
    const [r] = await ownerTenantQuery(tenantId, `select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)), '') as h from ${tbl} x`)
    out[tbl] = String(r.h)
  }
  return out
}

describe("grant path in requireTenant", () => {
  test("staff without an active grant get 404 on every tenant route of that tenant", async () => {
    const w = await world()
    const routes = tenantRoutes(w)
    expect(routes.length).toBeGreaterThanOrEqual(40) // the walk is not vacuous
    expect(routes.some((r) => r.path === "/v1/settings/support-grants")).toBe(true)
    // the support staff holds an ACTIVE grant for the OTHER tenant only: it must not open this one
    expect((await w.grant(w.support, w.other.id)).status).toBe(201)
    const stranger = await makeUser(w.deps, { totp: true })
    const failures: string[] = []
    for (const r of routes) {
      for (const [label, cookie] of [["support", w.support.cookie], ["platform owner", w.platOwner.cookie], ["stranger", stranger.cookie!]] as const) {
        const res = await w.req(r.method, r.url, cookie, { tenant: w.tenant.slug, body: r.body })
        const c = res.status === 404 ? await code(res) : undefined
        if (res.status !== 404 || c !== "not_found") failures.push(`${label} ${r.method} ${r.path} -> ${res.status} ${c ?? ""}`)
      }
    }
    expect(failures).toEqual([])
    // staff who never held a grant for this tenant leave no trace in its audit chain
    expect((await tenantAudit(w.tenant.id)).filter((a) => String(a.action).startsWith("support."))).toEqual([])
    // and the grant for the other tenant still works there
    expect((await w.asStaff("GET", "/v1/me/tenant", w.support, w.other.slug)).status).toBe(200)
  }, 120_000)

  test("with an active grant staff can GET tenant routes; every request writes support.access to the tenant audit", async () => {
    const w = await world()
    const created = await w.grant(w.support)
    expect(created.status).toBe(201)
    const g = (await created.json()) as Json
    expect(g).toMatchObject({ tenantId: w.tenant.id, staffUserId: w.support.userId, status: "active" })

    const me = await w.asStaff("GET", "/v1/me/tenant")
    expect(me.status).toBe(200)
    expect(((await me.json()) as Json).member).toMatchObject({ userId: w.support.userId, roleKey: "support" })
    for (const p of ["/v1/people", "/v1/roles", "/v1/teams", "/v1/audit?limit=5", "/v1/settings/organisation", "/v1/entitlements"]) {
      const r = await w.asStaff("GET", p)
      expect(r.status, p).toBe(200)
    }
    expect((await w.asStaff("HEAD", "/v1/roles")).status).toBe(200)
    const rows = await actions(w.tenant.id, "support.access")
    expect(rows.map((r) => `${r.after.method} ${r.after.path}`)).toEqual([
      "GET /v1/me/tenant", "GET /v1/people", "GET /v1/roles", "GET /v1/teams", "GET /v1/audit", "GET /v1/settings/organisation", "GET /v1/entitlements", "HEAD /v1/roles",
    ]) // path only: the query string is never recorded
    for (const r of rows) {
      expect(r).toMatchObject({ actor_id: `platform:${w.support.userId}`, entity: "support_grant", entity_id: g.id })
      expect(r.after).toMatchObject({ grantId: g.id, at: w.clock.now().toISOString() })
    }

    // walk EVERY registered GET tenant route: allowed ones are audited one-for-one, deny-listed ones refused
    const gets = tenantRoutes(w).filter((r) => r.method === "GET")
    const before = (await actions(w.tenant.id, "support.access")).length
    let allowed = 0
    const failures: string[] = []
    for (const r of gets) {
      const res = await w.asStaff("GET", r.url)
      if (res.status >= 500) failures.push(`${r.path} -> ${res.status}`)
      // roster ids answer the one generic 404 by design (R8-4: a hidden, missing or foreign location look the same), so a made-up id is not_found even under a grant
      if (res.status === 404 && (await code(res)) === "not_found" && !/^\/v1\/(locations|roster\/(weeks|shifts))\/\{id\}/.test(r.path)) failures.push(`${r.path} -> 404 not_found under an active grant`)
      if (res.status === 403 && (await code(res)) === "support_forbidden_route") continue
      allowed++
    }
    expect(failures).toEqual([])
    expect(allowed).toBeGreaterThanOrEqual(15)
    expect((await actions(w.tenant.id, "support.access")).length - before).toBe(allowed)
    expect(await verifyChain(w.deps.db, w.tenant.id)).toMatchObject({ ok: true })
  }, 120_000)

  test("expired or write attempts under a support grant are refused and audited", async () => {
    const w = await world()
    const g = (await (await w.grant(w.support, w.tenant.id, { reason: "Investigate sync", hours: 1 })).json()) as Json
    const writes = tenantRoutes(w).filter((r) => r.method !== "GET")
    expect(writes.length).toBeGreaterThanOrEqual(25)
    const before = await hashes(w.tenant.id)
    const failures: string[] = []
    for (const r of writes) {
      const res = await w.asStaff(r.method, r.url, w.support, w.tenant.slug, r.body)
      if (res.status !== 403 || (await code(res)) !== "support_read_only") failures.push(`${r.method} ${r.path} -> ${res.status} ${await res.text()}`)
    }
    expect(failures).toEqual([])
    expect(await hashes(w.tenant.id)).toEqual(before) // no handler wrote anything
    const denied = await actions(w.tenant.id, "support.write_denied")
    expect(denied.length).toBe(writes.length)
    expect(denied[0]).toMatchObject({ actor_id: `platform:${w.support.userId}`, entity_id: g.id })
    expect(await actions(w.tenant.id, "support.access")).toEqual([]) // refused requests are not "access"

    // expiry: starts_at <= now < expires_at, read fresh on every request
    w.clock.advance({ minutes: 59 })
    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(200)
    w.clock.advance({ minutes: 1 })
    const late = await w.asStaff("GET", "/v1/roles")
    expect(late.status).toBe(404)
    expect(await code(late)).toBe("not_found")
    expect((await actions(w.tenant.id, "support.access_denied")).map((r) => r.after)).toMatchObject([{ reason: "expired", grantId: g.id, method: "GET", path: "/v1/roles" }])
    // a write under an expired grant is a 404 too (never reaches the read-only check)
    expect((await w.asStaff("POST", "/v1/teams", w.support, w.tenant.slug, { name: "x", kind: "team" })).status).toBe(404)
    expect(await verifyChain(w.deps.db, w.tenant.id)).toMatchObject({ ok: true })
  }, 120_000)

  test("tenant owner is notified on grant creation and can revoke; revoked grant stops access on the next request", async () => {
    const w = await world()
    const owner2 = await w.who("owner")
    const admin = await w.who("admin")
    const employee = await w.who("employee")
    const g = (await (await w.grant(w.support)).json()) as Json
    const notes = await ownerTenantQuery(w.tenant.id, "select user_id, kind, title from notifications order by user_id")
    expect(notes.filter((n) => n.kind === "security").map((n) => n.user_id).sort()).toEqual([w.owner.userId, owner2.userId].sort())
    expect(notes.some((n) => n.user_id === admin.userId)).toBe(false)
    expect(w.queue.jobs.some((j) => j.name === "notification.send")).toBe(true) // security email goes out right away (post-commit)

    // tenant side list: owner and admin; nobody else
    const list = await w.req("GET", "/v1/settings/support-grants", w.owner.cookie, { tenant: w.tenant.slug })
    expect(list.status).toBe(200)
    const items = ((await list.json()) as Json).items as Json[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: g.id, staffName: "Platform Person", reason: "Ticket 4411: report totals look wrong", status: "active", revokedAt: null })
    expect((await w.req("GET", "/v1/settings/support-grants", admin.cookie, { tenant: w.tenant.slug })).status).toBe(200)
    expect((await w.req("GET", "/v1/settings/support-grants", employee.cookie, { tenant: w.tenant.slug })).status).toBe(403)
    // the other tenant does not see it
    const bOwner = await w.who("owner", w.other.id)
    expect(((await (await w.req("GET", "/v1/settings/support-grants", bOwner.cookie, { tenant: w.other.slug })).json()) as Json).items).toEqual([])

    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(200)
    // owner-only revoke
    expect((await w.req("DELETE", `/v1/settings/support-grants/${g.id}`, admin.cookie, { tenant: w.tenant.slug })).status).toBe(403)
    expect(await code(await w.req("DELETE", `/v1/settings/support-grants/${g.id}`, bOwner.cookie, { tenant: w.other.slug }))).toBe("grant_not_found")
    const rv = await w.req("DELETE", `/v1/settings/support-grants/${g.id}`, w.owner.cookie, { tenant: w.tenant.slug })
    expect(rv.status).toBe(200)
    expect((await rv.json()) as Json).toMatchObject({ id: g.id, status: "revoked" })
    // the very next request is refused, and the attempt is audited
    const after = await w.asStaff("GET", "/v1/roles")
    expect(after.status).toBe(404)
    expect((await actions(w.tenant.id, "support.access_denied")).map((r) => r.after.reason)).toEqual(["revoked"])
    expect(await code(await w.req("DELETE", `/v1/settings/support-grants/${g.id}`, owner2.cookie, { tenant: w.tenant.slug }))).toBe("grant_inactive")
    // audited in both chains
    expect(await actions(w.tenant.id, "support.revoked")).toMatchObject([{ actor_id: w.owner.userId, entity_id: g.id }])
    expect((await platAudit()).map((r) => r.action)).toEqual(["platform.support.granted", "platform.support.revoked"])
    // I3: the platform chain tags a tenant owner's revoke `tenant:<id>` (never confusable with a staff id); the tenant chain keeps the raw id
    expect((await platAudit()).find((r) => r.action === "platform.support.revoked")).toMatchObject({ actor_id: `tenant:${w.owner.userId}` })
    expect(await verifyChain(w.deps.db, w.tenant.id)).toMatchObject({ ok: true })
    expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
    // a new grant is possible after revocation
    expect((await w.grant(w.support)).status).toBe(201)
  }, 120_000)

  test("grant hours > 24 → 422; reason required", async () => {
    const w = await world()
    for (const hours of [25, 0, -1, 1.5, "3", null]) expect(await code(await w.grant(w.support, w.tenant.id, { reason: "ok", hours })), String(hours)).toBe("invalid_hours")
    expect(await code(await w.grant(w.support, w.tenant.id, { reason: "ok" }))).toBe("invalid_hours")
    for (const reason of [undefined, "", "   ", "x".repeat(501), 5]) expect(await code(await w.grant(w.support, w.tenant.id, { reason, hours: 2 })), String(reason)).toBe("invalid_reason")
    expect((await w.grant(w.support, w.tenant.id, { reason: "x".repeat(500), hours: 24 })).status).toBe(201)
    // unknown / suspended tenant -> 404 before the body is validated
    expect(await code(await w.grant(w.support, NIL, { hours: 99 }))).toBe("tenant_not_found")
    expect(await code(await w.grant(w.support, "nope", { hours: 99 }))).toBe("tenant_not_found")
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.other.id])
    expect(await code(await w.grant(w.support, w.other.id, { reason: "ok", hours: 2 }))).toBe("tenant_not_found")
    expect(await ownerTenantQuery(w.tenant.id, "select count(*)::int as n from support_grants")).toEqual([{ n: 1 }])
  })
})

describe("creating and revoking grants (platform side)", () => {
  test("a grant is always for the caller, one active per (tenant, staff), audited in both chains", async () => {
    const w = await world()
    const r = await w.grant(w.support, w.tenant.id, { reason: "Ticket 1", hours: 3, staffUserId: w.platOwner.userId })
    expect(r.status).toBe(201)
    const g = (await r.json()) as Json
    expect(g.staffUserId).toBe(w.support.userId)
    expect(new Date(g.expiresAt).getTime() - new Date(g.startsAt).getTime()).toBe(3 * 3_600_000)
    expect(g.startsAt).toBe(w.clock.now().toISOString())
    expect(await code(await w.grant(w.support))).toBe("grant_exists")
    expect((await w.grant(w.platOwner)).status).toBe(201) // another staff member: own grant
    expect(await actions(w.tenant.id, "support.granted")).toMatchObject([
      { actor_id: `platform:${w.support.userId}`, entity: "support_grant", entity_id: g.id, after: { staffUserId: w.support.userId, reason: "Ticket 1", hours: 3 } },
      { actor_id: `platform:${w.platOwner.userId}` },
    ])
    const plat = (await platAudit()).filter((p) => p.action === "platform.support.granted")
    expect(plat[0]).toMatchObject({ actor_id: w.support.userId, entity: "support_grant", entity_id: g.id, target_tenant_id: w.tenant.id })
    expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
    // ids-only platform map
    expect(await ownerQuery("select grant_id, target_tenant_id from support_grant_index where grant_id = $1", [g.id])).toEqual([{ grant_id: g.id, target_tenant_id: w.tenant.id }])
    // roles: billing / viewer 403, non-staff 404
    for (const role of ["billing", "viewer"] as const) {
      const s = await makeStaff(w.deps, role)
      expect(await code(await w.grant(s))).toBe("platform_forbidden")
    }
    expect((await w.grant(w.owner)).status).toBe(404)
  })

  test("platform revoke: the grantee or the platform owner; other staff 403; unknown 404; inactive 409", async () => {
    const w = await world()
    const support2 = await makeStaff(w.deps, "support")
    const g = (await (await w.grant(w.support)).json()) as Json
    const del = (id: string, cookie: string) => w.req("DELETE", `/v1/platform/support-grants/${id}`, cookie)
    expect(await code(await del(g.id, support2.cookie))).toBe("platform_forbidden")
    expect(await code(await del(NIL, w.support.cookie))).toBe("grant_not_found")
    expect(await code(await del("not-a-uuid", w.support.cookie))).toBe("grant_not_found")
    expect((await del(g.id, w.owner.cookie)).status).toBe(404) // a tenant owner is not staff
    const r = await del(g.id, w.support.cookie)
    expect(r.status).toBe(200)
    expect((await r.json()) as Json).toMatchObject({ id: g.id, status: "revoked" })
    expect(await code(await del(g.id, w.support.cookie))).toBe("grant_inactive")
    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(404)
    // the platform owner may revoke anyone's grant
    const g2 = (await (await w.grant(support2)).json()) as Json
    expect((await del(g2.id, w.platOwner.cookie)).status).toBe(200)
    expect(await actions(w.tenant.id, "support.revoked")).toMatchObject([{ actor_id: `platform:${w.support.userId}` }, { actor_id: `platform:${w.platOwner.userId}` }])
    expect((await platAudit()).filter((p) => p.action === "platform.support.revoked")).toMatchObject([
      { actor_id: w.support.userId, target_tenant_id: w.tenant.id }, { actor_id: w.platOwner.userId, target_tenant_id: w.tenant.id },
    ])
    // expired grants cannot be revoked either
    const g3 = (await (await w.grant(w.support, w.tenant.id, { reason: "x", hours: 1 })).json()) as Json
    w.clock.advance({ minutes: 61 })
    expect(await code(await del(g3.id, w.support.cookie))).toBe("grant_inactive")
    expect(await verifyChain(w.deps.db, w.tenant.id)).toMatchObject({ ok: true })
    expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
  })
})

describe("rulings", () => {
  test("ruling 1: a member who is also staff follows the normal membership path (no support role, no read-only, no support audit)", async () => {
    const w = await world()
    await makeMember(w.deps, w.tenant.id, "employee", { email: w.support.email })
    expect((await w.grant(w.support)).status).toBe(201)
    const me = (await (await w.asStaff("GET", "/v1/me/tenant")).json()) as Json
    expect(me.member.roleKey).toBe("employee")
    expect((await w.asStaff("POST", "/v1/me/push-tokens", w.support, w.tenant.slug, { token: "fcm-member-path-xxxxxxxx", platform: "android" })).status).toBe(201)
    expect((await tenantAudit(w.tenant.id)).filter((a) => String(a.action).startsWith("support.") && a.action !== "support.granted")).toEqual([])
  })

  test("M1: a non-MFA session with an expired grant gets 401 mfa_challenge and NO access_denied audit row", async () => {
    const w = await world()
    expect((await w.grant(w.support)).status).toBe(201)
    w.clock.advance({ hours: 3 }) // grant (2 h) expired
    const stale = await w.asStaff("GET", "/v1/roles", { cookie: w.support.staleCookie })
    expect(stale.status).toBe(401)
    expect(await code(stale)).toBe("mfa_challenge")
    expect(await actions(w.tenant.id, "support.access_denied")).toEqual([])
    // the MFA-passed session of the same staff member does get the audited denial
    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(404)
    expect((await actions(w.tenant.id, "support.access_denied")).map((r) => r.after.reason)).toEqual(["expired"])
  })

  test("ruling 1: the grant path needs active owner/support staff and an MFA-passed session", async () => {
    const w = await world()
    expect((await w.grant(w.support)).status).toBe(201)
    const stale = await w.asStaff("GET", "/v1/roles", { cookie: w.support.staleCookie })
    expect(stale.status).toBe(401)
    expect(await code(stale)).toBe("mfa_challenge")
    await ownerQuery("update platform_staff set role = 'viewer' where user_id = $1", [w.support.userId])
    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(404)
    await ownerQuery("update platform_staff set role = 'support', status = 'suspended' where user_id = $1", [w.support.userId])
    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(404)
    await ownerQuery("update platform_staff set status = 'active' where user_id = $1", [w.support.userId])
    expect((await w.asStaff("GET", "/v1/roles")).status).toBe(200)
    // a grant row for another staff member does not open the tenant
    const support2 = await makeStaff(w.deps, "support")
    expect((await w.asStaff("GET", "/v1/roles", support2)).status).toBe(404)
  })

  test("ruling 4: sensitive GETs are refused even under a grant, and audited", async () => {
    const w = await world()
    const g = (await (await w.grant(w.support)).json()) as Json
    const denied = ["/v1/data-requests", `/v1/data-requests/${NIL}`, "/v1/me/data-export", "/v1/audit/export", `/v1/files/${NIL}/download`, `/v1/tasks/${NIL}/voice-note`, "/v1/integrations", "/v1/settings/support-grants"]
    for (const p of denied) {
      const r = await w.asStaff("GET", p)
      expect(r.status, p).toBe(403)
      expect(await code(r), p).toBe("support_forbidden_route")
    }
    // encoded variants resolve to the same route and are refused too
    expect(await code(await w.asStaff("GET", "/v1/data%2Drequests"))).toBe("support_forbidden_route")
    const rows = await actions(w.tenant.id, "support.route_denied")
    expect(rows.length).toBe(denied.length + 1)
    expect(rows[0]).toMatchObject({ actor_id: `platform:${w.support.userId}`, entity_id: g.id, after: { method: "GET", path: "/v1/data-requests" } })
    expect(await actions(w.tenant.id, "support.access")).toEqual([])
    expect(SUPPORT_DENIED_ROUTES.length).toBeGreaterThanOrEqual(6)
  })

  test("ruling 5: the support.access audit write fails closed (no handler runs)", async () => {
    const w = await world()
    expect((await w.grant(w.support)).status).toBe(201)
    await ownerQuery(`create or replace function zz_fail_support_access() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`)
    await ownerQuery(`create trigger zz_fail_support_access before insert on audit_events for each row when (new.action = 'support.access') execute function zz_fail_support_access()`)
    try {
      const r = await w.asStaff("GET", "/v1/_probe/support/count")
      expect(r.status).toBe(500)
      expect(w.probeRuns()).toBe(0)
    } finally {
      await ownerQuery("drop trigger zz_fail_support_access on audit_events")
      await ownerQuery("drop function zz_fail_support_access()")
    }
    expect((await w.asStaff("GET", "/v1/_probe/support/count")).status).toBe(200)
    expect(w.probeRuns()).toBe(1)
  })

  test("ruling 6: the synthetic support role is auditor read access only; no write permission is reachable", async () => {
    const w = await world()
    const role = supportRole()
    expect(role.key).toBe("support")
    expect(Object.values(role.access).every((a) => a === "read" || a === "none")).toBe(true)
    expect(Object.keys(role.access).sort()).toEqual([...MODULES].sort())
    expect((await w.grant(w.support)).status).toBe(201)
    for (const m of MODULES) {
      expect((await w.asStaff("GET", `/v1/_probe/support/${m}/read`)).status, `${m} read`).toBe(200)
      const wr = await w.asStaff("GET", `/v1/_probe/support/${m}/write`)
      expect(wr.status, `${m} write`).toBe(403)
      expect(await code(wr)).toBe("forbidden")
    }
    // a REAL tenant role keyed "support" is loaded from the database as usual (the synthetic role is keyed on the grant, not the name)
    await ownerTenantQuery(w.tenant.id, "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'support', 'Support desk', home, access from roles where key='employee'")
    const desk = await w.who("support")
    expect((await w.req("GET", "/v1/_probe/support/tasks/write", desk.cookie, { tenant: w.tenant.slug })).status).toBe(200)
    // billing reads are owner/admin by role key: "support" is neither
    expect((await w.asStaff("GET", "/v1/billing/subscription")).status).toBe(403)
  })
})

describe("GET /v1/platform/support-grants (staff list)", () => {
  const LIST = "/v1/platform/support-grants"
  const ids = (b: Json) => (b.items as Json[]).map((i) => i.id)

  test("staff lists active grants across tenants, newest first, with the documented fields and no secret", async () => {
    const w = await world()
    const a = (await (await w.grant(w.support, w.tenant.id)).json()) as Json
    w.clock.advance({ minutes: 5 })
    const b = (await (await w.grant(w.platOwner, w.other.id)).json()) as Json
    for (const role of ["owner", "support", "billing", "viewer"] as const) {
      const s = role === "owner" ? w.platOwner : role === "support" ? w.support : await makeStaff(w.deps, role)
      const r = await w.req("GET", `${LIST}?status=active`, s.cookie)
      expect(r.status, role).toBe(200)
      const body = (await r.json()) as Json
      expect(ids(body)).toEqual([b.id, a.id])
      expect(body.nextCursor).toBeNull()
      expect(body.items[0]).toEqual({
        id: b.id, tenantId: w.other.id, tenantName: expect.any(String), grantedBy: w.platOwner.userId, staffName: expect.anything(), scope: "read_only", reason: role === "owner" || role === "support" ? b.reason : null, status: "active", canRevoke: expect.any(Boolean),
        createdAt: b.startsAt, expiresAt: b.expiresAt, revokedAt: null,
      })
    }
    const text = JSON.stringify(await (await w.req("GET", LIST, w.support.cookie)).json())
    expect(text).not.toMatch(/token|secret|password/i)
  })

  test("tenantId and status filters narrow the list; an unknown tenant is 404 and a bad status 400", async () => {
    const w = await world()
    const a = (await (await w.grant(w.support, w.tenant.id)).json()) as Json
    const b = (await (await w.grant(w.support, w.other.id)).json()) as Json
    expect((await w.req("DELETE", `/v1/platform/support-grants/${b.id}`, w.support.cookie)).status).toBe(200)
    const get = async (q: string) => (await w.req("GET", `${LIST}?${q}`, w.support.cookie))
    expect(ids((await (await get(`tenantId=${w.tenant.id}`)).json()) as Json)).toEqual([a.id])
    expect(ids((await (await get("status=revoked")).json()) as Json)).toEqual([b.id])
    expect(ids((await (await get("status=active")).json()) as Json)).toEqual([a.id])
    w.clock.advance({ hours: 3 })
    expect(ids((await (await get("status=expired")).json()) as Json)).toEqual([a.id])
    expect(ids((await (await get("status=active")).json()) as Json)).toEqual([])
    expect(ids((await (await get(`tenantId=${w.other.id}&status=revoked`)).json()) as Json)).toEqual([b.id])
    const missing = await get(`tenantId=${NIL}`)
    expect([missing.status, await code(missing)]).toEqual([404, "tenant_not_found"])
    expect((await get("status=bogus")).status).toBe(400)
  })

  test("a tenant owner, a stranger and anonymous callers do not get the platform list (404 / 401)", async () => {
    const w = await world()
    await w.grant(w.support)
    const owner = await w.req("GET", LIST, w.owner.cookie, { tenant: w.tenant.slug })
    expect([owner.status, await code(owner)]).toEqual([404, "not_found"])
    const stranger = await makeUser(w.deps, { totp: true })
    expect((await w.req("GET", LIST, stranger.cookie!)).status).toBe(404)
    expect((await w.req("GET", LIST, undefined)).status).toBe(401)
    const stale = await w.req("GET", LIST, w.support.staleCookie)
    expect([stale.status, await code(stale)]).toEqual([401, "mfa_challenge"])
  })

  test("cursor pages are stable with equal createdAt and cover every grant exactly once", async () => {
    const w = await world()
    const staff = [w.support, w.platOwner, await makeStaff(w.deps, "billing"), await makeStaff(w.deps, "viewer")]
    const tenants = [w.tenant, w.other, await makeTenant(w.deps, { slug: "charlie" })]
    const made: string[] = []
    for (const t of tenants) for (const s of staff.slice(0, 2)) made.push(((await (await w.grant(s, t.id)).json()) as Json).id) // one clock instant: every createdAt is equal
    expect(made).toHaveLength(6)
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const r = await w.req("GET", `${LIST}?limit=2${cursor ? `&cursor=${cursor}` : ""}`, w.support.cookie)
      const b = (await r.json()) as Json
      seen.push(...ids(b))
      expect((b.items as Json[]).length).toBeLessThanOrEqual(2)
      cursor = b.nextCursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(6)
    expect(new Set(seen)).toEqual(new Set(made))
    expect([...seen].sort().reverse()).toEqual(seen) // equal instants: ties break on id, descending
    expect((await w.req("GET", `${LIST}?cursor=nonsense`, w.support.cookie)).status).toBe(400)
    expect((await w.req("GET", `${LIST}?limit=101`, w.support.cookie)).status).toBe(400)
  })

  test("the response has no grant secret or token and the read writes no audit row; a read is logged at info", async () => {
    const w = await world()
    await w.grant(w.support)
    const before = [(await tenantAudit(w.tenant.id)).length, (await platAudit()).length]
    const info = vi.spyOn(w.deps.logger, "info")
    const r = await w.req("GET", LIST, w.support.cookie)
    expect(Object.keys(((await r.json()) as Json).items[0]).sort()).toEqual(["canRevoke", "createdAt", "expiresAt", "grantedBy", "id", "reason", "revokedAt", "scope", "staffName", "status", "tenantId", "tenantName"])
    expect([(await tenantAudit(w.tenant.id)).length, (await platAudit()).length]).toEqual(before)
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ staffUserId: w.support.userId, tenants: 1, returned: 1 }), "support_grant.list")
    info.mockRestore()
  })

  test("reason is returned to owner and support only; viewer and billing get null (status and staffName stay)", async () => {
    const w = await world()
    await w.grant(w.support)
    for (const role of ["owner", "support", "billing", "viewer"] as const) {
      const s = role === "owner" ? w.platOwner : role === "support" ? w.support : await makeStaff(w.deps, role)
      const it = (((await (await w.req("GET", LIST, s.cookie)).json()) as Json).items as Json[])[0]
      expect(it.reason, role).toBe(role === "owner" || role === "support" ? "Ticket 4411: report totals look wrong" : null)
      expect(it).toMatchObject({ status: "active", staffName: expect.anything() })
    }
  })

  test("canRevoke: platform owner any active grant, support only their own, billing and viewer none, inactive none", async () => {
    const w = await world()
    const other = await makeStaff(w.deps, "support")
    const mine = (await (await w.grant(w.support, w.tenant.id)).json()) as Json
    const theirs = (await (await w.grant(other, w.other.id)).json()) as Json
    const flags = async (s: { cookie: string }) => Object.fromEntries((((await (await w.req("GET", LIST, s.cookie)).json()) as Json).items as Json[]).map((i) => [i.id, i.canRevoke]))
    expect(await flags(w.platOwner)).toEqual({ [mine.id]: true, [theirs.id]: true })
    expect(await flags(w.support)).toEqual({ [mine.id]: true, [theirs.id]: false })
    expect(await flags(await makeStaff(w.deps, "viewer"))).toEqual({ [mine.id]: false, [theirs.id]: false })
    expect((await w.req("DELETE", `/v1/platform/support-grants/${theirs.id}`, w.support.cookie)).status).toBe(403) // the API stays the authority
    await w.req("DELETE", `/v1/platform/support-grants/${mine.id}`, w.support.cookie)
    expect(await flags(w.platOwner)).toEqual({ [mine.id]: false, [theirs.id]: true })
  })

  test("a deleted tenant (its index row cascades away) does not crash the list or the tenant filter", async () => {
    const w = await world()
    const g = (await (await w.grant(w.support, w.tenant.id)).json()) as Json
    const gone = (await (await w.grant(w.support, w.other.id)).json()) as Json
    await ownerQuery("delete from tenants where id = $1", [w.other.id])
    expect(ids((await (await w.req("GET", LIST, w.support.cookie)).json()) as Json)).toEqual([g.id])
    const filtered = await w.req("GET", `${LIST}?tenantId=${w.other.id}`, w.support.cookie)
    expect([filtered.status, await code(filtered)]).toEqual([404, "tenant_not_found"])
    expect(gone.id).toBeTruthy()
  })
})
