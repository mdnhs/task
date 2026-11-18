import { bootApi, resetDb } from "./harness"
import { beforeEach, describe, expect, test } from "vitest"
import { makeApiClient } from "@/lib/api/client"
import { makeAuthClient } from "@/lib/auth-client"
import { ApiError } from "@/lib/api/problem"
import { toPerson } from "@/lib/people"
import PLANS from "@/public/data/billing/plans.json"
import { toAuditEvent } from "@/features/audit/adapters"
import { toPrefs, prefsBody } from "@/features/account/adapters"
import { makeAccountClient } from "@/features/account/client"
import { hitsToItems } from "@/features/search/adapters"
import { toDataRequest, toDepartments, toDevice, toGrant, toIntegration, toInvites, toOrganisation, toRoles, toUsers } from "@/features/settings/adapters"
import { makeSettingsClient } from "@/features/settings/client"
import { RoleDto } from "../../api/src/modules/rbac/routes"
import { ownerQuery } from "../../api/test/db"
import { makeMember, makeTenant, signIn } from "../../api/test/factories"

beforeEach(resetDb)

type Booted = ReturnType<typeof bootApi>
async function browser(t: Booted, who: { email: string; password: string }, slug: string) {
  const { cookie } = await signIn(t.app, who.email, who.password)
  const statuses: number[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers = new Headers(init?.headers)
    headers.set("cookie", cookie)
    headers.set("x-tenant", slug)
    if ((init?.method ?? "GET") !== "GET") headers.set("origin", t.origin)
    const res = await t.app.request(url.pathname + url.search, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | undefined })
    statuses.push(res.status)
    return res
  }
  return { api: makeApiClient({ baseUrl: "http://api.test", fetch }), fetch, statuses, cookie }
}
const nav = () => ({ go: () => undefined })

