import { beforeEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeStaff, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { dataRequests } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { verifyChain } from "../audit"
import { changeSubscription, entitlementsFor } from "../entitlements"
import { recordPlatformAudit, verifyPlatformChain } from "../platform-audit"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const owner = await makeStaff(t.deps, "owner")
  const req = (method: string, path: string, cookie: string | undefined = owner.cookie, body?: unknown) => call(t.app, method, path, { cookie, body })
  const json = async (r: Response) => (await r.json()) as Json
  return { ...t, owner, req, json }
}
type W = Awaited<ReturnType<typeof world>>
const code = async (r: Response) => ((await r.clone().json()) as Json).code
const tenantAudit = (tenantId: string) => ownerTenantQuery(tenantId, "select seq, actor_id, action, entity, entity_id, before, after from audit_events where tenant_id = $1 order by seq", [tenantId])
const platAudit = () => ownerQuery("select seq, actor_id, action, entity, entity_id, target_tenant_id, before, after from platform_audit_events order by seq")
async function addDsr(w: W, tenantId: string, over: Partial<{ status: string; kind: string; dueAt: Date; subject: string }> = {}) {
  await withTenant(w.deps.db, tenantId, (tx) =>
    tx.insert(dataRequests).values({
      tenantId, subjectUserId: over.subject ?? "usr_secret_subject", kind: over.kind ?? "export", status: over.status ?? "pending", requestedBy: "usr_requester",
      reason: "private reason text", createdAt: new Date((over.dueAt ?? w.clock.now()).getTime() - 30 * DAY), dueAt: over.dueAt ?? new Date(w.clock.now().getTime() + 30 * DAY),
    }),
  )
}

test("tenant list and 360 contain no member names, emails or tenant business data", async () => {
  const w = await world()
  const tn = await makeTenant(w.deps, { name: "Coppers Cafe", subscription: { planId: "starter", seats: 10 } })
  const member = await makeMember(w.deps, tn.id, "owner")
  await addDsr(w, tn.id)
  const listRes = await w.req("GET", "/v1/platform/tenants")
  expect(listRes.status).toBe(200)
  const list = await listRes.json() as Json
  expect(list.items.find((i: Json) => i.id === tn.id)).toMatchObject({ name: "Coppers Cafe", slug: tn.slug, status: "active", planId: "starter", subscriptionStatus: "active" })
  const res = await w.req("GET", `/v1/platform/tenants/${tn.id}`)
  expect(res.status).toBe(200)
  const text = JSON.stringify(list) + (await res.clone().text())
  for (const bad of [member.email, "Platform Person", "usr_secret_subject", "private reason text", member.userId]) expect(text).not.toContain(bad)
  const body = await w.json(res)
  expect(body).toMatchObject({
    tenant: { id: tn.id, name: "Coppers Cafe", status: "active" },
    subscription: { planId: "starter", status: "active", seats: 10 },
    seatsUsed: 1, memberCount: 1, openDataRequests: 1, moduleOverrides: [],
  })
  expect(body.lastActivityDate === null || /^\d{4}-\d{2}-\d{2}$/.test(body.lastActivityDate)).toBe(true)
  // filters
  const byPlan = await w.json(await w.req("GET", "/v1/platform/tenants?plan=business"))
  expect(byPlan.items.find((i: Json) => i.id === tn.id)).toBeUndefined()
  const byQ = await w.json(await w.req("GET", "/v1/platform/tenants?q=coppers&status=active&plan=starter"))
  expect(byQ.items.map((i: Json) => i.id)).toEqual([tn.id])
  expect(byQ.total).toBe(1)
})

test("tenant list paginates with page", async () => {
  const w = await world()
  for (let i = 0; i < 3; i++) await makeTenant(w.deps, { name: `T${i}` })
  const p1 = await w.json(await w.req("GET", "/v1/platform/tenants?pageSize=2&page=1"))
  const p2 = await w.json(await w.req("GET", "/v1/platform/tenants?pageSize=2&page=2"))
  expect([p1.items.length, p2.items.length, p1.total]).toEqual([2, 1, 3])
  expect(new Set([...p1.items, ...p2.items].map((i: Json) => i.id)).size).toBe(3)
})

