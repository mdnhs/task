import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// ---- request scope: cookie jar (with writes recorded), headers, redirect, revalidatePath ----
const jar = new Map<string, string>()
const sets: { name: string; value: string; opts: Record<string, unknown> }[] = []
const deletes: string[] = []
const revalidated: unknown[][] = []
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, opts: Record<string, unknown>) => { sets.push({ name, value, opts }); jar.set(name, value) },
    delete: (name: string) => { deletes.push(name); jar.delete(name) },
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}))
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }) } }))
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => { revalidated.push(a) } }))

import { afterSignIn, signOutAction, switchTenant } from "@/app/actions/session"

const APP = "https://app.example.com"
const API = "http://api.internal:3001"
const ME = { user: { id: "u1", email: "a@x.ie", name: "Ana", emailVerified: true, twoFactorEnabled: false }, platformRole: null, tenants: [{ slug: "alpha", name: "Alpha", roleKey: "owner" }, { slug: "bravo", name: "Bravo", roleKey: "manager" }] }
let fetchMock: ReturnType<typeof vi.fn>
let calls: { method: string; path: string; tenant: string | null; origin: string | null; cookie: string | null }[]
type Script = { me?: unknown | number; tenantStatus?: Record<string, { status: number; code: string }>; signOut?: number; throws?: boolean }
const script = (s: Script = {}) => {
  calls = []
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (s.throws) throw new TypeError("fetch failed")
    const h = new Headers(init.headers)
    const path = new URL(url).pathname
    calls.push({ method: init.method ?? "GET", path, tenant: h.get("x-tenant"), origin: h.get("origin"), cookie: h.get("cookie") })
    const ok = (b: unknown = {}) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } })
    const no = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r" }), { status, headers: { "content-type": "application/problem+json" } })
    if (path === "/v1/me") return typeof s.me === "number" ? no(s.me, "session_expired") : ok(s.me ?? ME)
    if (path === "/v1/me/tenant") {
      const bad = s.tenantStatus?.[h.get("x-tenant") ?? ""]
      return bad ? no(bad.status, bad.code) : ok({})
    }
    if (path === "/api/auth/sign-out") return s.signOut ? no(s.signOut, "x") : ok({ success: true })
    return no(404, "not_found")
  })
  vi.stubGlobal("fetch", fetchMock)
}
const redirectOf = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return (e as { url?: string }).url ?? `error:${(e as Error).message}` }
  return null
}

beforeEach(() => {
  jar.clear(); sets.length = 0; deletes.length = 0; revalidated.length = 0
  jar.set("better-auth.session_token", "tok")
  vi.stubEnv("API_URL", API)
  vi.stubEnv("APP_ORIGIN", APP)
  vi.stubEnv("NODE_ENV", "production")
  script()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("T6.3 switchTenant(slug): the only writer of od-tenant, after the API confirms the membership", () => {
  test("a slug outside /v1/me is rejected and writes no cookie", async () => {
    expect(await switchTenant("victim-co")).toEqual({ ok: false })
    expect(sets).toEqual([])
    expect(calls.filter((c) => c.path === "/v1/me/tenant")).toEqual([]) // never even asked the API about a tenant the user is not in
  })

  test("a member slug is accepted: the cookie is httpOnly, sameSite lax, secure in production, path /, host-only; the layout is revalidated", async () => {
    expect(await switchTenant("bravo")).toEqual({ ok: true })
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ name: "od-tenant", value: "bravo", opts: { httpOnly: true, sameSite: "lax", secure: true, path: "/" } })
    expect(sets[0].opts).not.toHaveProperty("domain")
    expect(revalidated).toEqual([["/", "layout"]])
    const confirm = calls.find((c) => c.path === "/v1/me/tenant")!
    expect(confirm.tenant).toBe("bravo") // membership confirmed by the API before the cookie was written
  })

  test("not secure outside production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    await switchTenant("alpha")
    expect(sets[0].opts.secure).toBe(false)
  })

  test("a tenant the API answers 404 for (removed or suspended membership) writes no cookie", async () => {
    script({ tenantStatus: { bravo: { status: 404, code: "not_found" } } })
    expect(await switchTenant("bravo")).toEqual({ ok: false })
    expect(sets).toEqual([])
  })

  test("a tenant whose MFA gate answers 401 mfa_* is still a confirmed membership (the gate is shown there)", async () => {
    script({ tenantStatus: { bravo: { status: 401, code: "mfa_enrolment_required" } } })
    expect(await switchTenant("bravo")).toEqual({ ok: true })
    script({ tenantStatus: { bravo: { status: 401, code: "session_expired" } } })
    expect(await redirectOf(switchTenant("bravo"))).toBe("/api/session/expired")
  })

  test("a value that is not a slug never reaches the API; non-strings too", async () => {
    for (const bad of ["", "A", "../x", "alpha\r\nSet-Cookie: x=1", "a b", 5, null, undefined, {}]) expect(await switchTenant(bad as never)).toEqual({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sets).toEqual([])
  })

  test("signed out (no session cookie): no cookie is written and the caller is sent to /sign-in", async () => {
    jar.delete("better-auth.session_token")
    expect(await redirectOf(switchTenant("alpha"))).toBe("/sign-in")
    expect(sets).toEqual([])
  })

  test("the API is not reachable: no cookie, ok false (never trusts the slug on its own)", async () => {
    script({ throws: true })
    expect(await switchTenant("alpha")).toEqual({ ok: false })
    expect(sets).toEqual([])
  })
})

