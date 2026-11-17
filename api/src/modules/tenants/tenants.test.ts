import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery, testDb } from "../../../test/db"
import { makeMember, makeStaff, makeTenant, signIn, signUp } from "../../../test/factories"
import { withTenant } from "../../db/tenant-tx"
import { memberships } from "../../db/schema"
import { readFileSync } from "node:fs"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

async function newUser(t: ReturnType<typeof testApp>, email = "owner@x.ie") {
  await signUp(t.app, email, "Passw0rd!long", "Owner")
  const { cookie } = await signIn(t.app, email, "Passw0rd!long")
  const me = (await (await call(t.app, "GET", "/v1/me", { cookie })).json()) as Json
  return { cookie, userId: me.user.id as string }
}

test("creating a tenant makes the caller owner with data-driven defaults", async () => {
  const t = testApp()
  const { cookie, userId } = await newUser(t)
  const r = await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "Coppers", slug: "coppers" } })
  expect(r.status).toBe(201)
  const { id, slug } = (await r.json()) as Json
  expect(slug).toBe("coppers")
  const [row] = await ownerQuery("select * from tenants where slug = 'coppers'")
  expect(row).toMatchObject({ id, timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", session_idle_hours: 12 })
  const m = await ownerTenantQuery(id, "select r.key from memberships m join roles r on r.id = m.role_id where m.user_id = $1", [userId])
  expect(m).toEqual([{ key: "owner" }])
  const settings = await ownerTenantQuery(id, "select value from tenant_settings where key = 'invite_ttl_days'")
  expect(settings).toEqual([{ value: 7 }])
})

test("explicit timezone/currency/locale are honoured; invalid ones are 400", async () => {
  const t = testApp()
  const { cookie } = await newUser(t)
  const ok = await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "B", slug: "berlin", timezone: "Europe/Berlin", currency: "GBP", locale: "de-DE" } })
  expect(ok.status).toBe(201)
  expect((await ownerQuery("select timezone, currency, locale from tenants where slug='berlin'"))[0]).toEqual({ timezone: "Europe/Berlin", currency: "GBP", locale: "de-DE" })
  for (const body of [{ name: "x", slug: "Bad Slug" }, { name: "x", slug: "ok", timezone: "Mars/Base" }, { name: "", slug: "ok" }]) {
    const r = await call(t.app, "POST", "/v1/tenants", { cookie, body })
    expect(r.status).toBe(400)
    expect(r.headers.get("content-type")).toMatch(/problem\+json/)
  }
})

test("creating a tenant needs a session", async () => {
  const r = await call(testApp().app, "POST", "/v1/tenants", { body: { name: "A", slug: "aa" } })
  expect(r.status).toBe(401)
})

test("duplicate slug is 409 slug_taken", async () => {
  const t = testApp()
  const { cookie } = await newUser(t)
  expect((await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "A", slug: "dup" } })).status).toBe(201)
  const r = await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "A2", slug: "dup" } })
  expect(r.status).toBe(409)
  expect(((await r.json()) as Json).code).toBe("slug_taken")
})

test("a new tenant gets every role template from roles.json except platform", async () => {
  const t = testApp()
  const { cookie } = await newUser(t)
  const { id } = (await (await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "A", slug: "tpl" } })).json()) as Json
  const json = JSON.parse(readFileSync(new URL("../../../../public/data/shell/roles.json", import.meta.url), "utf8")) as { roles: { id: string; access: unknown }[] }
  const want = json.roles.filter((r) => r.id !== "platform")
  const got = await ownerTenantQuery(id, "select key, access, is_template, field_rules from roles order by key")
  expect(got.map((r) => r.key).sort()).toEqual(want.map((r) => r.id).sort())
  expect(got.every((r) => r.is_template === true)).toBe(true)
  expect(got.find((r) => r.key === "employee")!.access).toEqual(want.find((r) => r.id === "employee")!.access)
  expect(got[0].field_rules).toEqual({})
})

test("tenant creation is audited with the creator as actor", async () => {
  const t = testApp()
  const { cookie, userId } = await newUser(t)
  const { id } = (await (await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "A", slug: "aud" } })).json()) as Json
  const rows = await ownerTenantQuery(id, "select action, actor_id, entity from audit_events order by seq")
  expect(rows).toEqual([{ action: "tenant.created", actor_id: userId, entity: "tenant" }])
})

