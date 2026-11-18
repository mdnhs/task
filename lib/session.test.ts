import { beforeEach, describe, expect, test, vi } from "vitest"
import { ENT_DATA, STATIC_ROLES, world } from "@/test/support/session-world"

// ---- the request scope, mocked: cookies, headers, redirect, React's per-request cache, and the API (a fake fetch behind the real client) ----
const state = vi.hoisted(() => ({ jar: new Map<string, string>(), reqHeaders: new Headers(), memos: [] as Map<string, unknown>[], current: undefined as unknown as { deps: { api: (o?: { tenant?: string | null }) => Promise<unknown> }; calls: { path: string; tenant: string | null }[] } }))
vi.mock("server-only", () => ({}))
vi.mock("react", () => ({
  cache: <A extends unknown[], R>(fn: (...a: A) => R) => {
    const memo = new Map<string, unknown>()
    state.memos.push(memo)
    return (...a: A): R => {
      const k = JSON.stringify(a)
      if (!memo.has(k)) memo.set(k, fn(...a))
      return memo.get(k) as R
    }
  },
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (state.jar.has(n) ? { name: n, value: state.jar.get(n)! } : undefined), getAll: () => [...state.jar].map(([name, value]) => ({ name, value })) }),
  headers: async () => state.reqHeaders,
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url })
  },
}))
vi.mock("@/lib/api/server", () => ({ apiServer: (o?: { tenant?: string | null }) => state.current.deps.api(o) }))
vi.mock("@/lib/data", () => ({
  getData: async (file: string) => (file === "billing/entitlements.json" ? ENT_DATA : file === "shell/roles.json" ? { roles: STATIC_ROLES } : Promise.reject(new Error(`unexpected getData ${file}`))),
}))

import { canWrite, getIdentity, getPlatformSession, getSession, peekPlatformSession, peekSession, requireMfaOk } from "@/lib/session"

const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return (e as { url?: string }).url ?? `error:${(e as Error).message}`
  }
  return null
}

beforeEach(() => {
  state.jar.clear()
  state.memos.forEach((m) => m.clear())
  state.reqHeaders = new Headers({ "x-od-path": "/tasks", "x-od-search": "?view=board" })
  state.jar.set("better-auth.session_token", "tok")
  state.jar.set("od-tenant", "alpha")
  state.current = world()
})

