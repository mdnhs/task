import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeStaff, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { dataRequests } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { verifyChain } from "../audit"
import { verifyPlatformChain } from "../platform-audit"
import { healthOf } from "./tenants"

// B8 Task 17 (carry-ins C): the platform bell (derived feed + seen stamp), the platform-side resolve of a data request, and the per-tenant MRR / health / usage columns.
// The fake clock starts at 2026-11-16T09:00Z.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000
beforeEach(resetDb)
const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
afterAll(() => owner.end())

async function world(role: "owner" | "support" | "billing" | "viewer" = "owner") {
  const t = testApp()
  const staff = await makeStaff(t.deps, role)
  const req = (method: string, path: string, cookie: string | undefined = staff.cookie, body?: unknown) => call(t.app, method, path, { cookie, body })
  const json = async (r: Response) => (await r.json()) as Json
  return { ...t, staff, req, json }
}
type W = Awaited<ReturnType<typeof world>>
const ago = (w: W, ms: number) => new Date(w.clock.now().getTime() + ms)
/** A tenant made ten days before the fake clock (the database stamps real time, which would be after it). */
async function mk(w: W, over: Parameters<typeof makeTenant>[1] = {}) {
  const t = await makeTenant(w.deps, over)
  await ownerQuery("update tenants set created_at = $2 where id = $1", [t.id, ago(w, -10 * DAY)])
  return t
}
async function addDsr(w: W, tenantId: string, over: Partial<{ status: string; kind: string; createdAt: Date; dueAt: Date }> = {}): Promise<string> {
  const [row] = await withTenant(w.deps.db, tenantId, (tx) =>
    tx.insert(dataRequests).values({
      tenantId, subjectUserId: "usr_secret_subject", kind: over.kind ?? "export", status: over.status ?? "pending", requestedBy: "usr_requester", reason: "private reason text",
      createdAt: over.createdAt ?? w.clock.now(), dueAt: over.dueAt ?? ago(w, 30 * DAY),
    }).returning({ id: dataRequests.id }),
  )
  return row.id
}
const tenantAudit = (tenantId: string) => ownerTenantQuery(tenantId, "select seq, actor_id, action, entity, entity_id, before, after from audit_events where tenant_id = $1 order by seq", [tenantId])
const platAudit = () => ownerQuery("select seq, actor_id, action, entity, entity_id, target_tenant_id, before, after from platform_audit_events order by seq")

describe("access (C4)", () => {
  test("non-staff get 404 on the three routes, a staff member without MFA 401 mfa_enrolment_required (the platform gate), a session that did not pass MFA 401 mfa_challenge; no session 401", async () => {
    const w = await world()
    const tn = await mk(w)
    const owner = await makeMember(w.deps, tn.id, "owner")
    const { cookie } = await signIn(w.app, owner.email, owner.password)
    const noMfa = await makeStaff(w.deps, "owner", { totp: false })
    const noMfaCookie = (await signIn(w.app, noMfa.email, noMfa.password)).cookie
    const stale = (await makeStaff(w.deps, "viewer")).staleCookie!
    const id = randomUUID()
    const routes: [string, string, unknown][] = [["GET", "/v1/platform/notifications", undefined], ["POST", "/v1/platform/notifications/seen", {}], ["POST", `/v1/platform/data-requests/${id}/resolve`, { outcome: "completed", note: "done" }]]
    for (const [method, path, body] of routes) {
      expect((await call(w.app, method, path, { cookie, tenant: tn.slug, body })).status, `${method} ${path} tenant owner`).toBe(404)
      expect((await call(w.app, method, path, { cookie: noMfaCookie, body })).status, `${method} ${path} no MFA`).toBe(401)
      expect(((await (await call(w.app, method, path, { cookie: noMfaCookie, body })).json()) as Json).code).toBe("mfa_enrolment_required")
      const s = await call(w.app, method, path, { cookie: stale, body })
      expect([s.status, ((await s.json()) as Json).code], `${method} ${path} stale`).toEqual([401, "mfa_challenge"])
      expect((await call(w.app, method, path, { body })).status, `${method} ${path} anonymous`).toBe(401)
    }
  })

  test("resolve is for owner and support; billing and viewer are 403 platform_forbidden; the bell is open to all four staff roles", async () => {
    const w = await world("owner")
    const tn = await mk(w)
    const id = await addDsr(w, tn.id, { status: "running" })
    for (const role of ["billing", "viewer"] as const) {
      const s = await makeStaff(w.deps, role)
      const r = await w.req("POST", `/v1/platform/data-requests/${id}/resolve`, s.cookie, { outcome: "completed", note: "x" })
      expect([r.status, (await w.json(r)).code]).toEqual([403, "platform_forbidden"])
      expect((await w.req("GET", "/v1/platform/notifications", s.cookie)).status).toBe(200)
    }
    const support = await makeStaff(w.deps, "support")
    expect((await w.req("POST", `/v1/platform/data-requests/${id}/resolve`, support.cookie, { outcome: "completed", note: "x" })).status).toBe(200)
  })
})

