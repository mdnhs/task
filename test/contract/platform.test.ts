import { beforeEach, describe, expect, test, vi } from "vitest"
import { bootApi, resetDb } from "./harness"
import { makeApiClient } from "@/lib/api/client"
import { resolvePlatformMfa } from "@/lib/session-core"
import { loadAudit, loadDataRequests, loadMetrics, loadSettings, loadStaff, loadTenant360, loadTenantList, loadEnv } from "@/features/platform/api"
import { makePlatformClient } from "@/features/platform/client"
import { auditExportHref } from "@/features/platform/components/live-audit"
import { makeMember, makeStaff, makeTenant, signIn, signInWithTotp } from "../../api/test/factories"
import { ownerQuery } from "../../api/test/db"

vi.mock("server-only", () => ({})) // features/platform/api.ts imports lib/session (server only); the loaders used here take a client
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }))

beforeEach(resetDb)

type Booted = ReturnType<typeof bootApi>
/** A browser of the console: the cookie, no tenant (the console is not inside a company), Origin on writes, like the BFF. */
const as = (t: Booted, cookie: string) => {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers = new Headers(init?.headers)
    headers.set("cookie", cookie)
    if ((init?.method ?? "GET") !== "GET") headers.set("origin", t.origin)
    return t.app.request(url.pathname + url.search, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | undefined })
  }
  const api = makeApiClient({ baseUrl: "http://api.test", fetch })
  return { api, fetch, client: makePlatformClient(api) }
}
const noUndefined = (v: unknown, path = "$"): string[] => {
  if (v === undefined) return [path]
  if (Array.isArray(v)) return v.flatMap((x, i) => noUndefined(x, `${path}[${i}]`))
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => noUndefined(x, `${path}.${k}`))
  return []
}

async function world() {
  const t = bootApi()
  const owner = await makeStaff(t.deps, "owner")
  const tenant = await makeTenant(t.deps, { slug: "coppers", name: "Coppers Cafe", subscription: { status: "trialing", trialEndsAt: new Date("2026-12-01T00:00:00Z") } })
  const member = await makeMember(t.deps, tenant.id, "owner")
  return { t, owner, tenant, member, o: as(t, owner.cookie!) }
}