describe("T6.3 getSession (server): the optimistic proxy check is not authorisation", () => {
  test("one /v1/me call per request even when five components ask", async () => {
    const all = await Promise.all([getSession(), getSession(), getSession(), getSession(), getSession()])
    expect(all.every((s) => s.tenantSlug === "alpha")).toBe(true)
    expect(state.current.calls.filter((c) => c.path === "/v1/me")).toHaveLength(1)
    expect(state.current.calls.filter((c) => c.path === "/v1/entitlements")).toHaveLength(1)
  })

  test("no session cookie: redirect to /sign-in, and the API is not called", async () => {
    state.jar.delete("better-auth.session_token")
    expect(await redirectOf(getSession())).toBe("/sign-in")
    expect(state.current.calls).toEqual([])
  })

  test("only the real session_token counts: the two_factor or dont_remember cookies do not", async () => {
    state.jar.delete("better-auth.session_token")
    state.jar.set("better-auth.two_factor", "x")
    state.jar.set("better-auth.dont_remember", "x")
    expect(await redirectOf(getSession())).toBe("/sign-in")
    expect(state.current.calls).toEqual([])
    state.memos.forEach((m) => m.clear())
    state.jar.set("__Secure-better-auth.session_token", "tok") // https
    expect(await redirectOf(getSession())).toBeNull()
  })

  test("cookie present but invalid: /v1/me answers 401, the layout redirects to the cookie-clearing route; no data was fetched", async () => {
    state.current = world({ me: { status: 401, code: "session_expired" } })
    expect(await redirectOf(getSession())).toBe("/api/session/expired")
    expect(state.current.calls.map((c) => c.path)).toEqual(["/v1/me"])
  })

  test("no membership: staff go to /platform, everyone else to /onboarding", async () => {
    const user = { id: "u2", email: "s@x.ie", name: "S", emailVerified: true, twoFactorEnabled: false }
    state.current = world({ me: { user, platformRole: "support", tenants: [] } })
    expect(await redirectOf(getSession())).toBe("/platform")
    state.memos.forEach((m) => m.clear())
    state.current = world({ me: { user, platformRole: null, tenants: [] } })
    expect(await redirectOf(getSession())).toBe("/onboarding")
  })

  test("a stale od-tenant (or none) is repaired through the tenant route, returning to this page; never a loop on a good cookie", async () => {
    state.jar.set("od-tenant", "gone-co")
    expect(await redirectOf(getSession())).toBe(`/api/session/tenant?next=${encodeURIComponent("/tasks?view=board")}`)
    state.memos.forEach((m) => m.clear())
    state.jar.set("od-tenant", "bravo")
    expect(await redirectOf(getSession())).toBeNull()
  })

  test("peekSession never redirects: null for signed-out, expired or no-tenant, the session otherwise", async () => {
    state.jar.delete("better-auth.session_token")
    expect(await peekSession()).toBeNull()
    state.jar.set("better-auth.session_token", "tok")
    state.memos.forEach((m) => m.clear())
    state.current = world({ me: { status: 401, code: "unauthenticated" } })
    expect(await peekSession()).toBeNull()
    state.memos.forEach((m) => m.clear())
    state.current = world()
    expect((await peekSession())?.tenantSlug).toBe("alpha")
  })

  test("the MFA gate states come through (enrol: the layout shows MfaGate; challenge: the step-up)", async () => {
    state.current = world({ tenants: { alpha: { status: 401, code: "mfa_enrolment_required" } } })
    expect((await getSession()).mfa).toBe("enrol")
    state.memos.forEach((m) => m.clear())
    state.current = world({ tenants: { alpha: { status: 401, code: "mfa_challenge" } } })
    expect((await getSession()).mfa).toBe("challenge")
  })

  test("canWrite follows the plan-narrowed role and the tenant status (blocked billing is read-only)", async () => {
    const s = await getSession()
    expect(canWrite(s, "tasks")).toBe(true)
    expect(canWrite(s, "files")).toBe(false) // outside the plan
    state.memos.forEach((m) => m.clear())
    state.current = world({ ent: { status: "unpaid", billingState: "blocked" } })
    expect(canWrite(await getSession(), "tasks")).toBe(false)
  })
})

describe("T6.3 getPlatformSession: the console accepts a user with no company", () => {
  const user = { id: "u2", email: "s@x.ie", name: "S", emailVerified: true, twoFactorEnabled: true }
  test("active staff with no membership get the console role, not a redirect", async () => {
    state.current = world({ me: { user, platformRole: "owner", tenants: [] } })
    const s = await getPlatformSession()
    expect(s.role.platform).toBe(true)
    expect(s.user.email).toBe("s@x.ie")
    expect(s.platformRole).toBe("owner")
  })
  test("the console second factor comes from the API (carry-in a): ok, challenge, enrol, and a user with no factor never calls it", async () => {
    state.current = world({ me: { user, platformRole: "owner", tenants: [] } })
    expect((await getPlatformSession()).mfa).toBe("ok")
    state.memos.forEach((m) => m.clear())
    state.current = world({ me: { user, platformRole: "owner", tenants: [] }, platform: { status: 401, code: "mfa_challenge" } })
    expect((await getPlatformSession()).mfa).toBe("challenge")
    state.memos.forEach((m) => m.clear())
    state.current = world({ me: { user, platformRole: "owner", tenants: [] }, platform: { status: 401, code: "mfa_enrolment_required" } })
    expect((await getPlatformSession()).mfa).toBe("enrol")
    state.memos.forEach((m) => m.clear())
    const calls = (state.current = world({ me: { user: { ...user, twoFactorEnabled: false }, platformRole: "owner", tenants: [] } })).calls
    expect((await getPlatformSession()).mfa).toBe("enrol")
    expect(calls.map((c) => c.path)).not.toContain("/v1/platform/session")
  })
  test("console probe calls /v1/platform/session and no longer the tenants list", async () => {
    const calls = (state.current = world({ me: { user, platformRole: "owner", tenants: [] } })).calls
    expect((await getPlatformSession()).mfa).toBe("ok")
    const paths = calls.map((c) => c.path)
    expect(paths).toContain("/v1/platform/session")
    expect(paths).not.toContain("/v1/platform/tenants")
  })
  test("a company member who is staff gets the console's own factor state, not the company's", async () => {
    state.current = world({ me: { user, platformRole: "support", tenants: [{ slug: "alpha", name: "Alpha Co", roleKey: "owner" }] }, platform: { status: 401, code: "mfa_challenge" } })
    expect((await getPlatformSession()).mfa).toBe("challenge")
  })
  test("a non-staff user with no membership is sent to /onboarding; no session to /sign-in; expired to the clearing route", async () => {
    state.current = world({ me: { user, platformRole: null, tenants: [] } })
    expect(await redirectOf(getPlatformSession())).toBe("/onboarding")
    state.memos.forEach((m) => m.clear())
    state.jar.delete("better-auth.session_token")
    expect(await redirectOf(getPlatformSession())).toBe("/sign-in")
    state.memos.forEach((m) => m.clear())
    state.jar.set("better-auth.session_token", "tok")
    state.current = world({ me: { status: 401, code: "session_expired" } })
    expect(await redirectOf(getPlatformSession())).toBe("/api/session/expired")
  })
  test("a company member who is NOT staff keeps their tenant role (the console then shows 'Access restricted')", async () => {
    const s = await getPlatformSession()
    expect(s.role.platform).toBeUndefined()
    expect(s.role.id).toBe("owner")
  })
  test("a company member who IS staff gets the console role", async () => {
    state.current = world({ me: { user, platformRole: "support", tenants: [{ slug: "alpha", name: "Alpha Co", roleKey: "owner" }] } })
    expect((await getPlatformSession()).role.platform).toBe(true)
  })
})

