import { beforeEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { call, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, roleIdOf, signIn, signUp } from "../../../test/factories"
import { resetSubscribers } from "../../core/events"
import { changeSubscription, clearModuleOverride, entitlementsFor, invalidateEntitlements, setModuleOverride } from "."

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000
beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})

async function world(sub?: Parameters<typeof makeTenant>[1] extends infer O ? (O extends { subscription?: infer S } ? S : never) : never, role = "owner") {
  const t = testApp()
  const tenant = await makeTenant(t.deps, sub ? { subscription: sub } : {})
  const owner = await makeMember(t.deps, tenant.id, role)
  const { cookie } = await signIn(t.app, owner.email, owner.password)
  return { ...t, tenant, owner, cookie }
}
type W = Awaited<ReturnType<typeof world>>
const get = (w: W, path: string) => call(w.app, "GET", path, { cookie: w.cookie, tenant: w.tenant.slug })
const post = (w: W, path: string, body?: unknown) => call(w.app, "POST", path, { cookie: w.cookie, tenant: w.tenant.slug, body })
const code = async (r: Response) => ((await r.json()) as Json).code

test("new tenant starts trialing on the default plan with trial_ends_at = created + trialDays", async () => {
  const t = testApp()
  await signUp(t.app, "founder@x.ie", "Passw0rd!long")
  const { cookie } = await signIn(t.app, "founder@x.ie", "Passw0rd!long")
  const created = await call(t.app, "POST", "/v1/tenants", { cookie, body: { name: "Coppers", slug: "coppers" } })
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as Json
  const [s] = await ownerTenantQuery(id, "select plan_id, status, seats, trial_ends_at from subscriptions")
  expect(s).toMatchObject({ plan_id: "starter", status: "trialing", seats: 10 })
  expect((s.trial_ends_at as Date).getTime()).toBe(t.clock.now().getTime() + 14 * DAY)
  const e = (await (await call(t.app, "GET", "/v1/entitlements", { cookie, tenant: "coppers" })).json()) as Json
  expect(e).toMatchObject({ planId: "starter", status: "trialing", modules: ["M0", "M1"], seats: 10, seatsUsed: 1, billingState: "ok" })
  expect(e.trialEndsAt).toBe(new Date(t.clock.now().getTime() + 14 * DAY).toISOString())
})

test("plans are seeded from plans.json in minor units and app_user cannot write them", async () => {
  const rows = await ownerQuery("select id, price_monthly_minor, currency, trial_days from plans order by price_monthly_minor")
  expect(rows).toEqual([
    { id: "starter", price_monthly_minor: 4900, currency: "EUR", trial_days: 14 },
    { id: "business", price_monthly_minor: 14900, currency: "EUR", trial_days: 14 },
    { id: "enterprise", price_monthly_minor: 39900, currency: "EUR", trial_days: 14 },
  ])
  const t = testApp()
  await expect(t.deps.db.execute("update plans set name = 'x'" as never)).rejects.toBeDefined()
})

test("GET /v1/entitlements: any member sees plan, modules and seats", async () => {
  const w = await world({ planId: "starter", seats: 10 }, "employee")
  const e = (await (await get(w, "/v1/entitlements")).json()) as Json
  expect(e).toMatchObject({ planId: "starter", status: "active", modules: ["M0", "M1"], seats: 10, seatsUsed: 1, trialEndsAt: null, billingState: "ok" })
})

test("requireModule('M1A') -> 403 module_not_entitled on starter, 200 on business", async () => {
  const s = await world({ planId: "starter" })
  const r = await get(s, "/v1/_probe/m1a")
  expect(r.status).toBe(403)
  expect(r.headers.get("content-type")).toMatch(/problem\+json/)
  expect(await code(r)).toBe("module_not_entitled")
  const b = await world()
  expect((await get(b, "/v1/_probe/m1a")).status).toBe(200)
})

