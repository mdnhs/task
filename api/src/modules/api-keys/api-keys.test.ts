import { createHash } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, roleIdOf, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { withTenant } from "../../db/tenant-tx"
import { apiKeys } from "../../db/schema"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")
const KEY_RE = /^odk_[0-9A-Za-z]{8}_[A-Za-z0-9_-]{43}$/

async function world() {
  const t = testApp()
  // test-only probes guarded like real routes: they show what a key's effective permission is for ANY module
  t.app.get("/v1/_probe/ak/tasks/read", requireTenant, requirePermission("tasks", "read"), (c) => c.json({ ok: true }))
  t.app.post("/v1/_probe/ak/tasks/write", requireTenant, requirePermission("tasks", "write"), (c) => c.json({ ok: true }))
  t.app.get("/v1/_probe/ak/unguarded", requireTenant, (c) => c.json({ ok: true }))
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "bravo" })
  const who = async (role: string, tenantId = tenant.id) => {
    const m = await makeMember(t.deps, tenantId, role)
    return { ...m, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const bearer = (key: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${key}`, ...extra })
  const withKey = (key: string, method: string, path: string, o: { tenant?: string; body?: unknown } = {}) => call(t.app, method, path, { tenant: o.tenant, body: o.body, headers: bearer(key) })
  const create = async (as: { cookie: string }, body: unknown, slug = "acme") => call(t.app, "POST", "/v1/api-keys", { cookie: as.cookie, tenant: slug, body })
  const mint = async (as: { cookie: string } = owner, scopes: string[] = ["settings:write"]) => {
    const r = await create(as, { name: "CI", scopes })
    expect(r.status).toBe(201)
    return (await r.json()) as Json
  }
  return { ...t, tenant, other, who, owner, withKey, create, mint, bearer }
}
const code = async (r: Response) => ((await r.clone().json()) as Json).code

describe("create / list / revoke", () => {
  test("the key is shown once; only its sha256 is stored; it authenticates without X-Tenant; a revoked key is 401 invalid_api_key", async () => {
    const w = await world()
    const k = await w.mint(w.owner, ["settings:read"])
    expect(k.key).toMatch(KEY_RE)
    expect(k.key.split("_")[1]).toBe(k.prefix)
    expect(k.scopes).toEqual(["settings:read"])
    const [row] = await ownerTenantQuery(w.tenant.id, "select * from api_keys")
    expect(row.key_hash).toBe(sha256(k.key))
    expect(JSON.stringify(row)).not.toContain(k.key.split("_")[2]) // the secret is nowhere in the row
    expect(row.created_by).toBe(w.owner.userId)
    const idx = await ownerQuery("select prefix, target_tenant_id, key_id from api_key_index")
    expect(idx).toEqual([{ prefix: k.prefix, target_tenant_id: w.tenant.id, key_id: k.id }])
    // list: never the key or hash
    const list = await call(w.app, "GET", "/v1/api-keys", { cookie: w.owner.cookie, tenant: "acme" })
    expect(list.status).toBe(200)
    const text = await list.text()
    expect(text).not.toContain(k.key)
    expect(text).not.toContain(row.key_hash as string)
    expect(JSON.parse(text).items).toHaveLength(1)
    // works
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation")).status).toBe(200)
    // revoke (human, audited normally), then 401 with the same body as any bad key
    const del = await call(w.app, "DELETE", `/v1/api-keys/${k.id}`, { cookie: w.owner.cookie, tenant: "acme" })
    expect(del.status).toBe(200)
    const after = await w.withKey(k.key, "GET", "/v1/settings/organisation")
    expect(after.status).toBe(401)
    expect(await code(after)).toBe("invalid_api_key")
    const audit = await ownerTenantQuery(w.tenant.id, "select actor_id, action, after from audit_events where action like 'api_key.%' order by seq")
    expect(audit.map((a) => [a.action, a.actor_id])).toEqual([["api_key.created", w.owner.userId], ["api_key.revoked", w.owner.userId]])
    expect(JSON.stringify(audit)).not.toContain(k.key)
    expect(JSON.stringify(audit)).not.toContain(sha256(k.key))
    expect((await call(w.app, "DELETE", `/v1/api-keys/${k.id}`, { cookie: w.owner.cookie, tenant: "acme" })).status).toBe(409) // already revoked
  })

  test("every bad key is the same 401 invalid_api_key (unknown, malformed, wrong secret, wrong prefix, revoked)", async () => {
    const w = await world()
    const k = await w.mint()
    const [, prefix, secret] = k.key.split("_") as string[]
    const bad = [
      "odk_", "odk_x", "odk_abcdefgh_short", `odk_${prefix}_${secret.slice(0, -1)}A`, `odk_${prefix}_${"A".repeat(43)}`, `odk_ZZZZZZZZ_${secret}`,
      `odk_${prefix}_${secret}extra`, `odk_${prefix}-${secret}`, `ODK_${prefix}_${secret}`.replace("ODK", "odk"), "odk_" + "a".repeat(2000),
    ].filter((x) => x !== k.key)
    const bodies = new Set<string>()
    for (const b of bad) {
      const r = await w.withKey(b, "GET", "/v1/settings/organisation")
      expect(r.status, b).toBe(401)
      const j = (await r.json()) as Json
      expect(j.code).toBe("invalid_api_key")
      bodies.add(JSON.stringify({ ...j, requestId: "" }))
    }
    expect(bodies.size).toBe(1)
  })

  test("a session cookie is ignored when a Bearer odk_ key is present (a bad key is 401 even with a valid session)", async () => {
    const w = await world()
    const r = await call(w.app, "GET", "/v1/settings/organisation", { cookie: w.owner.cookie, tenant: "acme", headers: { authorization: "Bearer odk_abcdefgh_" + "A".repeat(43) } })
    expect(r.status).toBe(401)
    expect(await code(r)).toBe("invalid_api_key")
  })

  test("scope validation: unknown module/action/format is 422 invalid_scope; beyond the creator's role is 422 scope_exceeds_role", async () => {
    const w = await world()
    for (const scopes of [["foo:read"], ["tasks:admin"], ["settings"], ["settings:"], [":read"], ["tasks:read:x"], ["Tasks:read"], [], ["tasks:read", "nope:write"]]) {
      const r = await w.create(w.owner, { name: "x", scopes })
      expect(r.status, JSON.stringify(scopes)).toBe(422)
      expect(await code(r)).toBe("invalid_scope")
    }
    const admin = await w.who("admin") // admin: payroll none, tasks read, settings write, audit write
    for (const scopes of [["payroll:read"], ["tasks:write"], ["settings:write", "payroll:write"]]) {
      const r = await w.create(admin, { name: "x", scopes })
      expect(r.status, JSON.stringify(scopes)).toBe(422)
      expect(await code(r)).toBe("scope_exceeds_role")
    }
    expect((await w.create(admin, { name: "ok", scopes: ["tasks:read", "settings:write", "audit:write"] })).status).toBe(201)
    expect((await w.create(w.owner, { name: "", scopes: ["tasks:read"] })).status).toBe(422)
    expect(await ownerTenantQuery(w.tenant.id, "select count(*)::int as n from api_keys")).toEqual([{ n: 1 }])
  })

  test("needs settings:write (an employee is 403), unauthenticated is 401, and another tenant's key ids are 404", async () => {
    const w = await world()
    const emp = await w.who("employee")
    expect((await w.create(emp, { name: "x", scopes: ["tasks:read"] })).status).toBe(403)
    expect((await call(w.app, "GET", "/v1/api-keys", { tenant: "acme" })).status).toBe(401)
    const k = await w.mint()
    const ownerB = await w.who("owner", w.other.id)
    const r = await call(w.app, "DELETE", `/v1/api-keys/${k.id}`, { cookie: ownerB.cookie, tenant: "bravo" })
    expect(r.status).toBe(404)
    expect(await code(r)).toBe("api_key_not_found")
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation")).status).toBe(200) // untouched
    expect((await ownerTenantQuery(w.other.id, "select count(*)::int as n from api_keys"))[0].n).toBe(0)
  })
})

describe("use: tenant binding, permissions, gates", () => {
  test("a key is bound to its tenant: X-Tenant of another tenant is 404, its own slug or no header works", async () => {
    const w = await world()
    const k = await w.mint()
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation", { tenant: "bravo" })).status).toBe(404)
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation", { tenant: "acme" })).status).toBe(200)
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation")).status).toBe(200)
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation", { tenant: "nope-nope" })).status).toBe(404)
    const org = (await (await w.withKey(k.key, "GET", "/v1/settings/organisation")).json()) as Json
    expect(org.slug).toBe("acme")
  })

  test("scope settings:read cannot write; settings:write may; write implies read for the same module only", async () => {
    const w = await world()
    const ro = await w.mint(w.owner, ["settings:read"])
    expect((await w.withKey(ro.key, "GET", "/v1/settings/organisation")).status).toBe(200)
    const denied = await w.withKey(ro.key, "PUT", "/v1/settings/branding", { body: { logoFileId: null, primaryColor: "#0A1B2C" } })
    expect(denied.status).toBe(403)
    expect(await code(denied)).toBe("forbidden")
    const rw = await w.mint(w.owner, ["settings:write"])
    expect((await w.withKey(rw.key, "PUT", "/v1/settings/branding", { body: { logoFileId: null, primaryColor: "#0A1B2C" } })).status).toBe(200)
    expect((await w.withKey(rw.key, "GET", "/v1/settings/organisation")).status).toBe(200) // write implies read (same module)
    // another module is not implied: settings:write gives nothing on tasks
    expect((await w.withKey(rw.key, "GET", "/v1/_probe/ak/tasks/read")).status).toBe(403)
    const tr = await w.mint(w.owner, ["tasks:read"])
    expect((await w.withKey(tr.key, "GET", "/v1/_probe/ak/tasks/read")).status).toBe(200)
    expect((await w.withKey(tr.key, "POST", "/v1/_probe/ak/tasks/write")).status).toBe(403)
    expect((await w.withKey(tr.key, "GET", "/v1/settings/organisation")).status).toBe(403)
  })

  test("routes with no permission guard are not reachable by a key (no scope can cover them)", async () => {
    const w = await world()
    const k = await w.mint(w.owner, ["settings:write", "tasks:write", "files:write"])
    for (const [m, p] of [["GET", "/v1/_probe/ak/unguarded"], ["GET", "/v1/teams"], ["GET", "/v1/notifications"], ["GET", "/v1/search?q=x"]]) {
      const r = await w.withKey(k.key, m, p)
      expect(r.status, p).toBe(403)
      expect(await code(r)).toBe("api_key_forbidden_route")
    }
  })

  test("deny-list: keys cannot reach api-keys, webhooks, role/membership management, support grants, data requests, /me, exports", async () => {
    const w = await world()
    const k = await w.mint(w.owner, ["settings:write", "audit:write", "files:write"])
    const role = await roleIdOf(w.deps, w.tenant.id, "employee")
    const NIL = "00000000-0000-4000-8000-000000000000"
    const routes: [string, string, unknown?][] = [
      ["GET", "/v1/api-keys"], ["POST", "/v1/api-keys", { name: "x", scopes: ["settings:read"] }], ["DELETE", `/v1/api-keys/${NIL}`],
      ["GET", "/v1/webhooks"], ["POST", "/v1/webhooks", { url: "https://hooks.example.com/x", events: ["team.created"] }], ["PATCH", `/v1/webhooks/${NIL}`, { active: false }], ["DELETE", `/v1/webhooks/${NIL}`],
      ["GET", "/v1/roles"], ["PATCH", `/v1/roles/${role}`, { label: "x" }], ["PATCH", `/v1/members/${w.owner.userId}`, { roleId: role }], ["PUT", `/v1/members/${w.owner.userId}/manager`, { managerId: null }],
      ["GET", "/v1/settings/support-grants"], ["DELETE", `/v1/settings/support-grants/${NIL}`],
      ["GET", "/v1/data-requests"], ["POST", "/v1/data-requests", { subjectUserId: w.owner.userId, kind: "export" }],
      ["GET", "/v1/me/notification-preferences"], ["POST", "/v1/me/data-export"], ["POST", "/v1/me/push-tokens", { token: "xxxxxxxxxxxxxxxx", platform: "android" }],
      ["GET", "/v1/audit/export"], ["GET", `/v1/files/${NIL}/download`],
      ["POST", "/v1/invites", { email: "a@b.ie", roleId: role }], ["GET", "/v1/billing/subscription"], ["POST", "/v1/billing/cancel"], ["GET", "/v1/integrations"],
    ]
    for (const [m, p, body] of routes) {
      const r = await w.withKey(k.key, m, p, { body })
      expect(r.status, `${m} ${p}`).toBe(403)
      expect(await code(r), `${m} ${p}`).toBe("api_key_forbidden_route")
    }
    // encoding / case / slash tricks do not slip through
    for (const p of ["/v1/API-keys", "/v1//api-keys", "/v1/api-keys/", "/v1/webhooks/", "/v1/%77ebhooks"]) {
      const r = await w.withKey(k.key, "GET", p)
      expect([403, 404], p).toContain(r.status)
      expect(r.status === 403 ? await code(r) : "api_key_forbidden_route", p).toBe("api_key_forbidden_route")
    }
    expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int as n from api_keys"))[0].n).toBe(1) // nothing was created
  })

  test("creator demoted after key creation: effective permissions shrink at use time", async () => {
    const w = await world()
    const admin = await w.who("admin")
    const k = await w.mint(admin, ["settings:write", "audit:read"])
    expect((await w.withKey(k.key, "PUT", "/v1/settings/branding", { body: { logoFileId: null, primaryColor: "#0A1B2C" } })).status).toBe(200)
    // demote admin -> manager (settings: read; audit: write)
    const mgr = await roleIdOf(w.deps, w.tenant.id, "manager")
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [mgr, admin.userId])
    expect((await w.withKey(k.key, "PUT", "/v1/settings/branding", { body: { logoFileId: null, primaryColor: "#0A1B2C" } })).status).toBe(403) // write cut to read
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation")).status).toBe(200) // read survives
    // demote to employee: settings none -> even read is gone
    const emp = await roleIdOf(w.deps, w.tenant.id, "employee")
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [emp, admin.userId])
    expect((await w.withKey(k.key, "GET", "/v1/settings/organisation")).status).toBe(403)
    // promoting the creator back does NOT widen a key beyond its scopes
    const owner = await roleIdOf(w.deps, w.tenant.id, "owner")
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [owner, admin.userId])
    expect((await w.withKey(k.key, "GET", "/v1/_probe/ak/tasks/read")).status).toBe(403)
  })

  test("I1: a key sees only what its creator would in /v1/people (team-scoped manager template, and a clone of it); admin sees all", async () => {
    const w = await world()
    const admin = await w.who("admin")
    await w.who("employee") // somebody else in the tenant
    const k = await w.mint(admin, ["reports:read"])
    const viaKey = async () => ((await (await w.withKey(k.key, "GET", "/v1/people")).json()) as Json[]).map((p) => p.email).sort()
    const viaCreator = async () => ((await (await call(w.app, "GET", "/v1/people", { cookie: admin.cookie, tenant: "acme" })).json()) as Json[]).map((p) => p.email).sort()
    expect((await viaKey()).length).toBeGreaterThanOrEqual(3) // admin: all
    expect(await viaKey()).toEqual(await viaCreator())
    // demoted to manager: template scope "team" (nobody reports to the creator): the key must not widen to "all"
    const mgr = await roleIdOf(w.deps, w.tenant.id, "manager")
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [mgr, admin.userId])
    const asCreator = await viaCreator()
    expect(asCreator).not.toContain(w.owner.email)
    expect(await viaKey()).toEqual(asCreator)
    expect(await viaKey()).not.toContain(w.owner.email)
    // a custom role cloned from manager keeps the team ceiling
    const clone = await call(w.app, "POST", `/v1/roles/${mgr}/clone`, { cookie: w.owner.cookie, tenant: "acme", body: { label: "Night lead" } })
    expect(clone.status).toBe(201)
    const cloneId = ((await clone.json()) as Json).id
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [cloneId, admin.userId])
    expect(await viaCreator()).not.toContain(w.owner.email)
    expect(await viaKey()).toEqual(await viaCreator())
    // the same through a staff-home creator (own scope only): never anyone else
    const emp = await roleIdOf(w.deps, w.tenant.id, "employee")
    await ownerTenantQuery(w.tenant.id, "update memberships set role_id = $1 where user_id = $2", [emp, admin.userId])
    expect((await w.withKey(k.key, "GET", "/v1/people")).status).toBe(200) // reports:read survives (employee reports write)
    expect(await viaKey()).toEqual([admin.email])
  })

  test("I2: the tenant MFA policy is not reachable by a key (any method)", async () => {
    const w = await world()
    const k = await w.mint(w.owner, ["settings:write"])
    for (const [m, body] of [["GET", undefined], ["PUT", { mode: "off", roles: [] }]] as const) {
      const r = await w.withKey(k.key, m, "/v1/settings/mfa-policy", { body })
      expect(r.status, m).toBe(403)
      expect(await code(r)).toBe("api_key_forbidden_route")
    }
    expect((await ownerQuery("select mfa_policy from tenants where id = $1", [w.tenant.id]))[0].mfa_policy).toEqual({ mode: "off", roles: [] })
  })

  test("creator removed / suspended / erased, or tenant suspended: 401 invalid_api_key", async () => {
    const w = await world()
    const mk = async () => {
      const m = await w.who("admin")
      return { m, k: await w.mint(m, ["settings:read"]) }
    }
    const ok = async (k: Json) => (await w.withKey(k.key, "GET", "/v1/settings/organisation")).status
    const a = await mk()
    expect(await ok(a.k)).toBe(200)
    await ownerTenantQuery(w.tenant.id, "delete from memberships where user_id = $1", [a.m.userId])
    expect(await ok(a.k)).toBe(401)
    const b = await mk()
    await ownerTenantQuery(w.tenant.id, "update memberships set status = 'suspended' where user_id = $1", [b.m.userId])
    expect(await ok(b.k)).toBe(401)
    const c = await mk()
    await ownerQuery("update \"user\" set erased_at = now() where id = $1", [c.m.userId])
    expect(await ok(c.k)).toBe(401)
    const d = await mk()
    expect(await ok(d.k)).toBe(200)
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
    const r = await w.withKey(d.k.key, "GET", "/v1/settings/organisation")
    expect(r.status).toBe(401)
    expect(await code(r)).toBe("invalid_api_key")
  })

  test("MFA / device / idle gates do not apply to keys (documented, ruling C7): a key works for a creator under forced MFA, with no session", async () => {
    const t = testApp()
    const tenant = await makeTenant(t.deps, { slug: "mfa", mfaPolicy: { mode: "all", roles: [] } })
    const m = await makeMember(t.deps, tenant.id, "owner", { totp: true })
    // mint the key through a session that passed MFA
    const { signInWithTotp } = await import("../../../test/factories")
    const { cookie } = await signInWithTotp(t.app, m.email, m.password, m.totpSecret!)
    const r = await call(t.app, "POST", "/v1/api-keys", { cookie, tenant: "mfa", body: { name: "ci", scopes: ["settings:read"] } })
    expect(r.status).toBe(201)
    const k = (await r.json()) as Json
    t.clock.advance({ hours: 48 }) // far past any idle timeout
    expect((await call(t.app, "GET", "/v1/settings/organisation", { headers: { authorization: `Bearer ${k.key}` } })).status).toBe(200)
  })

  test("billing is enforced: a blocked tenant's key may read but every write is 402 billing_required", async () => {
    const t = testApp()
    const tenant = await makeTenant(t.deps, { slug: "late", subscription: { status: "canceled" } })
    const m = await makeMember(t.deps, tenant.id, "owner")
    const { cookie } = await signIn(t.app, m.email, m.password)
    // creating a key is itself a write (402), so insert through the owner connection the way a pre-lapse key would exist
    expect((await call(t.app, "POST", "/v1/api-keys", { cookie, tenant: "late", body: { name: "ci", scopes: ["settings:write"] } })).status).toBe(402)
    const ok = await makeTenant(t.deps, { slug: "ok" })
    const m2 = await makeMember(t.deps, ok.id, "owner")
    const k = (await (await call(t.app, "POST", "/v1/api-keys", { cookie: (await signIn(t.app, m2.email, m2.password)).cookie, tenant: "ok", body: { name: "ci", scopes: ["settings:write"] } })).json()) as Json
    await ownerTenantQuery(ok.id, "update subscriptions set status = 'canceled' where tenant_id = $1", [ok.id])
    const { invalidateEntitlements } = await import("../entitlements")
    invalidateEntitlements(ok.id)
    expect((await call(t.app, "GET", "/v1/settings/organisation", { headers: { authorization: `Bearer ${k.key}` } })).status).toBe(200)
    const w = await call(t.app, "PUT", "/v1/settings/branding", { headers: { authorization: `Bearer ${k.key}` }, body: { logoFileId: null, primaryColor: "#0A1B2C" } })
    expect(w.status).toBe(402)
    expect(await code(w)).toBe("billing_required")
  })

  test("writes through a key are audited with actor apikey:<id>", async () => {
    const w = await world()
    const k = await w.mint()
    expect((await w.withKey(k.key, "PUT", "/v1/settings/branding", { body: { logoFileId: null, primaryColor: "#0A1B2C" } })).status).toBe(200)
    expect((await w.withKey(k.key, "POST", "/v1/_probe/ak/tasks/write")).status).toBe(403)
    const rows = await ownerTenantQuery(w.tenant.id, "select actor_id, action from audit_events where action not like 'api_key.%'")
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.actor_id === `apikey:${k.id}`)).toBe(true)
    // a later human request is back to the human actor
    expect((await call(w.app, "PUT", "/v1/settings/branding", { cookie: w.owner.cookie, tenant: "acme", body: { logoFileId: null, primaryColor: "#112233" } })).status).toBe(200)
    const last = await ownerTenantQuery(w.tenant.id, "select actor_id from audit_events order by seq desc limit 1")
    expect(last[0].actor_id).toBe(w.owner.userId)
  })

  test("last_used_at is written at most once per 60 s per key", async () => {
    const w = await world()
    const k = await w.mint()
    const lu = async () => (await ownerTenantQuery(w.tenant.id, "select last_used_at from api_keys"))[0].last_used_at as Date | null
    expect(await lu()).toBeNull()
    await w.withKey(k.key, "GET", "/v1/settings/organisation")
    const first = await lu()
    expect(first).not.toBeNull()
    w.clock.advance({ minutes: 0 })
    for (let i = 0; i < 3; i++) await w.withKey(k.key, "GET", "/v1/settings/organisation")
    expect((await lu())!.getTime()).toBe(first!.getTime())
    w.clock.advance({ minutes: 1 })
    w.clock.advance({ minutes: 0 })
    await w.withKey(k.key, "GET", "/v1/settings/organisation")
    expect((await lu())!.getTime()).toBeGreaterThan(first!.getTime())
  })
})

describe("storage and privileges", () => {
  test("app_user cannot delete keys or rewrite the hash / scopes; api_key_index is append-only and cascades with the tenant", async () => {
    const w = await world()
    const k = await w.mint()
    const run = (fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<unknown>) => withTenant(w.deps.db, w.tenant.id, fn)
    const { sql } = await import("drizzle-orm")
    await expect(run((tx) => tx.execute(sql`delete from api_keys`))).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(run((tx) => tx.execute(sql`update api_keys set key_hash = 'x'`))).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(run((tx) => tx.execute(sql`update api_keys set scopes = array['settings:write']`))).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(w.deps.db.execute(sql`delete from api_key_index`)).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(w.deps.db.execute(sql`update api_key_index set target_tenant_id = target_tenant_id`)).rejects.toMatchObject({ cause: { code: "42501" } })
    expect(await run((tx) => tx.select({ id: apiKeys.id }).from(apiKeys))).toHaveLength(1)
    // another tenant's context sees nothing
    expect(await withTenant(w.deps.db, w.other.id, (tx) => tx.select({ id: apiKeys.id }).from(apiKeys))).toEqual([])
    await ownerQuery("delete from tenants where id = $1", [w.tenant.id])
    expect(await ownerQuery("select * from api_key_index where key_id = $1", [k.id])).toEqual([])
  })
})