test("suspend makes every tenant route 404 for members and is audited in both chains; reactivate restores", async () => {
  const w = await world()
  const tn = await makeTenant(w.deps)
  const m = await makeMember(w.deps, tn.id, "owner")
  const { cookie } = await signIn(w.app, m.email, m.password)
  const me = () => call(w.app, "GET", "/v1/entitlements", { cookie, tenant: tn.slug })
  expect((await me()).status).toBe(200)
  expect(await code(await w.req("POST", `/v1/platform/tenants/${tn.id}/suspend`, w.owner.cookie, {}))).toBe("invalid_reason") // missing reason -> 422
  expect((await w.req("POST", `/v1/platform/tenants/${tn.id}/suspend`, w.owner.cookie, { reason: "" })).status).toBe(422)
  expect((await w.req("POST", `/v1/platform/tenants/${tn.id}/suspend`, w.owner.cookie, { reason: "x".repeat(501) })).status).toBe(422)
  const r = await w.req("POST", `/v1/platform/tenants/${tn.id}/suspend`, w.owner.cookie, { reason: "non-payment" })
  expect(r.status).toBe(200)
  expect((await me()).status).toBe(404)
  const [row] = await ownerQuery("select status from tenants where id = $1", [tn.id])
  expect(row.status).toBe("suspended")
  expect(await code(await w.req("POST", `/v1/platform/tenants/${tn.id}/suspend`, w.owner.cookie, { reason: "again" }))).toBe("already_suspended")
  expect((await w.req("POST", `/v1/platform/tenants/${tn.id}/suspend`, w.owner.cookie, { reason: "again" })).status).toBe(409)
  const ta = (await tenantAudit(tn.id)).filter((e) => e.action === "tenant.suspended")
  expect(ta).toHaveLength(1)
  expect(ta[0]).toMatchObject({ actor_id: `platform:${w.owner.userId}`, entity: "tenant", entity_id: tn.id })
  expect(ta[0].after).toMatchObject({ status: "suspended", reason: "non-payment" })
  const pa = (await platAudit()).filter((e) => e.action === "platform.tenant.suspended")
  expect(pa).toHaveLength(1)
  expect(pa[0]).toMatchObject({ actor_id: w.owner.userId, target_tenant_id: tn.id, entity_id: tn.id })
  expect(await verifyChain(w.deps.db, tn.id)).toMatchObject({ ok: true })
  expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
  // reactivate
  expect(await code(await w.req("POST", `/v1/platform/tenants/${tn.id}/reactivate`, w.owner.cookie, {}))).toBe("invalid_reason")
  expect((await w.req("POST", `/v1/platform/tenants/${tn.id}/reactivate`, w.owner.cookie, { reason: "paid" })).status).toBe(200)
  expect((await me()).status).toBe(200)
  expect(await code(await w.req("POST", `/v1/platform/tenants/${tn.id}/reactivate`, w.owner.cookie, { reason: "paid" }))).toBe("not_suspended")
  expect(await verifyChain(w.deps.db, tn.id)).toMatchObject({ ok: true })
  expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
})

test("module override changes entitlements within the TTL and is audited with before/after in both chains", async () => {
  const w = await world()
  const tn = await makeTenant(w.deps, { subscription: { planId: "starter", seats: 10 } })
  expect((await entitlementsFor(w.deps, tn.id)).allowed).not.toContain("M2") // warms the cache
  const r = await w.req("PUT", `/v1/platform/tenants/${tn.id}/modules`, w.owner.cookie, { overrides: [{ module: "M2", mode: "grant" }], reason: "pilot" })
  expect(r.status).toBe(200)
  expect((await entitlementsFor(w.deps, tn.id)).allowed).toContain("M2")
  const g = await w.json(await w.req("GET", `/v1/platform/tenants/${tn.id}`))
  expect(g.moduleOverrides).toMatchObject([{ module: "M2", mode: "grant", reason: "pilot" }])
  const r2 = await w.req("PUT", `/v1/platform/tenants/${tn.id}/modules`, w.owner.cookie, { overrides: [], reason: "pilot over" })
  expect(r2.status).toBe(200)
  expect((await entitlementsFor(w.deps, tn.id)).allowed).not.toContain("M2")
  const ta = (await tenantAudit(tn.id)).filter((e) => e.action === "tenant.modules_updated")
  expect(ta).toHaveLength(2)
  expect(ta[0]).toMatchObject({ actor_id: `platform:${w.owner.userId}`, before: { overrides: [] }, after: { overrides: [{ module: "M2", mode: "grant" }], reason: "pilot" } })
  expect(ta[1].before).toMatchObject({ overrides: [{ module: "M2", mode: "grant" }] })
  const pa = (await platAudit()).filter((e) => e.action === "platform.tenant.modules_updated")
  expect(pa).toHaveLength(2)
  expect(pa[0].target_tenant_id).toBe(tn.id)
  expect(await verifyChain(w.deps.db, tn.id)).toMatchObject({ ok: true })
  expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
  // validation
  expect((await w.req("PUT", `/v1/platform/tenants/${tn.id}/modules`, w.owner.cookie, { overrides: [{ module: "nope", mode: "grant" }], reason: "x" })).status).toBe(422)
  expect(await code(await w.req("PUT", `/v1/platform/tenants/${tn.id}/modules`, w.owner.cookie, { overrides: [{ module: "M0", mode: "revoke" }], reason: "x" }))).toBe("core_module")
  expect((await w.req("PUT", `/v1/platform/tenants/${tn.id}/modules`, w.owner.cookie, { overrides: [] })).status).toBe(422)
})