describe("bell", () => {
  test("lists the four item kinds (pending data request, past_due payment, trial ending within 7 days, own support grant expiring within 24 h) and nothing else; unread counts items newer than notifications_seen_at; seen stamps from the clock and clears unread", async () => {
    const w = await world()
    const failing = await mk(w, { name: "Failing Payment Ltd", subscription: { status: "past_due" } })
    const ending = await mk(w, { name: "Trial Ending Ltd", subscription: { planId: "starter", status: "trialing", trialEndsAt: ago(w, 3 * DAY) } })
    await mk(w, { name: "Trial Later Ltd", subscription: { planId: "starter", status: "trialing", trialEndsAt: ago(w, 20 * DAY) } }) // not within 7 days
    await mk(w, { name: "Healthy Ltd" })
    const dsrId = await addDsr(w, failing.id, { createdAt: ago(w, -2 * DAY) })
    await addDsr(w, failing.id, { status: "completed" }) // not pending
    const grant = await w.json(await w.req("POST", `/v1/platform/tenants/${ending.id}/support-grants`, w.staff.cookie, { reason: "Look into the roster", hours: 2 }))
    const other = await makeStaff(w.deps, "support")
    const otherTenant = await mk(w, { name: "Other Grant Ltd" })
    expect((await w.req("POST", `/v1/platform/tenants/${otherTenant.id}/support-grants`, other.cookie, { reason: "Someone else's", hours: 1 })).status).toBe(201)

    const bell = await w.json(await w.req("GET", "/v1/platform/notifications"))
    const kinds = (bell.items as Json[]).map((i) => [i.kind, i.tenantName, i.refId])
    expect(kinds.sort()).toEqual([
      ["data_request", "Failing Payment Ltd", dsrId], ["failed_payment", "Failing Payment Ltd", null], ["grant_expiring", "Trial Ending Ltd", grant.id], ["trial_ending", "Trial Ending Ltd", null],
    ].sort())
    expect(bell.unread).toBe(4)
    // newest first, ids and names only: no subject, requester, reason or member data
    const at = (bell.items as Json[]).map((i) => Date.parse(i.at))
    expect(at).toEqual([...at].sort((a, b) => b - a))
    const text = JSON.stringify(bell)
    for (const bad of ["usr_secret_subject", "usr_requester", "private reason text", "Look into the roster", other.userId, "Someone else's", "Other Grant Ltd"]) expect(text).not.toContain(bad)

    // seen: stamps the staff member's own column from the clock, never anyone else's
    const seen = await w.json(await w.req("POST", "/v1/platform/notifications/seen", w.staff.cookie, {}))
    expect(seen).toEqual({ seenAt: w.clock.now().toISOString(), unread: 0 })
    const rows = await ownerQuery("select user_id, notifications_seen_at from platform_staff order by added_at, user_id")
    expect(rows.filter((r) => r.notifications_seen_at !== null).map((r) => r.user_id)).toEqual([w.staff.userId])
    const after = await w.json(await w.req("GET", "/v1/platform/notifications"))
    expect([after.unread, after.items.length]).toEqual([0, 4]) // still listed, no longer unread
    // a later item is unread again; the other staff member still has all of theirs unread
    w.clock.advance({ hours: 1 })
    await addDsr(w, ending.id)
    expect((await w.json(await w.req("GET", "/v1/platform/notifications"))).unread).toBe(1)
    expect((await w.json(await w.req("GET", "/v1/platform/notifications", other.cookie))).unread).toBeGreaterThanOrEqual(4)
    // seen does not move backwards and each call stamps the clock again
    w.clock.advance({ hours: 1 })
    expect((await w.json(await w.req("POST", "/v1/platform/notifications/seen", w.staff.cookie, {}))).seenAt).toBe(w.clock.now().toISOString())
  })

  test("an expired or revoked grant, a trial past its end, an active subscription and a resolved data request are not in the feed; the 7 day and 24 h limits are exact", async () => {
    const w = await world()
    const a = await mk(w, { name: "A", subscription: { planId: "starter", status: "trialing", trialEndsAt: ago(w, 7 * DAY) } }) // exactly 7 days: in
    await mk(w, { name: "B", subscription: { planId: "starter", status: "trialing", trialEndsAt: ago(w, 7 * DAY + 1000) } }) // just over: out
    await mk(w, { name: "C", subscription: { planId: "starter", status: "trialing", trialEndsAt: ago(w, -1000) } }) // already ended: out
    const items = async () => (await w.json(await w.req("GET", "/v1/platform/notifications"))).items as Json[]
    expect((await items()).map((i) => [i.kind, i.tenantName])).toEqual([["trial_ending", "A"]])
    const grant = await w.json(await w.req("POST", `/v1/platform/tenants/${a.id}/support-grants`, w.staff.cookie, { reason: "r", hours: 1 }))
    expect((await items()).map((i) => i.kind).sort()).toEqual(["grant_expiring", "trial_ending"])
    expect((await w.req("DELETE", `/v1/platform/support-grants/${grant.id}`)).status).toBe(200) // revoked
    expect((await items()).map((i) => i.kind)).toEqual(["trial_ending"])
  })

  test("migration 0049 run for real as app_owner without tenant context adds one nullable column and leaves existing staff rows unread", async () => {
    const w = await world()
    const file = readFileSync(new URL("../../db/migrations/0049_platform_bell.sql", import.meta.url), "utf8")
    const c = await owner.connect()
    try {
      await c.query("begin") // rolled back
      await c.query("alter table platform_staff drop column notifications_seen_at") // the state before 0049
      for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt)
      expect((await c.query("select is_nullable, data_type from information_schema.columns where table_name = 'platform_staff' and column_name = 'notifications_seen_at'")).rows).toEqual([{ is_nullable: "YES", data_type: "timestamp with time zone" }])
      expect((await c.query("select count(*)::int as n from platform_staff where user_id = $1 and notifications_seen_at is null", [w.staff.userId])).rows[0].n).toBe(1)
    } finally {
      await c.query("rollback")
      c.release()
    }
  })
})