describe("T6.3 getIdentity and peekPlatformSession (onboarding and skeletons)", () => {
  const user = { id: "u2", email: "s@x.ie", name: "S", emailVerified: true, twoFactorEnabled: false }
  test("getIdentity: no company is allowed (hasTenant false); signed out and expired still redirect", async () => {
    state.current = world({ me: { user, platformRole: null, tenants: [] } })
    expect(await getIdentity()).toMatchObject({ hasTenant: false, me: { user: { email: "s@x.ie" } } })
    state.memos.forEach((m) => m.clear())
    state.current = world()
    expect((await getIdentity()).hasTenant).toBe(true)
    state.memos.forEach((m) => m.clear())
    state.jar.delete("better-auth.session_token")
    expect(await redirectOf(getIdentity())).toBe("/sign-in")
    state.memos.forEach((m) => m.clear())
    state.jar.set("better-auth.session_token", "tok")
    state.current = world({ me: { status: 401, code: "session_expired" } })
    expect(await redirectOf(getIdentity())).toBe("/api/session/expired")
  })
  test("peekPlatformSession never redirects: the console session for staff, null otherwise", async () => {
    state.current = world({ me: { user, platformRole: "owner", tenants: [] } })
    expect((await peekPlatformSession())?.role.platform).toBe(true)
    state.memos.forEach((m) => m.clear())
    state.current = world({ me: { user, platformRole: null, tenants: [] } })
    expect(await peekPlatformSession()).toBeNull()
    state.memos.forEach((m) => m.clear())
    state.current = world({ me: { status: 401, code: "unauthenticated" } })
    expect(await peekPlatformSession()).toBeNull()
  })
})

describe("K2 requireMfaOk: every page and action that calls the API gates itself (a layout does not protect the pages below it)", () => {
  test("returns the session when the second factor is in order", async () => {
    expect((await requireMfaOk()).mfa).toBe("ok")
  })

  test("redirects to /mfa while enrolment or the code step is outstanding (a page that is not itself guarded, so no loop), never returning a session", async () => {
    state.current = world({ tenants: { alpha: { status: 401, code: "mfa_enrolment_required" } } })
    expect(await redirectOf(requireMfaOk())).toBe("/mfa")
    state.memos.forEach((m) => m.clear())
    state.current = world({ tenants: { alpha: { status: 401, code: "mfa_challenge" } } })
    expect(await redirectOf(requireMfaOk())).toBe("/mfa")
  })

  test("it keeps getSession's own redirects: signed out, expired, no company", async () => {
    state.jar.delete("better-auth.session_token")
    expect(await redirectOf(requireMfaOk())).toBe("/sign-in")
    state.memos.forEach((m) => m.clear())
    state.jar.set("better-auth.session_token", "tok")
    state.current = world({ me: { status: 401, code: "session_expired" } })
    expect(await redirectOf(requireMfaOk())).toBe("/api/session/expired")
  })
})