describe("T6.3 afterSignIn: od-tenant = the first membership, then home, /platform or /onboarding", () => {
  test("with memberships: writes od-tenant = first membership and lands on / (or a SAFE next)", async () => {
    expect(await redirectOf(afterSignIn())).toBe("/")
    expect(sets[0]).toMatchObject({ name: "od-tenant", value: "alpha", opts: { httpOnly: true, sameSite: "lax", path: "/" } })
    sets.length = 0
    expect(await redirectOf(afterSignIn("/tasks?view=board"))).toBe("/tasks?view=board")
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) expect(await redirectOf(afterSignIn(bad)), bad).toBe("/")
  })

  test("staff without a company go to /platform, others without one to /onboarding; no tenant cookie is written for either", async () => {
    script({ me: { ...ME, tenants: [], platformRole: "support" } })
    expect(await redirectOf(afterSignIn("/tasks"))).toBe("/platform")
    script({ me: { ...ME, tenants: [] } })
    expect(await redirectOf(afterSignIn("/tasks"))).toBe("/onboarding")
    expect(sets).toEqual([])
  })

  test("no session behind the call: /sign-in, nothing written", async () => {
    script({ me: 401 })
    expect(await redirectOf(afterSignIn())).toBe("/sign-in")
    expect(sets).toEqual([])
  })
})

describe("T6.3 signOutAction: ends the session and clears every cookie of it", () => {
  test("calls Better Auth sign-out with Origin and the session cookie, clears better-auth.* and od-tenant, goes to /sign-in", async () => {
    jar.set("od-tenant", "alpha")
    jar.set("better-auth.two_factor", "x")
    jar.set("od-theme", "dark")
    expect(await redirectOf(signOutAction())).toBe("/sign-in")
    const out = calls.find((c) => c.path === "/api/auth/sign-out")!
    expect(out.method).toBe("POST")
    expect(out.origin).toBe(APP)
    expect(out.cookie).toBe("better-auth.session_token=tok; better-auth.two_factor=x")
    expect(deletes.sort()).toEqual(["better-auth.session_token", "better-auth.two_factor", "od-tenant"])
    expect(deletes).not.toContain("od-theme")
  })

  test("even when the API fails or is unreachable, the cookies are cleared locally (the visitor is signed out of this browser)", async () => {
    script({ throws: true })
    expect(await redirectOf(signOutAction())).toBe("/sign-in")
    expect(deletes).toContain("better-auth.session_token")
    script({ signOut: 500 })
    jar.set("better-auth.session_token", "tok")
    expect(await redirectOf(signOutAction())).toBe("/sign-in")
  })

  test("a revoked session fails closed on the next request: the same cookie now gets 401 from /v1/me", async () => {
    script({ me: 401 })
    const { resolveSession } = await import("@/lib/session-core")
    const { makeApiClient } = await import("@/lib/api/client")
    const r = await resolveSession({ hasSessionCookie: true, tenantCookie: "alpha", api: async () => makeApiClient({ baseUrl: API, fetch: fetchMock as never }), entitlementsData: async () => { throw new Error("must not load") }, staticRoles: async () => [] })
    expect(r.kind).toBe("expired")
  })
})

describe("T6.3 the demo switchers are gone", () => {
  test("app/actions/session exports no setRole, setDevice, setTenant or signIn(role)", async () => {
    const mod = (await import("@/app/actions/session")) as Record<string, unknown>
    for (const gone of ["setRole", "setDevice", "setTenant", "signIn", "signOut"]) expect(mod[gone], gone).toBeUndefined()
    expect(typeof mod.switchTenant).toBe("function")
    expect(typeof mod.signOutAction).toBe("function")
    expect(typeof mod.afterSignIn).toBe("function")
  })
})