describe("data request resolve", () => {
  test("only from `running` (the job is processing it): pending, failed, completed and rejected are 409 request_not_processing; completed and rejected each audit once in BOTH chains; a second call is 409; the tenant sees the new status", async () => {
    const w = await world()
    const tn = await mk(w, { name: "Resolve Ltd" })
    const owner = await makeMember(w.deps, tn.id, "owner")
    const { cookie } = await signIn(w.app, owner.email, owner.password)
    const resolve = (id: string, body: unknown) => w.req("POST", `/v1/platform/data-requests/${id}/resolve`, w.staff.cookie, body)
    for (const status of ["pending", "failed", "completed", "rejected"]) {
      const id = await addDsr(w, tn.id, { status })
      const r = await resolve(id, { outcome: "completed", note: "nope" })
      expect([r.status, (await w.json(r)).code], status).toEqual([409, "request_not_processing"])
    }
    expect(await tenantAudit(tn.id)).toEqual([])
    const done = await addDsr(w, tn.id, { status: "running", kind: "erase" })
    const ok = await resolve(done, { outcome: "completed", note: "Handled by hand with the controller" })
    expect(ok.status).toBe(200)
    expect(await w.json(ok)).toMatchObject({ id: done, tenantId: tn.id, status: "completed" })
    const second = await resolve(done, { outcome: "completed", note: "again" })
    expect([second.status, (await w.json(second)).code]).toEqual([409, "request_not_processing"])
    const rej = await addDsr(w, tn.id, { status: "running" })
    expect((await resolve(rej, { outcome: "rejected", note: "Identity not verified" })).status).toBe(200)
    expect((await resolve(rej, { outcome: "rejected", note: "again" })).status).toBe(409)
    // the tenant side: the status and the note, through the ordinary data-request API (the platform changed it through the gdpr service)
    const mine = await call(w.app, "GET", `/v1/data-requests/${done}`, { cookie, tenant: tn.slug })
    expect(mine.status, await mine.clone().text()).toBe(200)
    expect(await w.json(mine)).toMatchObject({ status: "completed", notes: "Handled by hand with the controller" })
    expect(await w.json(await call(w.app, "GET", `/v1/data-requests/${rej}`, { cookie, tenant: tn.slug }))).toMatchObject({ status: "rejected", notes: "Identity not verified" })
    // exactly one audit row per resolve in the tenant chain (actor platform:<staffId>) and in the platform chain (actor = staff id, target tenant)
    const ta = (await tenantAudit(tn.id)).filter((r) => String(r.action).startsWith("dsr."))
    expect(ta.map((r) => [r.action, r.entity_id, r.actor_id])).toEqual([["dsr.completed", done, `platform:${w.staff.userId}`], ["dsr.rejected", rej, `platform:${w.staff.userId}`]])
    expect(ta[0].before).toMatchObject({ status: "running" })
    const pa = (await platAudit()).filter((r) => String(r.action).startsWith("platform.data_request."))
    expect(pa.map((r) => [r.action, r.entity, r.entity_id, r.actor_id, r.target_tenant_id])).toEqual([
      ["platform.data_request.completed", "data_request", done, w.staff.userId, tn.id], ["platform.data_request.rejected", "data_request", rej, w.staff.userId, tn.id],
    ])
    expect(JSON.stringify(pa)).not.toContain("usr_secret_subject")
    expect(await verifyChain(w.deps.db, tn.id)).toMatchObject({ ok: true })
    expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
  })

  test("validation and not-found: unknown, other-looking and non-uuid ids 404 data_request_not_found; a bad outcome 422 invalid_outcome; an empty or 501-character note 422 invalid_note; nothing is written", async () => {
    const w = await world()
    const tn = await mk(w)
    const id = await addDsr(w, tn.id, { status: "running" })
    const resolve = (path: string, body: unknown) => w.req("POST", `/v1/platform/data-requests/${path}/resolve`, w.staff.cookie, body)
    for (const p of [randomUUID(), "not-a-uuid", "0".repeat(100)]) {
      const r = await resolve(p, { outcome: "completed", note: "x" })
      expect([r.status, (await w.json(r)).code], p).toEqual([404, "data_request_not_found"])
    }
    for (const [body, code] of [[{ outcome: "maybe", note: "x" }, "invalid_outcome"], [{ note: "x" }, "invalid_outcome"], [{ outcome: "completed" }, "invalid_note"], [{ outcome: "completed", note: "  " }, "invalid_note"], [{ outcome: "completed", note: "n".repeat(501) }, "invalid_note"]] as const) {
      const r = await resolve(id, body)
      expect([r.status, (await w.json(r)).code], JSON.stringify(body)).toEqual([422, code])
    }
    expect((await ownerTenantQuery(tn.id, "select status from data_requests where id = $1", [id]))[0].status).toBe("running")
    expect((await platAudit()).length).toBe(0)
  })

  test("a request of another tenant is found only by its own id and changes only that tenant (two-tenant fixture)", async () => {
    const w = await world()
    const a = await mk(w, { name: "A" })
    const b = await mk(w, { name: "B" })
    const idA = await addDsr(w, a.id, { status: "running" })
    const idB = await addDsr(w, b.id, { status: "running" })
    expect((await w.req("POST", `/v1/platform/data-requests/${idB}/resolve`, w.staff.cookie, { outcome: "rejected", note: "B only" })).status).toBe(200)
    expect((await ownerTenantQuery(a.id, "select status from data_requests where id = $1", [idA]))[0].status).toBe("running")
    expect((await ownerTenantQuery(b.id, "select status from data_requests where id = $1", [idB]))[0].status).toBe("rejected")
    expect(await tenantAudit(a.id)).toEqual([])
  })
})