test("x-tenant of a tenant the user is not a member of is 404 (same as unknown tenant)", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps)
  const b = await makeTenant(t.deps)
  const ua = await makeMember(t.deps, a.id, "owner")
  const { cookie } = await signIn(t.app, ua.email, ua.password)
  expect((await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: a.slug })).status).toBe(200)
  const other = await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: b.slug })
  const unknown = await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "no-such-tenant" })
  expect(other.status).toBe(404)
  expect(unknown.status).toBe(404)
  expect(await other.json()).toMatchObject({ code: "not_found", status: 404 })
})

test("missing x-tenant on a tenant route is 400 tenant_required; no session is 401", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps)
  const u = await makeMember(t.deps, a.id, "employee")
  const { cookie } = await signIn(t.app, u.email, u.password)
  const r = await call(t.app, "GET", "/v1/me/tenant", { cookie })
  expect(r.status).toBe(400)
  expect(((await r.json()) as Json).code).toBe("tenant_required")
  const anon = await call(t.app, "GET", "/v1/me/tenant", { tenant: a.slug })
  expect(anon.status).toBe(401)
  const anonUnknown = await call(t.app, "GET", "/v1/me/tenant", { tenant: "no-such-tenant" })
  expect(anonUnknown.status).toBe(401) // slugs are not probeable without a session
})

test("/v1/me/tenant sets tenant + member context", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "ctx" })
  const u = await makeMember(t.deps, a.id, "manager")
  const { cookie } = await signIn(t.app, u.email, u.password)
  const r = await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "ctx" })
  expect(await r.json()).toMatchObject({ tenant: { id: a.id, slug: "ctx", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", sessionIdleHours: 12 }, member: { userId: u.userId, roleKey: "manager" } })
})

test("/v1/me lists the user's tenants with role key", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "alpha", name: "Alpha Ltd" })
  const b = await makeTenant(t.deps, { slug: "beta", name: "Beta Ltd" })
  await makeTenant(t.deps, { slug: "gamma" })
  const u = await makeMember(t.deps, a.id, "owner")
  await makeMember(t.deps, b.id, "employee", { email: u.email })
  const { cookie } = await signIn(t.app, u.email, u.password)
  const body = (await (await call(t.app, "GET", "/v1/me", { cookie })).json()) as Json
  expect(body.tenants.sort((x: Json, y: Json) => x.slug.localeCompare(y.slug))).toEqual([
    { slug: "alpha", name: "Alpha Ltd", roleKey: "owner" },
    { slug: "beta", name: "Beta Ltd", roleKey: "employee" },
  ])
})

test("RLS: tenant A's context cannot read or write tenant B's memberships", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps)
  const b = await makeTenant(t.deps)
  await makeMember(t.deps, a.id, "owner")
  await makeMember(t.deps, b.id, "owner")
  const rows = await withTenant(testDb(), a.id, (tx) => tx.select().from(memberships))
  expect(rows.map((r) => r.tenantId)).toEqual([a.id])
  expect(await testDb().select().from(memberships)).toEqual([]) // no context, no rows (user policy needs app.user_id)
})

test("per-tenant idle timeout: 1h tenant, 61 minutes idle -> 401 session_expired on a tenant route", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "short", sessionIdleHours: 1 })
  const u = await makeMember(t.deps, a.id, "employee")
  const { cookie } = await signIn(t.app, u.email, u.password)
  t.clock.advance({ minutes: 59 })
  expect((await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "short" })).status).toBe(200)
  t.clock.advance({ minutes: 61 })
  const r = await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "short" })
  expect(r.status).toBe(401)
  expect(((await r.json()) as Json).code).toBe("session_expired")
})

test("a 12h tenant does not expire at 61 minutes", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "long" })
  const u = await makeMember(t.deps, a.id, "employee")
  const { cookie } = await signIn(t.app, u.email, u.password)
  t.clock.advance({ minutes: 61 })
  expect((await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "long" })).status).toBe(200)
})

test("R17: /api/auth/* uses the strictest idle hours across the user's memberships", async () => {
  const t = testApp()
  const short = await makeTenant(t.deps, { sessionIdleHours: 1 })
  const long = await makeTenant(t.deps)
  const u = await makeMember(t.deps, short.id, "employee")
  await makeMember(t.deps, long.id, "employee", { email: u.email })
  const { cookie } = await signIn(t.app, u.email, u.password)
  t.clock.advance({ minutes: 59 })
  expect((await call(t.app, "GET", "/api/auth/get-session", { cookie })).status).toBe(200)
  t.clock.advance({ minutes: 61 })
  const r = await call(t.app, "GET", "/api/auth/get-session", { cookie })
  expect(r.status).toBe(401)
  expect(((await r.json()) as Json).code).toBe("session_expired")
})