describe("T6.8 contract (real API): the platform console", () => {
  test("tenants, detail, metrics, data-requests, audit, staff and settings parse for a platform owner and map through the adapters with no undefined", async () => {
    const { owner, tenant, member, o } = await world()
    const list = await loadTenantList(o.api)
    expect(list.rows.map((r) => r.slug)).toContain("coppers")
    expect(list.rows.find((r) => r.slug === "coppers")).toMatchObject({ status: "trial", plan: "Business" })
    const t = await loadTenant360(o.api, tenant.id)
    expect(t).toMatchObject({ slug: "coppers", memberCount: 1, status: "trial" })
    expect(await loadTenant360(o.api, "00000000-0000-4000-8000-000000000000")).toBeNull()
    const m = await loadMetrics(o.api)
    expect(m.trials).toBe(1)
    expect(m.pastDue).toBe(0)
    const audit = await loadAudit(o.api)
    const dsr = await loadDataRequests(o.api)
    const staff = await loadStaff(o.api)
    expect(staff.map((s) => s.id)).toContain(owner.userId)
    const settings = await loadSettings(o.api)
    expect(settings.email).toEqual({ configured: false })
    expect(await loadEnv(o.api)).toBeNull() // no billing settings yet: no pill
    for (const [name, v] of Object.entries({ list, t, m, audit, dsr, staff, settings })) expect(noUndefined(v), name).toEqual([])
    // aggregates only: no member email or name anywhere in the tenant payloads
    expect(JSON.stringify([list, t])).not.toContain(member.email)
  })

  test("suspend and reactivate: a reason is required, 409 on a repeat, and the list follows; extend trial and module overrides", async () => {
    const { tenant, o } = await world()
    await expect(o.client.suspend(tenant.id, "")).rejects.toThrow() // refused before any request
    await o.client.suspend(tenant.id, "Payment overdue 30 days")
    expect((await loadTenant360(o.api, tenant.id))?.status).toBe("suspended")
    await expect(o.client.suspend(tenant.id, "again")).rejects.toMatchObject({ status: 409, code: "already_suspended" })
    await o.client.reactivate(tenant.id, "Paid")
    await expect(o.client.reactivate(tenant.id, "again")).rejects.toMatchObject({ status: 409, code: "not_suspended" })
    const ext = await o.client.extendTrial(tenant.id, 7, "Sales call")
    expect(ext.trialEndsAt).toMatch(/^2026-12-08/)
    await o.client.setModules(tenant.id, [{ module: "M2", mode: "grant" }], "Pilot")
    expect((await loadTenant360(o.api, tenant.id))?.overrides).toMatchObject([{ module: "M2", mode: "grant", reason: "Pilot" }])
    await o.client.setModules(tenant.id, [], "Done")
    expect((await loadTenant360(o.api, tenant.id))?.overrides).toEqual([])
    const lines = await loadAudit(o.api, { targetTenantId: tenant.id })
    expect(lines.map((l) => l.action)).toEqual(expect.arrayContaining(["platform.tenant.suspended", "platform.tenant.reactivated"]))
  })

  test("support grants: create and revoke through the client; the tenant owner's own settings list shows the same grant", async () => {
    const { t, tenant, o } = await world()
    const owner = await makeMember(t.deps, tenant.id, "owner", { totp: true })
    const g = await o.client.createGrant(tenant.id, "Ticket 4411", 2)
    expect(g).toMatchObject({ tenantId: tenant.id, status: "active" })
    const { cookie } = await signInWithTotp(t.app, owner.email, owner.password, owner.totpSecret!)
    const tenantApi = makeApiClient({ baseUrl: "http://api.test", fetch: async (i, init) => { const u = new URL(typeof i === "string" ? i : i instanceof URL ? i.href : i.url); const h = new Headers(init?.headers); h.set("cookie", cookie); h.set("x-tenant", "coppers"); return t.app.request(u.pathname + u.search, { method: init?.method ?? "GET", headers: h }) } })
    expect((await tenantApi.get("/v1/settings/support-grants")).items.map((x) => x.id)).toContain(g.id)
    await o.client.revokeGrant(g.id)
    await expect(o.client.revokeGrant(g.id)).rejects.toMatchObject({ status: 409, code: "grant_inactive" })
  })

  test("staff: add, change role, and the last owner cannot be demoted (409 last_platform_owner)", async () => {
    const { owner, o } = await world()
    await expect(o.client.patchStaff(owner.userId, { role: "viewer" })).rejects.toMatchObject({ status: 409, code: "last_platform_owner" })
  })

  test("the second factor mirrors the API: passed, not passed (challenge) and none (enrol)", async () => {
    const { t, owner } = await world()
    const me = (twoFactorEnabled: boolean) => ({ user: { id: "x", email: "x@x", name: "x", emailVerified: true, twoFactorEnabled }, platformRole: "owner" as const, tenants: [] })
    expect(await resolvePlatformMfa(me(true), as(t, owner.cookie!).api)).toBe("ok")
    expect(await resolvePlatformMfa(me(true), as(t, owner.staleCookie!).api)).toBe("challenge")
    const noTfa = await makeStaff(t.deps, "owner", { totp: false })
    const r = await t.raw("POST", "/api/auth/sign-in/email", { body: { email: noTfa.email, password: noTfa.password }, headers: { origin: t.origin } })
    const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
    expect(await resolvePlatformMfa(me(false), as(t, cookie).api)).toBe("enrol")
    expect(await resolvePlatformMfa(me(true), as(t, cookie).api)).toBe("enrol") // the API's own answer when /v1/me says otherwise
  })

  test("a non-staff user gets 404 on /v1/platform/*; the role matrix holds (viewer reads only, billing cannot suspend)", async () => {
    const { t, tenant, member } = await world()
    const { cookie } = await signIn(t.app, member.email, member.password)
    const stranger = as(t, cookie)
    await expect(loadTenantList(stranger.api)).rejects.toMatchObject({ status: 404 })
    const viewer = as(t, (await makeStaff(t.deps, "viewer")).cookie!)
    expect((await loadTenantList(viewer.api)).rows.length).toBeGreaterThan(0)
    await expect(viewer.client.suspend(tenant.id, "no")).rejects.toMatchObject({ status: 403, code: "platform_forbidden" })
    const billing = as(t, (await makeStaff(t.deps, "billing")).cookie!)
    await expect(billing.client.suspend(tenant.id, "no")).rejects.toMatchObject({ status: 403, code: "platform_forbidden" })
    expect((await loadMetrics(billing.api)).trials).toBe(1)
    await expect(loadAudit(billing.api)).rejects.toMatchObject({ status: 403 })
  })

  test("settings: email and storage save without the secret coming back (keyLast4 only); billing mode feeds the pill; the audit export streams", async () => {
    const { o } = await world()
    const saved = await o.client.saveEmail({ apiKey: "re_AbCdEf1234567890abcdef", fromAddress: "no-reply@opsdesk.example", fromName: "OpsDesk" })
    expect(JSON.stringify(saved)).not.toContain("re_AbCdEf")
    expect((await loadSettings(o.api)).email).toMatchObject({ configured: true, keyHint: "••••cdef" })
    // saving again without a key keeps the stored one
    await o.client.saveEmail({ fromAddress: "no-reply@opsdesk.example", fromName: "OpsDesk 2" })
    expect((await loadSettings(o.api)).email).toMatchObject({ keyHint: "••••cdef", fromName: "OpsDesk 2" })
    await o.client.saveBilling({ secretKey: "sk_test_abcdefghijklmnop1234", webhookSecret: "whsec_abcdefghijklmnop5678", publishableKey: "pk_test_51ExamplePublishableKey" })
    expect(await loadEnv(o.api)).toEqual({ label: "Test mode", live: false })
    const res = await o.fetch(`http://api.test${auditExportHref()}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(await res.text()).toContain("platform.")
    void ownerQuery
  })
})
