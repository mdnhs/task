import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery, testDb } from "../../../test/db"
import { makeMember, makeTenant, signIn, signUp } from "../../../test/factories"
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