describe("per-tenant MRR, health and usage", () => {
  test("MRR is the flat plan price of an ACTIVE subscription in the plan's currency, never seats times price; trialing, past_due, canceled, unpaid and no subscription are 0; list and detail agree; the sum equals /metrics", async () => {
    const w = await world()
    const starter = await mk(w, { name: "Starter", subscription: { planId: "starter", status: "active", seats: 7 } })
    const business = await mk(w, { name: "Business", subscription: { planId: "business", status: "active", seats: 40 } })
    const rest: Record<string, string> = {}
    for (const status of ["trialing", "past_due", "canceled", "unpaid"] as const) rest[status] = (await mk(w, { name: `S-${status}`, subscription: { planId: "business", status } })).id
    const bare = await mk(w, { name: "Bare" })
    await ownerTenantQuery(bare.id, "delete from subscriptions where tenant_id = $1", [bare.id])
    const prices = Object.fromEntries((await ownerQuery("select id, price_monthly_minor as p, currency from plans")).map((r) => [r.id, r]))
    const list = await w.json(await w.req("GET", "/v1/platform/tenants?pageSize=100"))
    const by = (id: string) => (list.items as Json[]).find((i) => i.id === id)!
    expect(by(starter.id)).toMatchObject({ mrrCents: Number(prices.starter.p), currency: String(prices.starter.currency).toUpperCase() })
    expect(by(business.id)).toMatchObject({ mrrCents: Number(prices.business.p), currency: String(prices.business.currency).toUpperCase() }) // 40 seats do not multiply the price
    for (const [status, id] of Object.entries(rest)) expect(by(id), status).toMatchObject({ mrrCents: 0, currency: String(prices.business.currency).toUpperCase() })
    expect(by(bare.id)).toMatchObject({ mrrCents: 0, currency: null })
    const detail = await w.json(await w.req("GET", `/v1/platform/tenants/${business.id}`))
    expect(detail).toMatchObject({ mrrCents: Number(prices.business.p), currency: String(prices.business.currency).toUpperCase() })
    const metrics = await w.json(await w.req("GET", "/v1/platform/metrics"))
    const sum = (list.items as Json[]).reduce((n, i) => n + (i.mrrCents as number), 0)
    expect(sum).toBe(Object.values(metrics.mrrMinor as Record<string, number>).reduce((a, b) => a + b, 0))
  })

  test("health rules: past_due or unpaid is red; a trial ending within 7 days is amber; no activity in 30 days is amber; everything else green (red wins over amber)", () => {
    const now = new Date("2026-11-16T09:00:00Z")
    const d = (days: number) => new Date(now.getTime() + days * DAY)
    const created = d(-200)
    const cases: [string, Parameters<typeof healthOf>[0], "green" | "amber" | "red"][] = [
      ["past_due", { status: "past_due", trialEndsAt: null, lastActivityAt: d(-1), createdAt: created }, "red"],
      ["unpaid", { status: "unpaid", trialEndsAt: null, lastActivityAt: d(-1), createdAt: created }, "red"],
      ["past_due and idle", { status: "past_due", trialEndsAt: null, lastActivityAt: d(-90), createdAt: created }, "red"],
      ["trial ends in 7 days", { status: "trialing", trialEndsAt: d(7), lastActivityAt: d(-1), createdAt: created }, "amber"],
      ["trial ends in 8 days", { status: "trialing", trialEndsAt: d(8), lastActivityAt: d(-1), createdAt: created }, "green"],
      ["trial already ended", { status: "trialing", trialEndsAt: d(-1), lastActivityAt: d(-1), createdAt: created }, "green"],
      ["active, last activity 29 days ago", { status: "active", trialEndsAt: null, lastActivityAt: d(-29), createdAt: created }, "green"],
      ["active, last activity exactly 30 days ago", { status: "active", trialEndsAt: null, lastActivityAt: d(-30), createdAt: created }, "green"],
      ["active, last activity 30 days and 1 s ago", { status: "active", trialEndsAt: null, lastActivityAt: new Date(d(-30).getTime() - 1000), createdAt: created }, "amber"],
      ["active, never active, old tenant", { status: "active", trialEndsAt: null, lastActivityAt: null, createdAt: created }, "amber"],
      ["active, never active, tenant made 5 days ago", { status: "active", trialEndsAt: null, lastActivityAt: null, createdAt: d(-5) }, "green"],
      ["no subscription, active last week", { status: null, trialEndsAt: null, lastActivityAt: d(-7), createdAt: created }, "green"],
      ["canceled, active last week", { status: "canceled", trialEndsAt: null, lastActivityAt: d(-7), createdAt: created }, "green"],
    ]
    for (const [name, input, want] of cases) expect(healthOf(input, now), name).toBe(want)
  })

  test("health in the list and the 360 follows the rules end to end (activity = the newest membership activity or audit event, no tenant detail read)", async () => {
    const w = await world()
    const red = await mk(w, { name: "Red", subscription: { status: "past_due" } })
    const amber = await mk(w, { name: "Amber", subscription: { planId: "starter", status: "trialing", trialEndsAt: ago(w, 2 * DAY) } })
    const idle = await mk(w, { name: "Idle" })
    const green = await mk(w, { name: "Green" })
    await ownerQuery("update tenants set created_at = $2 where id = $1", [idle.id, ago(w, -100 * DAY)])
    await ownerQuery("update tenants set created_at = $2 where id = $1", [green.id, ago(w, -100 * DAY)])
    const m = await makeMember(w.deps, green.id, "owner")
    await ownerTenantQuery(green.id, "update memberships set last_active_at = $3 where tenant_id = $1 and user_id = $2", [green.id, m.userId, ago(w, -2 * DAY)])
    const list = await w.json(await w.req("GET", "/v1/platform/tenants?pageSize=100"))
    const health = Object.fromEntries((list.items as Json[]).map((i) => [i.name, i.health]))
    expect(health).toMatchObject({ Red: "red", Amber: "amber", Idle: "amber", Green: "green" })
    for (const [t, want] of [[red, "red"], [amber, "amber"], [idle, "amber"], [green, "green"]] as const) expect((await w.json(await w.req("GET", `/v1/platform/tenants/${t.id}`))).health).toBe(want)
  })

  test("usage: seats (active members), activeUsers30d (active members seen in the last 30 days) and storageBytes (uploaded files whose object is still stored) are per tenant; a second tenant's rows are never in them", async () => {
    const w = await world()
    const a = await mk(w, { name: "A" })
    const b = await mk(w, { name: "B" })
    const ma = [await makeMember(w.deps, a.id, "owner"), await makeMember(w.deps, a.id, "employee"), await makeMember(w.deps, a.id, "employee")]
    const mb = [await makeMember(w.deps, b.id, "owner"), await makeMember(w.deps, b.id, "employee"), await makeMember(w.deps, b.id, "employee"), await makeMember(w.deps, b.id, "employee"), await makeMember(w.deps, b.id, "employee")]
    const set = (t: string, u: string, sql: string, p: unknown[]) => ownerTenantQuery(t, `update memberships set ${sql} where tenant_id = $1 and user_id = $2`, [t, u, ...p])
    await set(a.id, ma[0].userId, "last_active_at = $3", [ago(w, -1 * DAY)])
    await set(a.id, ma[1].userId, "last_active_at = $3", [ago(w, -40 * DAY)]) // too old
    await set(a.id, ma[2].userId, "status = 'suspended', last_active_at = $3", [ago(w, -1 * DAY)]) // not a seat
    for (const m of mb) await set(b.id, m.userId, "last_active_at = $3", [ago(w, -1 * DAY)])
    const file = (t: string, owner: string, size: number, over: { status?: string; uploaded?: boolean; removed?: boolean } = {}) =>
      ownerTenantQuery(t, "insert into files (id, tenant_id, owner_user_id, key, name, mime, size_bytes, status, created_at, uploaded_at, object_removed_at) select g, $1::uuid, $2, 't/' || ($1::uuid)::text || '/' || g::text, 'f', 'text/plain', $3, $4, $5, $6, $7 from (select gen_random_uuid() g) x",
        [t, owner, size, over.status ?? "clean", ago(w, -3 * DAY), over.uploaded === false ? null : ago(w, -3 * DAY), over.removed ? ago(w, -1 * DAY) : null])
    await file(a.id, ma[0].userId, 1000)
    await file(a.id, ma[0].userId, 500, { status: "deleted" }) // deleted but the object is still stored: counts until removed
    await file(a.id, ma[0].userId, 7000, { status: "deleted", removed: true }) // gone
    await file(a.id, ma[0].userId, 9000, { status: "pending", uploaded: false }) // never uploaded
    await file(b.id, mb[0].userId, 123456)
    const get = async (id: string) => (await w.json(await w.req("GET", `/v1/platform/tenants/${id}`))).usage
    expect(await get(a.id)).toEqual({ seats: 2, activeUsers30d: 1, storageBytes: 1500 })
    expect(await get(b.id)).toEqual({ seats: 5, activeUsers30d: 5, storageBytes: 123456 })
    const list = await w.json(await w.req("GET", "/v1/platform/tenants?pageSize=100"))
    expect((list.items as Json[]).find((i) => i.id === a.id)!.usage).toEqual({ seats: 2, activeUsers30d: 1, storageBytes: 1500 })
    // aggregates only: nothing of the files or members leaks into the platform body
    const text = JSON.stringify(list) + JSON.stringify(await w.json(await w.req("GET", `/v1/platform/tenants/${a.id}`)))
    for (const bad of [ma[0].email, mb[0].email, ma[0].userId, "text/plain"]) expect(text).not.toContain(bad)
  })
})
