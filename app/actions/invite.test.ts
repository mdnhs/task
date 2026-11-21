import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const jar = new Map<string, string>()
const sets: { name: string; value: string }[] = []
const revalidated: unknown[][] = []
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { sets.push({ name, value }); jar.set(name, value) },
    delete: (name: string) => { jar.delete(name) },
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}))
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }) } }))
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => { revalidated.push(a) } }))

import { acceptInvite, registerInvite } from "@/app/actions/invite"

const TOKEN = "db6467e9c5c643729ca8219e0559d659SyfaUkKYE5XA2jrfLo9sCOK25TBBOScdsl8b-zuHueg"
let calls: { method: string; path: string; tenant: string | null; origin: string | null; body: unknown }[]
const script = (answer: { status: number; body: unknown }) => {
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers)
    calls.push({ method: init.method ?? "GET", path: new URL(url).pathname, tenant: h.get("x-tenant"), origin: h.get("origin"), body: init.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": answer.status === 200 ? "application/json" : "application/problem+json" } })
  }))
}
const outcome = async (p: Promise<unknown>) => {
  try { return { returned: await p } } catch (e) { return { redirect: (e as { url?: string }).url } }
}

beforeEach(() => {
  jar.clear(); sets.length = 0; revalidated.length = 0
  jar.set("better-auth.session_token", "tok")
  vi.stubEnv("API_URL", "http://api.internal:3001")
  vi.stubEnv("APP_ORIGIN", "https://app.example.com")
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("acceptInvite: joins the company the invitation names", () => {
  test("success: POST /v1/invites/accept with the token, NO tenant header and an Origin; then od-tenant = the slug and home", async () => {
    jar.set("od-tenant", "old-co") // a stale cookie must not steer the call
    script({ status: 200, body: { slug: "acme" } })
    expect(await outcome(acceptInvite(TOKEN))).toEqual({ redirect: "/" })
    expect(calls).toEqual([{ method: "POST", path: "/v1/invites/accept", tenant: null, origin: "https://app.example.com", body: { token: TOKEN } }])
    expect(sets).toEqual([{ name: "od-tenant", value: "acme" }])
    expect(revalidated).toEqual([["/", "layout"]])
  })

  test("a refusal comes back as a result, writes no cookie and does not redirect", async () => {
    script({ status: 403, body: { status: 403, code: "invite_email_mismatch", requestId: "r1" } })
    expect(await outcome(acceptInvite(TOKEN))).toMatchObject({ returned: { ok: false, kind: "email_mismatch" } })
    script({ status: 410, body: { status: 410, code: "invite_expired", requestId: "r2" } })
    expect(await outcome(acceptInvite(TOKEN))).toMatchObject({ returned: { ok: false, kind: "expired" } })
    expect(sets).toEqual([])
  })

  test("no session cookie: 'signed_out' without calling the API; an empty or non-string token is 'invalid' without calling it either", async () => {
    script({ status: 200, body: { slug: "acme" } })
    jar.clear()
    expect(await outcome(acceptInvite(TOKEN))).toMatchObject({ returned: { ok: false, kind: "signed_out" } })
    jar.set("better-auth.session_token", "tok")
    expect(await outcome(acceptInvite(""))).toMatchObject({ returned: { ok: false, kind: "invalid" } })
    expect(await outcome(acceptInvite({ evil: 1 } as unknown as string))).toMatchObject({ returned: { ok: false, kind: "invalid" } })
    expect(calls).toEqual([])
    expect(sets).toEqual([])
  })
})

describe("registerInvite: one-step join for a visitor with no account", () => {
  const IN = { token: TOKEN, name: "Nina Newhire", password: "Passw0rd!long" }

  test("POSTs the token, name and password to /v1/invites/register with NO tenant header and an Origin, needs no session, and writes no cookie", async () => {
    jar.clear() // nobody is signed in
    script({ status: 201, body: { slug: "acme", email: "new@x.ie" } })
    expect(await outcome(registerInvite(IN))).toEqual({ returned: { ok: true, slug: "acme", email: "new@x.ie" } })
    expect(calls).toEqual([{ method: "POST", path: "/v1/invites/register", tenant: null, origin: "https://app.example.com", body: IN }])
    expect(sets).toEqual([]) // the sign-in that follows (and afterSignIn) sets the cookies, not this
  })

  test("the address is never sent: only what the person typed (name, password) and the token", async () => {
    script({ status: 201, body: { slug: "acme", email: "new@x.ie" } })
    await registerInvite({ ...IN, email: "attacker@x.ie" } as never)
    expect(Object.keys((calls[0]!.body as Record<string, unknown>)).sort()).toEqual(["name", "password", "token"])
  })

  test("API refusals come back as results: account_exists, expired, seats, validation", async () => {
    for (const [status, code, kind] of [[409, "account_exists", "account_exists"], [410, "invite_expired", "expired"], [409, "seat_limit", "seats"], [422, "validation_error", "validation"]] as const) {
      script({ status, body: { status, code, requestId: "r" } })
      expect(await outcome(registerInvite(IN)), code).toMatchObject({ returned: { ok: false, kind } })
    }
    expect(sets).toEqual([])
  })

  test("a non-string token, name or password is sent as empty (an empty token never reaches the API)", async () => {
    script({ status: 201, body: { slug: "acme", email: "new@x.ie" } })
    expect(await outcome(registerInvite({ token: { evil: 1 }, name: 1, password: null } as never))).toMatchObject({ returned: { ok: false, kind: "invalid" } })
    expect(calls).toEqual([])
  })
})