test("R17: a user with only a 12h tenant stays signed in past an hour", async () => {
  const t = testApp()
  const long = await makeTenant(t.deps)
  const u = await makeMember(t.deps, long.id, "employee")
  const { cookie } = await signIn(t.app, u.email, u.password)
  t.clock.advance({ hours: 5 })
  expect((await call(t.app, "GET", "/api/auth/get-session", { cookie })).status).toBe(200)
})

test("R23: A(1h)+B(12h), idle 2h, a request to B's route is 401 session_expired and the session is deleted", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "ta", sessionIdleHours: 1 })
  const b = await makeTenant(t.deps, { slug: "tb" })
  const u = await makeMember(t.deps, a.id, "employee")
  await makeMember(t.deps, b.id, "employee", { email: u.email })
  const { cookie } = await signIn(t.app, u.email, u.password)
  t.clock.advance({ hours: 2 })
  const r = await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "tb" })
  expect(r.status).toBe(401)
  expect(((await r.json()) as Json).code).toBe("session_expired")
  expect(await ownerQuery("select 1 from session")).toEqual([])
})

test("R23: probing a foreign 1h tenant slug as a user whose tenants are all 12h is 404, not session_expired", async () => {
  const t = testApp()
  await makeTenant(t.deps, { slug: "foreign", sessionIdleHours: 1 })
  const mine = await makeTenant(t.deps, { slug: "mine" })
  const u = await makeMember(t.deps, mine.id, "employee")
  const { cookie } = await signIn(t.app, u.email, u.password)
  t.clock.advance({ hours: 2 })
  expect((await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "foreign" })).status).toBe(404)
  expect((await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "nope" })).status).toBe(404)
})

// ---------- B6 T6.1: typed /v1/me and /v1/me/tenant (ruling I23 d, e) ----------

test("GET /v1/me returns user name, emailVerified, twoFactorEnabled and platformRole (null for members, the staff role for staff)", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "alpha", name: "Alpha Ltd" })
  const u = await makeMember(t.deps, a.id, "owner")
  const { cookie } = await signIn(t.app, u.email, u.password)
  const me = (await (await call(t.app, "GET", "/v1/me", { cookie })).json()) as Json
  expect(me).toEqual({
    user: { id: u.userId, email: u.email, name: "Test Member", emailVerified: true, twoFactorEnabled: false },
    platformRole: null,
    tenants: [{ slug: "alpha", name: "Alpha Ltd", roleKey: "owner" }],
  })
  const staff = await makeStaff(t.deps, "support")
  const sme = (await (await call(t.app, "GET", "/v1/me", { cookie: staff.cookie })).json()) as Json
  expect(sme.platformRole).toBe("support")
  expect(sme.user).toMatchObject({ name: "Platform Person", emailVerified: true, twoFactorEnabled: true })
  const viewer = await makeStaff(t.deps, "viewer", { totp: false })
  const { cookie: vc } = await signIn(t.app, viewer.email, viewer.password)
  expect(((await (await call(t.app, "GET", "/v1/me", { cookie: vc })).json()) as Json).platformRole).toBe("viewer")
})

test("a suspended staff row is not a platform role on /v1/me", async () => {
  const t = testApp()
  const s = await makeStaff(t.deps, "owner", { status: "suspended" })
  expect(((await (await call(t.app, "GET", "/v1/me", { cookie: s.cookie })).json()) as Json).platformRole).toBeNull()
})

test("GET /v1/me/tenant is typed: name, brand.primaryColor, reportDeadline, reportDueAfterMinutes, device and features.drive", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "ctx2", name: "Ctx Two" })
  const u = await makeMember(t.deps, a.id, "owner")
  const { cookie } = await signIn(t.app, u.email, u.password)
  const first = (await (await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "ctx2" })).json()) as Json
  expect(first.tenant).toMatchObject({ id: a.id, slug: "ctx2", name: "Ctx Two", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", sessionIdleHours: 12 })
  expect(first.member).toMatchObject({ userId: u.userId, roleKey: "owner" })
  expect(first.brand).toEqual({ primaryColor: null })
  expect(first.reportDeadline).toMatch(/^\d\d:\d\d$/)
  expect(Number.isInteger(first.reportDueAfterMinutes)).toBe(true)
  expect(first.device).toEqual({ id: null, type: "browser", label: "Unregistered browser", trusted: false })
  expect(first.features).toEqual({ drive: true })
  // settings written by the owner show up (staff cannot read settings, so this route is where they get them)
  expect((await call(t.app, "PUT", "/v1/settings/branding", { cookie, tenant: "ctx2", body: { logoFileId: null, primaryColor: "#0A1B2C" } })).status).toBe(200)
  expect((await call(t.app, "PATCH", "/v1/settings/organisation", { cookie, tenant: "ctx2", body: { reportDeadline: "18:15", reportDueAfterMinutes: 90 } })).status).toBe(200)
  const next = (await (await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "ctx2" })).json()) as Json
  expect(next).toMatchObject({ brand: { primaryColor: "#0A1B2C" }, reportDeadline: "18:15", reportDueAfterMinutes: 90 })
})