async function world() {
  const t = bootApi()
  const tenant = await makeTenant(t.deps, { slug: "coppers", name: "Coppers" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const staff = await makeMember(t.deps, tenant.id, "employee")
  return { t, tenant, owner, staff }
}

describe("T6.5 contract (real API): settings responses parse and map through the adapters", () => {
  test("organisation, branding, holidays, teams, people, roles, members, invites, devices, policies, mfa policy, integrations, data requests, sessions, notification preferences, audit and search", async () => {
    const { t, tenant, owner, staff } = await world()
    const o = await browser(t, owner, "coppers")
    const c = makeSettingsClient(o.api, nav())

    // organisation + branding (writes: only what the API accepts)
    const org = toOrganisation(await o.api.get("/v1/settings/organisation"))
    expect(org.slug).toBe("coppers")
    await c.saveOrganisation({ name: "Coppers Ltd" })
    expect(toOrganisation(await o.api.get("/v1/settings/organisation")).name).toBe("Coppers Ltd")
    await c.saveBranding({ color: "#1a8a3a", logoFileId: null })
    expect((await o.api.get("/v1/settings/branding")).primaryColor).toBe("#1a8a3a")
    expect(await o.api.get("/v1/settings/holidays")).toMatchObject({ holidays: expect.any(Array) })

    // departments (teams), people, roles, members
    await c.createDepartment("Security")
    const teams = await o.api.get("/v1/teams", { query: { kind: "department" } })
    const deps = toDepartments(teams)
    expect(deps).toEqual([{ id: expect.any(String), name: "Security", members: 0 }])
    await c.renameDepartment(deps[0]!.id, "Guarding")
    const roleDtos = await o.api.get("/v1/roles")
    roleDtos.forEach((r) => RoleDto.parse(r))
    const roles = toRoles(roleDtos)
    expect(roles.map((r) => r.id)).toContain("employee")
    const people = await o.api.get("/v1/people")
    const users = toUsers(people, () => "")
    expect(users.length).toBe(2)
    for (const u of users) expect(Object.values(u).every((v) => v !== undefined)).toBe(true)
    await c.changeRole(staff.userId, "manager", roles)
    expect((await o.api.get("/v1/people")).find((p) => p.userId === staff.userId)?.roleKey).toBe("manager")
    expect(roles.find((r) => r.id === "manager")!.locked).toBe(true) // built-in
    const copy = await c.cloneRole(roles.find((r) => r.id === "manager")!.uuid, "Night lead")
    await c.setRoleAccess(copy.id, "tasks", "write")
    const locked = await c.setRoleAccess(roles.find((r) => r.id === "manager")!.uuid, "tasks", "write").catch((e: unknown) => e)
    expect((locked as ApiError).code).toBe("template_locked")

    // invites: create, list, resend (after the cooldown the API enforces), revoke
    await c.invite("new@example.com", "employee", roles)
    const invites = toInvites(await o.api.get("/v1/invites"), "Europe/Dublin")
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({ email: "new@example.com", role: "employee" })
    const early = await c.resendInvite(invites[0]!.id).catch((e: unknown) => e)
    expect(early).toBeInstanceOf(ApiError)
    expect((early as ApiError).code).toBe("resend_too_soon")
    await c.revokeInvite(invites[0]!.id)
    expect(await o.api.get("/v1/invites")).toEqual({ items: [] })

    // devices, policies, mfa policy
    const dev = toDevice(await c.registerDevice({ userId: staff.userId, type: "pc", owner: "company", label: "Front desk PC", trusted: true }), "Europe/Dublin")
    expect(dev).toMatchObject({ label: "Front desk PC", trusted: true, lastSeen: null })
    await c.setTrusted(dev.id, false)
    const code = await c.enrolmentCode(dev.id)
    expect(code.code).toMatch(/^[A-Z2-9]{10}$/)
    await c.setDevicePolicy("drive", "trusted-company-pc")
    expect(await o.api.get("/v1/device-policies")).toContainEqual({ feature: "drive", allow: "trusted-company-pc" })
    await c.setMfaPolicy({ mode: "roles", roles: ["admin"] })
    expect(await o.api.get("/v1/settings/mfa-policy")).toEqual({ mode: "roles", roles: ["admin"] })

    // the allocated user enters the code on their own browser: bound, then Drive is on for that device
    const s = await browser(t, staff, "coppers")
    const own = await s.api.get("/v1/devices")
    expect(own.map((d) => d.id)).toEqual([dev.id])
    await c.setTrusted(dev.id, true)
    const bound = await makeAccountClient(s.api).bindDevice(dev.id, code.code)
    expect(bound.id).toBe(dev.id)
    const wrong = await makeAccountClient(s.api).bindDevice(dev.id, "WRONGWRONG").catch((e: unknown) => e)
    expect((wrong as ApiError).status).toBeGreaterThanOrEqual(409) // already bound; never a different answer for a wrong code
    await c.removeDevice(dev.id)
    expect(await o.api.get("/v1/devices")).toEqual([])

    // integrations (nothing connected), privacy, grants
    expect((await o.api.get("/v1/integrations")).map((i) => toIntegration(i, "UTC"))).toEqual([])
    const req = toDataRequest(await c.requestExport(), "Europe/Dublin", () => "Owner")
    expect(req).toMatchObject({ kind: "export", status: expect.any(String) })
    const list = await o.api.get("/v1/data-requests")
    expect(list.map((r) => toDataRequest(r, "UTC", (id) => id)).length).toBeGreaterThan(0)
    expect((await o.api.get("/v1/settings/support-grants")).items.map((g) => toGrant(g, "UTC"))).toEqual([])

    // account: sessions, notification preferences, own name
    const sessions = await o.api.get("/v1/me/sessions")
    expect(sessions.items.length).toBeGreaterThan(0)
    const prefs = toPrefs(await o.api.get("/v1/me/notification-preferences"))
    const saved = toPrefs(await makeAccountClient(o.api).savePrefs(prefsBody(prefs, { kind: "task", channel: "email", on: true })))
    expect(saved.rows.find((r) => r.kind === "task")!.email).toBe(true)
    const auth = makeAuthClient({ baseUrl: "http://api.test/api/auth", fetch: o.fetch })
    await auth.updateName("Owner Renamed")
    expect((await o.api.get("/v1/me")).user.name).toBe("Owner Renamed")

    // audit: every change above is in the log, with actions the web knows
    const rows = (await o.api.get("/v1/audit", { query: { limit: 100 } })).items.map((r) => toAuditEvent(r, "Europe/Dublin", (id) => id))
    expect(rows.length).toBeGreaterThan(10)
    const actions = new Set(rows.map((r) => r.action))
    for (const a of ["tenant.settings_updated", "team.created", "invite.created", "invite.revoked", "device.registered", "device.retired", "device.bound", "device_policy.set", "settings.mfa_policy.updated", "member.role_changed", "role.updated"]) expect(actions.has(a), a).toBe(true)
    expect(rows.every((r) => Object.values(r).every((v) => v !== undefined))).toBe(true)

    // search: scoped hits map to items with an href per entity
    const hits = await o.api.get("/v1/search", { query: { q: "Owner", limit: "20" } })
    for (const i of hitsToItems(hits.hits)) expect(i.href.startsWith("/")).toBe(true)
    void tenant
  })

  test("staff meet a plain 403 on the admin reads (the page hides what it cannot read), never a 5xx", async () => {
    const { t, staff } = await world()
    const s = await browser(t, staff, "coppers")
    for (const path of ["/v1/settings/organisation", "/v1/roles", "/v1/invites", "/v1/data-requests", "/v1/settings/support-grants", "/v1/audit"] as const) {
      const r = await s.api.get(path as never).catch((e: unknown) => e)
      expect(r, path).toBeInstanceOf(ApiError)
      expect((r as ApiError).status, path).toBe(403)
    }
    expect(s.statuses.some((x) => x >= 500)).toBe(false)
    void toPerson
  })

  test("plans table equals billing/plans.json", async () => {
    await world()
    const rows = await ownerQuery("select id, name, price_monthly_minor, currency, trial_days, limits from plans order by id")
    const byId = new Map(rows.map((r) => [String(r.id), r]))
    for (const p of PLANS as { id: string; name: string; priceMonthly: number; currency: string; trialDays: number; limits: Record<string, number> }[]) {
      const r = byId.get(p.id)
      expect(r, p.id).toBeTruthy()
      expect(Number(r!.price_monthly_minor), p.id).toBe(Math.round(p.priceMonthly * 100))
      expect(r!.currency).toBe(p.currency)
      expect(Number(r!.trial_days)).toBe(p.trialDays)
      expect(r!.limits).toEqual(p.limits)
    }
    expect(byId.size).toBe((PLANS as unknown[]).length)
  })
})