test("entitlement removal keeps data and blocks within the TTL (AC-M0-05)", async () => {
  const w = await world()
  await post(w, "/v1/files/uploads", { name: "a.pdf", mime: "application/pdf", sizeBytes: 10 }) // an M4 row
  const rowsBefore = await ownerTenantQuery(w.tenant.id, "select count(*)::int n from files")
  expect(rowsBefore[0].n).toBe(1)
  expect((await get(w, "/v1/_probe/m1a")).status).toBe(200) // cached now

  // A change made behind this process's back (another instance / SQL): the cache may serve it for < 60 s, never longer.
  await ownerTenantQuery(w.tenant.id, `insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1A', 'revoke', 'test', 'p', now()), ($1, 'M4', 'revoke', 'test', 'p', now())`, [w.tenant.id])
  w.clock.advance({ minutes: 0.5 })
  expect((await get(w, "/v1/_probe/m1a")).status).toBe(200) // 30 s: still served from the cache
  w.clock.advance({ minutes: 0.5 }) // 60 s elapsed
  const blocked = await get(w, "/v1/_probe/m1a")
  expect(blocked.status).toBe(403)
  expect(await code(blocked)).toBe("module_not_entitled")
  expect(await code(await post(w, "/v1/files/uploads", { name: "b.pdf", mime: "application/pdf", sizeBytes: 10 }))).toBe("module_not_entitled")
  expect((await get(w, "/v1/entitlements").then((r) => r.json()) as Json).modules).not.toContain("M1A")
  // data is untouched
  expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int n from files"))[0].n).toBe(1)

  // re-grant (in-process change: immediate) restores access to the same rows
  await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1A")
  await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M4")
  expect((await get(w, "/v1/_probe/m1a")).status).toBe(200)
  expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int n from files"))[0].n).toBe(1)
})

test("a change made in-process (override / plan change) is effective at once and audited with before/after", async () => {
  const w = await world({ planId: "starter" })
  expect((await get(w, "/v1/_probe/m1a")).status).toBe(403)
  await setModuleOverride(w.deps, w.tenant.id, w.owner.userId, { module: "M1A", mode: "grant", reason: "pilot" })
  expect((await get(w, "/v1/_probe/m1a")).status).toBe(200)
  await setModuleOverride(w.deps, w.tenant.id, w.owner.userId, { module: "M1A", mode: "revoke", reason: "ended" })
  expect((await get(w, "/v1/_probe/m1a")).status).toBe(403)
  await changeSubscription(w.deps, w.tenant.id, w.owner.userId, { planId: "business" })
  const audits = await ownerTenantQuery(w.tenant.id, "select action, before, after from audit_events where action like 'module_override.%' or action like 'subscription.%' order by seq")
  expect(audits.map((a) => a.action)).toEqual(["module_override.set", "module_override.set", "subscription.changed"])
  expect(audits[0]).toMatchObject({ before: null, after: { mode: "grant", reason: "pilot" } })
  expect(audits[1]).toMatchObject({ before: { mode: "grant", reason: "pilot" }, after: { mode: "revoke", reason: "ended" } })
  expect(audits[2]).toMatchObject({ before: { planId: "starter" }, after: { planId: "business" } })
  const ev = await ownerTenantQuery(w.tenant.id, "select type, payload from domain_events where type = 'billing.subscription_changed'")
  expect(ev).toEqual([{ type: "billing.subscription_changed", payload: { from: { planId: "starter", status: "active" }, to: { planId: "business", status: "active" } } }])
  await changeSubscription(w.deps, w.tenant.id, w.owner.userId, { seats: 12 }) // seats only: no event
  expect((await ownerTenantQuery(w.tenant.id, "select 1 from domain_events where type = 'billing.subscription_changed'")).length).toBe(1)
})