test("extend-trial: only trialing, days 1..30, max(now, trial_end) + days, audited in both chains", async () => {
  const w = await world()
  const now = w.clock.now()
  const tn = await makeTenant(w.deps, { subscription: { planId: "starter", status: "trialing", trialEndsAt: new Date(now.getTime() + 3 * DAY) } })
  const post = (days: unknown, reason: unknown = "sales call", cookie = w.owner.cookie) => w.req("POST", `/v1/platform/tenants/${tn.id}/extend-trial`, cookie, { days, reason })
  for (const d of [0, 31, 1.5, -1]) expect((await post(d)).status, `days ${d}`).toBe(422)
  expect((await w.req("POST", `/v1/platform/tenants/${tn.id}/extend-trial`, w.owner.cookie, { days: 5 })).status).toBe(422)
  const ok = await post(7)
  expect(ok.status).toBe(200)
  expect((await w.json(ok)).trialEndsAt).toBe(new Date(now.getTime() + 10 * DAY).toISOString())
  // an expired trial restarts from now
  await ownerTenantQuery(tn.id, "update subscriptions set trial_ends_at = $1 where tenant_id = $2", [new Date(now.getTime() - 20 * DAY), tn.id])
  const expired = await post(5)
  expect((await w.json(expired)).trialEndsAt).toBe(new Date(now.getTime() + 5 * DAY).toISOString())
  expect((await entitlementsFor(w.deps, tn.id)).trialEndsAt?.toISOString()).toBe(new Date(now.getTime() + 5 * DAY).toISOString())
  expect((await tenantAudit(tn.id)).filter((e) => e.action === "tenant.trial_extended")).toHaveLength(2)
  expect((await tenantAudit(tn.id)).find((e) => e.action === "tenant.trial_extended")).toMatchObject({ actor_id: `platform:${w.owner.userId}` })
  expect((await platAudit()).filter((e) => e.action === "platform.tenant.trial_extended")).toHaveLength(2)
  expect(await verifyChain(w.deps.db, tn.id)).toMatchObject({ ok: true })
  expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
  const paying = await makeTenant(w.deps)
  const r = await w.req("POST", `/v1/platform/tenants/${paying.id}/extend-trial`, w.owner.cookie, { days: 3, reason: "x" })
  expect([r.status, await code(r)]).toEqual([422, "not_trialing"])
})

test("metrics: MRR sums active+past_due per currency in minor units; trials excluded; churn counts cancellations in the last 30 days", async () => {
  const w = await world()
  await makeTenant(w.deps, { subscription: { planId: "starter", seats: 2 } }) // active 4900 x 2
  await makeTenant(w.deps, { subscription: { planId: "business", status: "past_due", seats: 1 } }) // 14900
  await makeTenant(w.deps, { subscription: { planId: "starter", status: "trialing", seats: 5 } }) // excluded
  const c = await makeTenant(w.deps, { subscription: { planId: "business", seats: 1 } })
  await changeSubscription(w.deps, c.id, "test", { status: "canceled" }) // churn now
  const old = await makeTenant(w.deps, { subscription: { planId: "business", seats: 1 } })
  await changeSubscription(w.deps, old.id, "test", { status: "canceled" })
  await ownerTenantQuery(old.id, "update audit_events set at = at - interval '40 days' where tenant_id = $1", [old.id]) // outside the window (chain not verified here)
  const res = await w.req("GET", "/v1/platform/metrics")
  expect(res.status).toBe(200)
  expect(await w.json(res)).toEqual({
    mrrMinor: { EUR: 4900 * 2 + 14900 }, arrMinor: { EUR: (4900 * 2 + 14900) * 12 },
    trials: 1, pastDue: 1, churnLast30Days: 1,
  })
})

