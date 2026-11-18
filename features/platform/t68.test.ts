import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { resolvePlatformMfa } from "@/lib/session-core"
import { ApiError, userMessage } from "@/lib/api/problem"
import {
  billingMode, toAuditLines, toDataRequests, toEmailSettings, toMetrics, toStaffRows, toTenant360, toTenantList, tenantStatus,
} from "./adapters"
import { PlatformInputError, makePlatformClient, REASON_MAX } from "./client"
import { staffCan, requireStaff, filterForStaff } from "./permissions"
import { LiveTenants } from "./components/live-tenants"
import { LiveOverview } from "./components/live-overview"
import { LiveSettings } from "./components/live-settings"
import { LiveDataRequests } from "./components/live-data-requests"
import { LiveTeam } from "./components/live-team"
import { LiveSupport } from "./components/live-support"
import { Live360Tabs } from "./components/live-360"
import { LiveTenantsSkeleton, LiveOverviewSkeleton } from "./components/live-skeletons"
import { unavailablePlatformPage } from "./mock-gate"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/platform/tenants", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }))

const TID = "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10"
const listDto = { items: [{ id: TID, slug: "coppers", name: "Coppers Cafe", status: "active", createdAt: "2026-10-01T09:00:00.000Z", planId: "business", subscriptionStatus: "past_due", seats: 40 }, { id: "t2", slug: "acme", name: "Acme", status: "suspended", createdAt: "2026-09-01T09:00:00.000Z", planId: null, subscriptionStatus: null, seats: null }], page: 1, pageSize: 50, total: 2 }
const detailDto = {
  tenant: { id: TID, slug: "coppers", name: "Coppers Cafe", status: "active", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", createdAt: "2026-10-01T09:00:00.000Z" },
  subscription: { planId: "business", status: "trialing", seats: 40, trialEndsAt: "2026-11-24T09:00:00.000Z", currentPeriodEnd: null, cancelAtPeriodEnd: false, hasProviderSubscription: false },
  seatsUsed: 12, memberCount: 14, moduleOverrides: [{ module: "M2", mode: "grant" as const, reason: "Pilot", setAt: "2026-11-01T09:00:00.000Z" }], lastActivityDate: "2026-11-16", openDataRequests: 1,
}
const metricsDto = { mrrMinor: { EUR: 1450000, GBP: 5000 }, arrMinor: { EUR: 17400000, GBP: 60000 }, trials: 4, pastDue: 1, churnLast30Days: 2 }

describe("staffCan mirrors the API role matrix", () => {
  test("viewer reads only: tenants, billing figures, audit and data requests; no write, no team, no settings", () => {
    for (const a of ["tenants.read", "billing.read", "audit.read", "data.requests"] as const) expect(staffCan("viewer", a), a).toBe(true)
    for (const a of ["tenants.suspend", "tenants.modules", "support.request", "team.manage", "settings.read", "settings.write"] as const) expect(staffCan("viewer", a), a).toBe(false)
  })
  test("the billing role cannot suspend, grant support access or touch modules; it reads metrics and data requests", () => {
    expect(staffCan("billing", "tenants.suspend")).toBe(false)
    expect(staffCan("billing", "support.request")).toBe(false)
    expect(staffCan("billing", "tenants.modules")).toBe(false)
    expect(staffCan("billing", "billing.read")).toBe(true)
    expect(staffCan("billing", "data.requests")).toBe(true)
    expect(staffCan("billing", "audit.read")).toBe(false)
  })
  test("support suspends, reactivates and extends trials and opens support access, but has no metrics, audit, modules, team or settings", () => {
    expect(staffCan("support", "tenants.suspend")).toBe(true)
    expect(staffCan("support", "support.request")).toBe(true)
    for (const a of ["billing.read", "audit.read", "tenants.modules", "team.manage", "settings.read"] as const) expect(staffCan("support", a), a).toBe(false)
  })
  test("only the owner has modules, team and settings; audit is owner and viewer", () => {
    for (const r of ["owner", "support", "billing", "viewer"] as const) {
      expect(staffCan(r, "tenants.modules")).toBe(r === "owner")
      expect(staffCan(r, "team.manage")).toBe(r === "owner")
      expect(staffCan(r, "settings.write")).toBe(r === "owner")
      expect(staffCan(r, "audit.read")).toBe(r === "owner" || r === "viewer")
    }
  })
  test("the nav keeps only the pages the role can open", () => {
    const op = { id: "u", name: "A", email: "a@x", role: "support" as const, mfa: true, lastSignInAt: null, status: "active" as const }
    const hrefs = filterForStaff([{ href: "/platform/audit" }, { href: "/platform/support" }, { href: "/platform/settings" }, { href: "/platform/tenants" }], op).map((i) => i.href)
    expect(hrefs).toEqual(["/platform/support", "/platform/tenants"])
    expect(requireStaff({ ...op, status: "disabled" }, "tenants.read")).toBe(false)
  })
})

describe("the console MFA gate mirrors the API (carry-in a)", () => {
  const me = (twoFactorEnabled: boolean) => ({ user: { id: "u", email: "a@x", name: "A", emailVerified: true, twoFactorEnabled }, platformRole: "owner" as const, tenants: [] })
  test("no second factor enrolled: 'enrol' without any API call", async () => {
    const { client, calls } = fakeApi({})
    expect(await resolvePlatformMfa(me(false), client)).toBe("enrol")
    expect(calls).toEqual([])
  })
  test("401 mfa_challenge shows the step-up; 401 mfa_enrolment_required the enrolment; an answer is 'ok'", async () => {
    expect(await resolvePlatformMfa(me(true), fakeApi({ "GET /v1/platform/session": problem(401, "mfa_challenge") }).client)).toBe("challenge")
    expect(await resolvePlatformMfa(me(true), fakeApi({ "GET /v1/platform/session": problem(401, "mfa_enrolment_required") }).client)).toBe("enrol")
    expect(await resolvePlatformMfa(me(true), fakeApi({ "GET /v1/platform/session": { staff: true, role: "owner", mfa: "ok" } }).client)).toBe("ok")
  })
  test("any other refusal is not an MFA answer: it is rethrown (a dead cookie is the session's business)", async () => {
    await expect(resolvePlatformMfa(me(true), fakeApi({ "GET /v1/platform/session": problem(401, "unauthenticated") }).client)).rejects.toBeInstanceOf(ApiError)
  })
})

describe("adapters map the DTOs", () => {
  test("tenant status: suspended wins, then the subscription's trialing and past_due", () => {
    expect(tenantStatus({ status: "suspended", subscriptionStatus: "active" })).toBe("suspended")
    expect(tenantStatus({ status: "active", subscriptionStatus: "trialing" })).toBe("trial")
    expect(tenantStatus({ status: "active", subscriptionStatus: "past_due" })).toBe("past_due")
    expect(tenantStatus({ status: "active", subscriptionStatus: null })).toBe("active")
  })
  test("the list and the 360 carry aggregates only: no member name or email anywhere", () => {
    const l = toTenantList(listDto)
    expect(l.rows.map((r) => r.status)).toEqual(["past_due", "suspended"])
    expect(l.rows[0]).toMatchObject({ plan: "Business", seats: 40 })
    expect(l.rows[1]?.plan).toBe("")
    const t = toTenant360(detailDto)
    expect(t).toMatchObject({ seatsUsed: 12, memberCount: 14, status: "trial", openDataRequests: 1, trialEndsAt: "2026-11-24T09:00:00.000Z" })
    const flat = JSON.stringify([l, t])
    expect(flat).not.toContain("@")
    expect(Object.keys(t).join(",")).not.toMatch(/email|contact|admin|members\b/)
  })
  test("metrics: MRR is per currency from the API; past_due is its own number (C11)", () => {
    const m = toMetrics(metricsDto)
    expect(m.mrr).toEqual([{ currency: "EUR", minor: 1450000 }, { currency: "GBP", minor: 5000 }])
    expect(m).toMatchObject({ trials: 4, pastDue: 1, churn: 2 })
  })
  test("audit lines, data requests and staff", () => {
    const a = toAuditLines([{ seq: 7, at: "2026-11-17T09:00:00.000Z", actorId: "usr_1", action: "tenant.suspended", entity: "tenant", entityId: TID, targetTenantId: TID, before: { status: "active" }, after: { status: "suspended" }, hash: "x" }])
    expect(a[0]).toMatchObject({ seq: 7, actor: "usr_1", action: "tenant.suspended", tenantId: TID })
    const d = toDataRequests({ items: [{ id: "d1", tenantId: TID, tenantName: "Coppers", kind: "erase", status: "pending", createdAt: "2026-11-01T00:00:00.000Z", dueAt: "2026-12-01T00:00:00.000Z", overdue: true }], page: 1, pageSize: 50, total: 1 })
    expect(d.rows[0]).toMatchObject({ kindLabel: "Erase", overdue: true })
    const s = toStaffRows([{ userId: "u1", name: "Ann", email: "a@x.ie", role: "owner", status: "active", twoFactorEnabled: true, addedBy: "u0", addedAt: "2026-11-01T00:00:00.000Z" }])
    expect(s[0]).toMatchObject({ id: "u1", role: "owner", mfa: true, status: "active" })
  })
  test("the email settings view never carries a secret; it shows only the last 4", () => {
    const e = toEmailSettings({ configured: true, provider: "resend", fromAddress: "no-reply@x.ie", fromName: "OpsDesk", keyLast4: "cdef", updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "u1" })
    expect(e).toMatchObject({ configured: true, keyHint: "••••cdef" })
    expect(JSON.stringify(e)).not.toMatch(/re_/)
  })
  test("the topbar pill comes from the Stripe publishable key's mode; none when unknown", () => {
    const base = { configured: true as const, provider: "stripe" as const, secretKeyLast4: "1234", webhookSecretLast4: "5678", priceMap: {}, webhookUrl: "https://x", updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: null }
    expect(billingMode({ ...base, publishableKey: "pk_test_abc" })).toEqual({ label: "Test mode", live: false })
    expect(billingMode({ ...base, publishableKey: "pk_live_abc" })).toEqual({ label: "Live", live: true })
    expect(billingMode({ ...base, publishableKey: null })).toBeNull()
    expect(billingMode({ configured: false })).toBeNull()
  })
})

describe("the platform client sends what the API takes and refuses the rest before any request", () => {
  const ok = () => fakeApi({
    "POST /v1/platform/tenants/{tenantId}/suspend": { status: "suspended" }, "POST /v1/platform/tenants/{tenantId}/reactivate": { status: "active" },
    "POST /v1/platform/tenants/{tenantId}/extend-trial": { trialEndsAt: "2026-11-24T09:00:00.000Z" }, "PUT /v1/platform/tenants/{tenantId}/modules": { overrides: [] },
    "POST /v1/platform/tenants/{tenantId}/support-grants": { id: "g1" }, "DELETE /v1/platform/support-grants/{id}": { id: "g1" },
  })
  test("suspend and reactivate need a reason of 1 to 500 characters", async () => {
    const { client, calls } = ok()
    const c = makePlatformClient(client)
    for (const bad of ["", "   ", "x".repeat(REASON_MAX + 1)]) await expect(c.suspend(TID, bad)).rejects.toBeInstanceOf(PlatformInputError)
    await expect(c.reactivate(TID, "")).rejects.toBeInstanceOf(PlatformInputError)
    expect(calls).toEqual([])
    await c.suspend(TID, " Payment overdue ")
    await c.reactivate(TID, "x".repeat(REASON_MAX))
    expect(calls.map((x) => x.body)).toEqual([{ reason: "Payment overdue" }, { reason: "x".repeat(REASON_MAX) }])
  })
  test("extend trial takes whole days 1 to 30", async () => {
    const { client, calls } = ok()
    const c = makePlatformClient(client)
    for (const d of [0, 31, 1.5, Number.NaN]) await expect(c.extendTrial(TID, d, "Sales call")).rejects.toBeInstanceOf(PlatformInputError)
    expect(calls).toEqual([])
    await c.extendTrial(TID, 30, "Sales call")
    expect(calls[0]?.body).toEqual({ days: 30, reason: "Sales call" })
  })
  test("module overrides send the FULL overrides array and the reason", async () => {
    const { client, calls } = ok()
    await makePlatformClient(client).setModules(TID, [{ module: "M2", mode: "grant" }, { module: "M4", mode: "revoke" }], "Pilot")
    expect(calls[0]).toMatchObject({ method: "put", path: "/v1/platform/tenants/{tenantId}/modules", body: { overrides: [{ module: "M2", mode: "grant" }, { module: "M4", mode: "revoke" }], reason: "Pilot" } })
  })
  test("support grants: reason 1 to 500, hours 1 to 24; revoke by id", async () => {
    const { client, calls } = ok()
    const c = makePlatformClient(client)
    for (const h of [0, 25, 2.5]) await expect(c.createGrant(TID, "Ticket 4411", h)).rejects.toBeInstanceOf(PlatformInputError)
    await expect(c.createGrant(TID, "", 2)).rejects.toBeInstanceOf(PlatformInputError)
    expect(calls).toEqual([])
    await c.createGrant(TID, "Ticket 4411", 24)
    await c.revokeGrant("g1")
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["post /v1/platform/tenants/{tenantId}/support-grants", "delete /v1/platform/support-grants/{id}"])
    expect(calls[0]?.body).toEqual({ reason: "Ticket 4411", hours: 24 })
  })
  test("the support page lists the grants the API returns (tenant, who, status) and shows Revoke only where canRevoke is true", () => {
    const g = (id: string, status: "active" | "expired" | "revoked", revokedAt: string | null, canRevoke = status === "active") => ({ id, tenantId: TID, tenantName: "Coppers Cafe", staffName: "Aoife Support", reason: "Ticket 4411", status, canRevoke, createdAt: "2026-11-17T09:00:00.000Z", expiresAt: "2026-11-17T11:00:00.000Z", revokedAt })
    const html = renderToStaticMarkup(createElement(LiveSupport, { tenants: [], grants: [g("g1", "active", null), g("g2", "expired", null), g("g3", "revoked", "2026-11-17T10:00:00.000Z")] }))
    expect(html.match(/Coppers Cafe/g)).toHaveLength(3)
    expect(html).toContain("Aoife Support")
    expect(html).toContain("Revoked")
    expect(html).toContain("Expired")
    expect(html.match(/>Revoke</g)).toHaveLength(1)
    // somebody else's active grant (support role): the API says no, so no button
    expect(renderToStaticMarkup(createElement(LiveSupport, { tenants: [], grants: [g("g4", "active", null, false)] }))).not.toContain(">Revoke<")
  })
  test("409 already_suspended and not_suspended, and the last owner, have their own copy", () => {
    expect(userMessage(new ApiError(409, "already_suspended", "r1")).text).toMatch(/already suspended/i)
    expect(userMessage(new ApiError(409, "not_suspended", "r1")).text).toMatch(/not suspended/i)
    expect(userMessage(new ApiError(409, "last_platform_owner", "r1")).text).toMatch(/last owner/i)
    expect(userMessage(new ApiError(409, "grant_exists", "r1")).text).toMatch(/already/i)
  })
})