test("core modules cannot be revoked by override", async () => {
  const w = await world({ planId: "starter" })
  await expect(setModuleOverride(w.deps, w.tenant.id, w.owner.userId, { module: "M0", mode: "revoke", reason: "x" })).rejects.toMatchObject({ status: 422, code: "core_module" })
  await expect(setModuleOverride(w.deps, w.tenant.id, w.owner.userId, { module: "nope", mode: "grant", reason: "x" })).rejects.toMatchObject({ status: 422, code: "unknown_module" })
  // even a row forced in underneath leaves M0 in place
  await ownerTenantQuery(w.tenant.id, `insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M0', 'revoke', 'x', 'p', now())`, [w.tenant.id])
  const e = (await (await get(w, "/v1/entitlements")).json()) as Json
  expect(e.modules).toContain("M0")
})

test("invite accept beyond seats -> 409 seat_limit", async () => {
  const w = await world({ seats: 1 }) // the owner already holds the only seat
  const roleId = await roleIdOf(w.deps, w.tenant.id, "employee")
  expect((await post(w, "/v1/invites", { email: "new@x.ie", roleId })).status).toBe(201)
  const token = w.mailer.last().text.match(/\/invite\?token=([\w-]+)/)![1]
  await signUp(w.app, "new@x.ie", "Passw0rd!long", "New")
  const nc = (await signIn(w.app, "new@x.ie", "Passw0rd!long")).cookie
  const r = await call(w.app, "POST", "/v1/invites/accept", { cookie: nc, body: { token } })
  expect(r.status).toBe(409)
  expect(await code(r)).toBe("seat_limit")
  expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int n from memberships"))[0].n).toBe(1)
})

test("concurrent accepts respect the seat limit", async () => {
  const w = await world({ seats: 2 }) // one seat free
  const roleId = await roleIdOf(w.deps, w.tenant.id, "employee")
  const cookies: { cookie: string; token: string }[] = []
  for (const email of ["a@x.ie", "b@x.ie"]) {
    expect((await post(w, "/v1/invites", { email, roleId })).status).toBe(201)
    const token = w.mailer.last().text.match(/\/invite\?token=([\w-]+)/)![1]
    await signUp(w.app, email, "Passw0rd!long", "N")
    cookies.push({ cookie: (await signIn(w.app, email, "Passw0rd!long")).cookie, token })
  }
  const results = await Promise.all(cookies.map((c) => call(w.app, "POST", "/v1/invites/accept", { cookie: c.cookie, body: { token: c.token } })))
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  expect(await code(results.find((r) => r.status === 409)!)).toBe("seat_limit")
  expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int n from memberships where status = 'active'"))[0].n).toBe(2)
})