test("platform data-requests list shows overdue first and never the subject identity", async () => {
  const w = await world()
  const a = await makeTenant(w.deps, { name: "Alpha" })
  const b = await makeTenant(w.deps, { name: "Beta" })
  const now = w.clock.now()
  await addDsr(w, a.id, { dueAt: new Date(now.getTime() + 5 * DAY), kind: "export" })
  await addDsr(w, b.id, { dueAt: new Date(now.getTime() - 2 * DAY), kind: "erase" }) // overdue
  await addDsr(w, a.id, { dueAt: new Date(now.getTime() - 9 * DAY), kind: "correct" }) // overdue, older
  await addDsr(w, b.id, { dueAt: new Date(now.getTime() - 30 * DAY), status: "completed" }) // not overdue (done)
  const res = await w.req("GET", "/v1/platform/data-requests")
  expect(res.status).toBe(200)
  const text = await res.clone().text()
  for (const bad of ["usr_secret_subject", "usr_requester", "private reason text", "subjectUserId"]) expect(text).not.toContain(bad)
  const body = await w.json(res)
  expect(body.items.map((i: Json) => [i.kind, i.overdue])).toEqual([["correct", true], ["erase", true], ["export", false], ["export", false]])
  expect(body.items[0]).toMatchObject({ tenantId: a.id, tenantName: "Alpha", status: "pending" })
  expect(Object.keys(body.items[0]).sort()).toEqual(["createdAt", "dueAt", "id", "kind", "overdue", "status", "tenantId", "tenantName"])
  expect(body.total).toBe(4)
  const p2 = await w.json(await w.req("GET", "/v1/platform/data-requests?page=2&pageSize=3"))
  expect(p2.items).toHaveLength(1)
})

test("unknown or invalid tenantId -> 404 tenant_not_found on every {tenantId} route", async () => {
  const w = await world()
  for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
    for (const [m, p, b] of [
      ["GET", ""], ["POST", "/suspend", { reason: "r" }], ["POST", "/reactivate", { reason: "r" }],
      ["POST", "/extend-trial", { days: 1, reason: "r" }], ["PUT", "/modules", { overrides: [], reason: "r" }],
    ] as [string, string, unknown?][]) {
      const r = await w.req(m, `/v1/platform/tenants/${id}${p}`, w.owner.cookie, b)
      expect([m, p, r.status, await code(r)]).toEqual([m, p, 404, "tenant_not_found"])
    }
  }
})

test("roles: viewer+ read, owner/support lifecycle, owner-only modules, billing/viewer/owner metrics; non-staff 404", async () => {
  const w = await world()
  const tn = await makeTenant(w.deps)
  const roles = {} as Record<string, { cookie?: string }>
  for (const r of ["support", "billing", "viewer"] as const) roles[r] = await makeStaff(w.deps, r)
  const st = async (role: string, m: string, p: string, b?: unknown) => (await w.req(m, p, roles[role].cookie, b)).status
  for (const r of ["support", "billing", "viewer"]) {
    expect(await st(r, "GET", "/v1/platform/tenants")).toBe(200)
    expect(await st(r, "GET", `/v1/platform/tenants/${tn.id}`)).toBe(200)
    expect(await st(r, "GET", "/v1/platform/data-requests")).toBe(200)
  }
  expect(await st("support", "GET", "/v1/platform/metrics")).toBe(403)
  expect(await st("billing", "GET", "/v1/platform/metrics")).toBe(200)
  expect(await st("viewer", "GET", "/v1/platform/metrics")).toBe(200)
  for (const r of ["billing", "viewer"]) {
    expect(await st(r, "POST", `/v1/platform/tenants/${tn.id}/suspend`, { reason: "r" })).toBe(403)
    expect(await st(r, "POST", `/v1/platform/tenants/${tn.id}/extend-trial`, { days: 1, reason: "r" })).toBe(403)
  }
  expect(await st("support", "PUT", `/v1/platform/tenants/${tn.id}/modules`, { overrides: [], reason: "r" })).toBe(403)
  expect(await code(await w.req("PUT", `/v1/platform/tenants/${tn.id}/modules`, roles.support.cookie, { overrides: [], reason: "r" }))).toBe("platform_forbidden")
  expect(await st("support", "POST", `/v1/platform/tenants/${tn.id}/suspend`, { reason: "r" })).toBe(200)
  expect(await st("support", "POST", `/v1/platform/tenants/${tn.id}/reactivate`, { reason: "r" })).toBe(200)
  // a tenant member (not staff) gets 404 everywhere
  const m = await makeMember(w.deps, tn.id, "owner")
  const { cookie } = await signIn(w.app, m.email, m.password)
  for (const [mm, p] of [["GET", "/v1/platform/tenants"], ["GET", "/v1/platform/metrics"], ["GET", "/v1/platform/data-requests"], ["GET", `/v1/platform/tenants/${tn.id}`]]) {
    expect((await w.req(mm, p, cookie)).status).toBe(404)
  }
})

test("recordPlatformAudit lowercases targetTenantId so an uppercase uuid still verifies ok", async () => {
  const w = await world()
  const tn = await makeTenant(w.deps)
  await w.deps.db.transaction((tx) =>
    recordPlatformAudit(tx, { action: "platform.test", entity: "tenant", entityId: tn.id, actorId: w.owner.userId, targetTenantId: tn.id.toUpperCase(), before: null, after: { a: 1 } }, w.clock.now()),
  )
  const [row] = await platAudit()
  expect(row.target_tenant_id).toBe(tn.id)
  expect(await verifyPlatformChain(w.deps.db)).toMatchObject({ ok: true })
})