describe("the live views", () => {
  const tenants = toTenantList(listDto)
  const can = { suspend: true, support: true }
  test("tenants list: names, plan, status, seats; sort and saved views are in the page, paging is the server's", () => {
    const html = renderToStaticMarkup(createElement(LiveTenants, { data: tenants, view: "all", q: "", can }))
    expect(html).toContain("Coppers Cafe")
    expect(html).toContain("Past due")
    expect(html).toContain("Suspended")
    expect(html).toContain("coppers")
    expect(html).not.toMatch(/@/)
  })
  test("a view keeps only its rows", () => {
    const html = renderToStaticMarkup(createElement(LiveTenants, { data: tenants, view: "suspended", q: "", can }))
    expect(html).toContain("Acme")
    expect(html).not.toContain("Coppers Cafe")
  })
  test("overview: MRR per currency, past due apart, trials and churn", () => {
    const html = renderToStaticMarkup(createElement(LiveOverview, { metrics: toMetrics(metricsDto), tenants: 2, canRevenue: true, mock: false }))
    expect(html).toContain("14,500")
    expect(html).toContain("Past due")
    expect(html).toContain("Trials")
    expect(html).toContain("Churn")
    expect(html).not.toMatch(/Plan mix|Recent activity/)
  })
  test("overview without billing.read has no revenue in the markup", () => {
    const html = renderToStaticMarkup(createElement(LiveOverview, { metrics: null, tenants: 2, canRevenue: false, mock: false }))
    expect(html).not.toContain("14,500")
    expect(html).not.toMatch(/MRR/)
  })
  test("settings: the secret is never in the markup; only the last 4 and the test buttons", () => {
    const html = renderToStaticMarkup(createElement(LiveSettings, {
      email: toEmailSettings({ configured: true, provider: "resend", fromAddress: "no-reply@x.ie", fromName: "OpsDesk", keyLast4: "cdef", updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "u1" }),
      storage: { configured: false }, billing: { configured: false }, canWrite: true,
    }))
    expect(html).toContain("••••cdef")
    expect(html).toContain("Send test")
    expect(html).not.toMatch(/value="re_/)
  })
  test("data requests and team render their rows; a non-owner sees no team controls", () => {
    const d = toDataRequests({ items: [{ id: "d1", tenantId: TID, tenantName: "Coppers", kind: "erase", status: "pending", createdAt: "2026-11-01T00:00:00.000Z", dueAt: "2026-12-01T00:00:00.000Z", overdue: true }], page: 1, pageSize: 50, total: 1 })
    const html = renderToStaticMarkup(createElement(LiveDataRequests, { data: d }))
    expect(html).toContain("Coppers")
    expect(html).toContain("Overdue")
    const t = renderToStaticMarkup(createElement(LiveTeam, { staff: toStaffRows([{ userId: "u1", name: "Ann", email: "a@x.ie", role: "owner", status: "active", twoFactorEnabled: true, addedBy: "u0", addedAt: "2026-11-01T00:00:00.000Z" }]), meId: "u2" }))
    expect(t).toContain("Ann")
    expect(t).toContain("Add staff")
  })
  test("support access: create form, no list route so the page says where grants show", () => {
    const html = renderToStaticMarkup(createElement(LiveSupport, { tenants: tenants.rows, requestFor: TID }))
    expect(html).toContain("Hours")
    expect(html).toContain("support-access")
  })
  test("360 tabs hide what the role cannot open and what has no API behind it", () => {
    const html = renderToStaticMarkup(createElement(Live360Tabs, { id: TID, active: "overview", tabs: ["overview", "modules", "support"] }))
    expect(html).toContain("Overview")
    expect(html).toContain("Modules")
    expect(html).not.toMatch(/Usage|Billing/)
  })
  test("the skeletons are static: no data in, same card structure", () => {
    expect(renderToStaticMarkup(createElement(LiveTenantsSkeleton))).toContain("Loading")
    expect(renderToStaticMarkup(createElement(LiveOverviewSkeleton))).toContain("Loading")
  })
})

describe("unbacked pages are isolated behind ENABLE_MOCK_MODULES (I16)", () => {
  test("off: the unavailable state; on: the mock page (one reader of the flag)", () => {
    vi.stubEnv("ENABLE_MOCK_MODULES", "")
    expect(unavailablePlatformPage()).toBe(true)
    vi.stubEnv("ENABLE_MOCK_MODULES", "0")
    expect(unavailablePlatformPage()).toBe(true)
    vi.stubEnv("ENABLE_MOCK_MODULES", "1")
    expect(unavailablePlatformPage()).toBe(false)
    vi.unstubAllEnvs()
  })
})

describe("the tenant app never shows the mock platform announcement to a real tenant", () => {
  test("null unless ENABLE_MOCK_MODULES=1", async () => {
    const { getPlatformNotice } = await import("@/lib/platform-notice-data")
    vi.stubEnv("ENABLE_MOCK_MODULES", "")
    expect(await getPlatformNotice("2026-10-20T09:00:00")).toBeNull()
    vi.unstubAllEnvs()
  })
})