test("expired trial: 7-day grace allows writes (reported by /v1/entitlements), then non-GET -> 402 billing_required; GET, billing and export routes stay open", async () => {
  const now = new Date("2026-11-16T09:00:00Z")
  // trial ended 3 days ago: grace
  const g = await world({ planId: "starter", status: "trialing", seats: 10, trialEndsAt: new Date(now.getTime() - 3 * DAY) })
  expect((await post(g, "/v1/_probe/write")).status).toBe(200)
  const ge = (await (await get(g, "/v1/entitlements")).json()) as Json
  expect(ge).toMatchObject({ status: "trialing", billingState: "grace" })
  expect(ge.graceEndsAt).toBe(new Date(now.getTime() + 4 * DAY).toISOString())

  // trial ended 8 days ago: blocked
  const b = await world({ planId: "starter", status: "trialing", seats: 10, trialEndsAt: new Date(now.getTime() - 8 * DAY) })
  const w = await post(b, "/v1/_probe/write")
  expect(w.status).toBe(402)
  expect(w.headers.get("content-type")).toMatch(/problem\+json/)
  expect(await code(w)).toBe("billing_required")
  expect((await get(b, "/v1/entitlements")).status).toBe(200) // GETs stay open
  expect(((await (await get(b, "/v1/entitlements")).json()) as Json).billingState).toBe("blocked")
  expect((await get(b, "/v1/_probe/m1a")).status).toBe(403) // starter: not entitled, but not 402 (GET)
  // exempt: data export (self-service and the export kind of data requests), sign-out
  const ex = await post(b, "/v1/data-requests", { subjectUserId: b.owner.userId, kind: "export", reason: "Subject access request received by email" })
  expect(ex.status).toBe(201)
  expect(await code(await post(b, "/v1/me/data-export"))).toBe("request_open") // reached the handler (409), not 402
  expect((await post(b, "/v1/data-requests", { subjectUserId: b.owner.userId, kind: "erase", reason: "Subject asked for erasure by email" })).status).not.toBe(402) // C13: opening ANY data request stays open
  expect((await call(b.app, "POST", "/api/auth/sign-out", { cookie: b.cookie, headers: { origin: "http://localhost:3000" } })).status).toBe(200)
  // paying lifts the block (in-process change)
  const p = await world({ planId: "starter", status: "trialing", seats: 10, trialEndsAt: new Date(now.getTime() - 8 * DAY) })
  expect((await post(p, "/v1/_probe/write")).status).toBe(402)
  await changeSubscription(p.deps, p.tenant.id, p.owner.userId, { status: "active", trialEndsAt: null })
  expect((await post(p, "/v1/_probe/write")).status).toBe(200)
})

test("canceled subscription is blocked like an expired trial; past_due is not", async () => {
  const c = await world({ status: "canceled" })
  expect((await post(c, "/v1/_probe/write")).status).toBe(402)
  const d = await world({ status: "past_due" })
  expect((await post(d, "/v1/_probe/write")).status).toBe(200)
})

test("subscriptions and module_overrides are tenant-isolated (RLS)", async () => {
  const a = await world()
  const b = await world()
  await ownerTenantQuery(b.tenant.id, `insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M2', 'revoke', 'x', 'p', now())`, [b.tenant.id])
  expect((await ownerTenantQuery(a.tenant.id, "select tenant_id from subscriptions")).map((r) => r.tenant_id)).toEqual([a.tenant.id])
  expect(await ownerTenantQuery(a.tenant.id, "select 1 from module_overrides")).toEqual([])
})

test("unpaid and paused are blocked like canceled (402 on writes, GETs open)", async () => {
  for (const status of ["unpaid", "paused"] as const) {
    const w = await world({ status })
    expect((await post(w, "/v1/_probe/write")).status, status).toBe(402)
    expect(await code(await post(w, "/v1/_probe/write")), status).toBe("billing_required")
    expect((await get(w, "/v1/entitlements")).status).toBe(200)
    expect(((await (await get(w, "/v1/entitlements")).json()) as Json).billingState).toBe("blocked")
  }
})

test("a load that started before an invalidate cannot repopulate the cache with stale state (generation counter)", async () => {
  const w = await world({ planId: "starter", seats: 10 })
  // Proxy the db so that the entitlement load finishes, then an invalidate lands before the loader caches its result.
  const db = new Proxy(w.deps.db, {
    get(target, prop, recv) {
      if (prop !== "transaction") return Reflect.get(target, prop, recv)
      return async (...args: unknown[]) => {
        const r = await (target.transaction as (...a: unknown[]) => Promise<unknown>)(...args)
        invalidateEntitlements(w.tenant.id) // a change committed + invalidated while this (old) load was in flight
        return r
      }
    },
  })
  const raced = await entitlementsFor({ ...w.deps, db }, w.tenant.id)
  expect(raced.planId).toBe("starter") // the loader saw the old state...
  await ownerTenantQuery(w.tenant.id, "update subscriptions set plan_id = 'business', seats = 40")
  // ...but it must not have been cached: the next read (same clock instant) sees the new plan.
  expect((await entitlementsFor(w.deps, w.tenant.id)).planId).toBe("business")
})
