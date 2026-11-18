import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const jar = new Map<string, string>()
const sets: { name: string; value: string; opts: Record<string, unknown> }[] = []
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: (name: string, value: string, opts: Record<string, unknown>) => { sets.push({ name, value, opts }) } }),
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }) } }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import { completeOnboarding } from "@/app/actions/onboarding"

const APP = "https://app.example.com"
const API = "http://api.internal:3001"
const input = { company: "Northgate Facility Services", timezone: "Europe/London", deadline: "18:00", departments: ["Security", "Cleaning"], invites: [{ email: "Ana@x.ie", roleKey: "manager" }, { email: "", roleKey: "manager" }] }
let calls: { method: string; path: string; tenant: string | null; body: unknown }[]
let fetchMock: ReturnType<typeof vi.fn>
type S = { me?: number; taken?: number; teamFails?: boolean; inviteFails?: boolean; tenantFails?: boolean; tenantRefusal?: [number, string] }
const script = (s: S = {}) => {
  calls = []
  let attempts = 0
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers)
    const path = new URL(url).pathname
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init.method ?? "GET", path, tenant: h.get("x-tenant"), body })
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } })
    const no = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r" }), { status, headers: { "content-type": "application/problem+json" } })
    if (path === "/v1/me") return s.me ? no(s.me, "session_expired") : ok({ user: { id: "u1", email: "a@x.ie", name: "Ana", emailVerified: true, twoFactorEnabled: false }, platformRole: null, tenants: [] })
    if (path === "/v1/tenants") {
      attempts += 1
      if (s.tenantFails) return no(500, "internal")
      if (s.tenantRefusal) return no(...s.tenantRefusal)
      if (attempts <= (s.taken ?? 0)) return no(409, "slug_taken")
      return ok({ id: "t-1", slug: (body as { slug: string }).slug }, 201)
    }
    if (path === "/v1/settings/organisation") return ok({})
    if (path === "/v1/teams") return s.teamFails ? no(422, "x") : ok({ id: "tm" }, 201)
    if (path === "/v1/roles") return ok([{ id: "role-mgr", key: "manager" }, { id: "role-own", key: "owner" }])
    if (path === "/v1/invites") return s.inviteFails ? no(422, "x") : ok({ id: "i1" }, 201)
    return no(404, "not_found")
  })
  vi.stubGlobal("fetch", fetchMock)
}
beforeEach(() => {
  jar.clear(); sets.length = 0
  jar.set("better-auth.session_token", "tok")
  vi.stubEnv("API_URL", API); vi.stubEnv("APP_ORIGIN", APP); vi.stubEnv("NODE_ENV", "production")
  script()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("B7 T5 company cap and MFA answers", () => {
  test("403 tenant_limit_reached is 'limit' and 401 mfa_* is 'mfa' (neither is an expired session); nothing else is created", async () => {
    script({ tenantRefusal: [403, "tenant_limit_reached"] })
    expect(await completeOnboarding(input)).toEqual({ ok: false, error: "limit" })
    script({ tenantRefusal: [401, "mfa_challenge"] })
    expect(await completeOnboarding(input)).toEqual({ ok: false, error: "mfa" })
    script({ tenantRefusal: [401, "mfa_enrolment_required"] })
    expect(await completeOnboarding(input)).toEqual({ ok: false, error: "mfa" })
    expect(calls.map((c) => c.path)).toEqual(["/v1/me", "/v1/tenants"])
    script({ tenantRefusal: [401, "session_expired"] })
    await expect(completeOnboarding(input)).rejects.toThrow("NEXT_REDIRECT")
  })
})

describe("T6.3 completeOnboarding: POST /v1/tenants, then the company's first settings, teams and invites", () => {
  test("creates the tenant with the wizard's values, sets the deadline, makes a team per department, invites, and only then sets od-tenant", async () => {
    const r = await completeOnboarding(input)
    expect(r).toEqual({ ok: true, slug: "northgate-facility-services", invited: 1, failedInvites: 0 })
    const create = calls.find((c) => c.path === "/v1/tenants")!
    expect(create.body).toMatchObject({ name: "Northgate Facility Services", slug: "northgate-facility-services", timezone: "Europe/London", currency: "GBP", locale: "en-GB" })
    expect(create.tenant).toBeNull() // creating a tenant needs no tenant header
    expect(calls.find((c) => c.path === "/v1/settings/organisation")).toMatchObject({ method: "PATCH", tenant: "northgate-facility-services", body: { reportDeadline: "18:00" } })
    expect(calls.filter((c) => c.path === "/v1/teams").map((c) => c.body)).toEqual([{ name: "Security", kind: "team" }, { name: "Cleaning", kind: "team" }])
    expect(calls.filter((c) => c.path === "/v1/invites").map((c) => c.body)).toEqual([{ email: "ana@x.ie", roleId: "role-mgr" }])
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ name: "od-tenant", value: "northgate-facility-services", opts: { httpOnly: true, sameSite: "lax", secure: true, path: "/" } })
    // the cookie is set after the tenant exists, never before the API answered
    expect(calls.findIndex((c) => c.path === "/v1/tenants")).toBeLessThan(calls.length - 1)
  })

  test("a taken address retries with a suffixed one", async () => {
    script({ taken: 1 })
    const r = await completeOnboarding(input)
    expect(r.ok && r.slug).toMatch(/^northgate-facility-services-[a-z0-9]{4}$/)
  })

  test("every address taken: a clear error, no cookie", async () => {
    script({ taken: 9 })
    expect(await completeOnboarding(input)).toEqual({ ok: false, error: "slug_taken" })
    expect(sets).toEqual([])
  })

  test("a failing create is 'failed' and writes no cookie; invalid input never reaches the API", async () => {
    script({ tenantFails: true })
    expect(await completeOnboarding(input)).toEqual({ ok: false, error: "failed" })
    expect(sets).toEqual([])
    script()
    expect(await completeOnboarding({ ...input, timezone: "Nope/Zone" } as never)).toEqual({ ok: false, error: "invalid" })
    expect(await completeOnboarding("x" as never)).toEqual({ ok: false, error: "invalid" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("a team or invite that fails does not undo the company: the cookie is still set and the failures are counted", async () => {
    script({ teamFails: true, inviteFails: true })
    const r = await completeOnboarding(input)
    expect(r).toMatchObject({ ok: true, invited: 0, failedInvites: 1 })
    expect(sets).toHaveLength(1)
  })

  test("an invite role the owner's tenant does not have is skipped, never mapped to another role", async () => {
    const r = await completeOnboarding({ ...input, invites: [{ email: "a@x.ie", roleKey: "super-admin" }] })
    expect(r).toMatchObject({ ok: true, invited: 0, failedInvites: 1 })
    expect(calls.filter((c) => c.path === "/v1/invites")).toEqual([])
  })

  test("no session: /sign-in; a dead session: the cookie-clearing route; nothing is created", async () => {
    jar.delete("better-auth.session_token")
    await expect(completeOnboarding(input)).rejects.toMatchObject({ url: "/sign-in" })
    jar.set("better-auth.session_token", "tok")
    script({ me: 401 })
    await expect(completeOnboarding(input)).rejects.toMatchObject({ url: "/api/session/expired" })
    expect(calls.some((c) => c.path === "/v1/tenants")).toBe(false)
    expect(sets).toEqual([])
  })
})