test("a plain member (no settings permission) still gets brand, deadline and device from /v1/me/tenant", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "ctx3" })
  const owner = await makeMember(t.deps, a.id, "owner")
  const { cookie: oc } = await signIn(t.app, owner.email, owner.password)
  await call(t.app, "PUT", "/v1/settings/branding", { cookie: oc, tenant: "ctx3", body: { logoFileId: null, primaryColor: "#112233" } })
  const staff = await makeMember(t.deps, a.id, "employee")
  const { cookie } = await signIn(t.app, staff.email, staff.password)
  expect((await call(t.app, "GET", "/v1/settings/branding", { cookie, tenant: "ctx3" })).status).toBe(403)
  const r = (await (await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "ctx3" })).json()) as Json
  expect(r.brand).toEqual({ primaryColor: "#112233" })
})

test("features.drive follows the device policy per request: false on an unregistered browser, true on the bound company PC, false again once trust is revoked", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "drv" })
  const admin = await makeMember(t.deps, a.id, "owner")
  const staff = await makeMember(t.deps, a.id, "employee")
  const ac = (await signIn(t.app, admin.email, admin.password)).cookie
  const sc = (await signIn(t.app, staff.email, staff.password)).cookie
  const req = (m: string, path: string, cookie: string, body?: unknown, extra?: string) => call(t.app, m, path, { cookie: extra ? `${cookie}; ${extra}` : cookie, tenant: "drv", body })
  expect((await req("PUT", "/v1/device-policies/drive", ac, { allow: "trusted-company-pc" })).status).toBe(200)
  const reg = await req("POST", "/v1/devices", ac, { userId: staff.userId, type: "pc", owner: "company", label: "Front desk PC", trusted: true })
  const pc = (await reg.json()) as Json
  const code = ((await (await req("POST", `/v1/devices/${pc.id}/enrolment-code`, ac)).json()) as Json).code as string
  const bind = await req("POST", `/v1/devices/${pc.id}/bind`, sc, { code })
  expect(bind.status).toBe(200)
  const dev = bind.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("od-device-"))!
  const before = (await (await req("GET", "/v1/me/tenant", sc)).json()) as Json
  expect(before.features).toEqual({ drive: false })
  expect(before.device.id).toBeNull()
  const on = (await (await req("GET", "/v1/me/tenant", sc, undefined, dev)).json()) as Json
  expect(on.features).toEqual({ drive: true })
  expect(on.device).toEqual({ id: pc.id, type: "pc", label: "Front desk PC", trusted: true })
  expect((await req("PATCH", `/v1/devices/${pc.id}`, ac, { trusted: false })).status).toBe(200)
  const off = (await (await req("GET", "/v1/me/tenant", sc, undefined, dev)).json()) as Json
  expect(off.features).toEqual({ drive: false })
  expect(off.device.trusted).toBe(false)
})

test("T6.3: /v1/me/tenant carries the caller's own role (label, home, access) so a plain member does not need settings:read to learn what it may do", async () => {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "role-ctx" })
  const owner = await makeMember(t.deps, a.id, "owner")
  const staff = await makeMember(t.deps, a.id, "employee")
  const mine = async (m: { email: string; password: string }) => {
    const { cookie } = await signIn(t.app, m.email, m.password)
    return (await (await call(t.app, "GET", "/v1/me/tenant", { cookie, tenant: "role-ctx" })).json()) as Json
  }
  const o = await mine(owner)
  expect(o.member.role).toMatchObject({ label: expect.any(String), home: "manager", access: { settings: "write", tasks: "write" } })
  const s = await mine(staff)
  expect(s.member).toMatchObject({ roleKey: "employee", role: { home: "staff", access: { settings: "none" } } })
  expect(Object.keys(s.member.role).sort()).toEqual(["access", "description", "home", "label"])
  // the matrix is the caller's own: staff never see another role's rows
  expect(JSON.stringify(s)).not.toContain('"settings":"write"')
})
