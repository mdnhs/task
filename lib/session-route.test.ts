import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { expireSession, repairTenant, repairTenantPage } from "@/lib/session-route"

const APP = "https://app.example.com"
const API = "http://api.internal:3001"
const ME = { user: { id: "u1", email: "a@x.ie", name: "Ana", emailVerified: true, twoFactorEnabled: false }, platformRole: null, tenants: [{ slug: "alpha", name: "Alpha", roleKey: "owner" }, { slug: "bravo", name: "Bravo", roleKey: "manager" }] }
const tenantCtx = (slug: string) => ({
  tenant: { id: `id-${slug}`, slug, name: slug, timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", sessionIdleHours: 12, mfaPolicy: { mode: "off", roles: [] } },
  member: { userId: "u1", roleId: "r", roleKey: "owner", role: { label: "Owner", description: "", home: "manager", access: { tasks: "write" } } },
  brand: { primaryColor: null }, reportDeadline: "17:30", reportDueAfterMinutes: 60, device: { id: null, type: "browser", label: "Unregistered browser", trusted: false }, features: { drive: false },
})
const ENT = { planId: "business", status: "active", modules: ["M0", "M1"], seats: 10, seatsUsed: 1, trialEndsAt: null, graceEndsAt: null, billingState: "ok" }

let fetchMock: ReturnType<typeof vi.fn>
let sent: { path: string; cookie: string | null; tenant: string | null }[]
type Script = { me?: number | unknown; gone?: string[]; throws?: boolean }
const script = (s: Script = {}) => {
  sent = []
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (s.throws) throw new TypeError("fetch failed")
    const h = new Headers(init.headers)
    const path = new URL(url).pathname
    sent.push({ path, cookie: h.get("cookie"), tenant: h.get("x-tenant") })
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } })
    const no = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r" }), { status, headers: { "content-type": "application/problem+json" } })
    if (path === "/v1/me") return typeof s.me === "number" ? no(s.me, "session_expired") : ok(s.me ?? ME)
    if (path === "/v1/me/tenant") return s.gone?.includes(h.get("x-tenant") ?? "") ? no(404, "not_found") : ok(tenantCtx(h.get("x-tenant") ?? ""))
    if (path === "/v1/entitlements") return ok(ENT)
    return no(404, "not_found")
  })
  vi.stubGlobal("fetch", fetchMock)
}
const get = (path: string, cookie = "") => new Request(`${APP}${path}`, { headers: cookie ? { cookie } : {} })
const post = (next: string | null, cookie = "", o: { origin?: string | null; site?: string; json?: boolean } = {}) => {
  const h: Record<string, string> = {}
  if (cookie) h.cookie = cookie
  if (o.origin !== null) h.origin = o.origin ?? APP
  if (o.site) h["sec-fetch-site"] = o.site
  const body = o.json ? JSON.stringify({ next }) : new URLSearchParams(next === null ? {} : { next }).toString()
  h["content-type"] = o.json ? "application/json" : "application/x-www-form-urlencoded"
  return new Request(`${APP}/api/session/tenant`, { method: "POST", headers: h, body })
}
const setCookies = (r: Response) => r.headers.getSetCookie()
const cleared = (r: Response, name: string) => setCookies(r).some((c) => c.startsWith(`${name}=;`) && /max-age=0|expires=thu, 01 jan 1970/i.test(c))

beforeEach(() => {
  vi.stubEnv("API_URL", API)
  vi.stubEnv("APP_ORIGIN", APP)
  vi.stubEnv("NODE_ENV", "production")
  script()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("T6.3 /api/session/expired: clears a dead session once, then lands on /sign-in (no loop)", () => {
  test("a cookie the API rejects: better-auth and od-tenant cookies are cleared, 303 to /sign-in?reason=expired", async () => {
    script({ me: 401 })
    const r = await expireSession(get("/api/session/expired", "better-auth.session_token=dead; better-auth.two_factor=x; od-tenant=alpha; od-theme=dark"))
    expect(r.status).toBe(303)
    expect(r.headers.get("location")).toBe(`${APP}/sign-in?reason=expired`)
    expect(cleared(r, "better-auth.session_token")).toBe(true)
    expect(cleared(r, "better-auth.two_factor")).toBe(true)
    expect(cleared(r, "od-tenant")).toBe(true)
    expect(setCookies(r).some((c) => c.startsWith("od-theme"))).toBe(false) // only ours and Better Auth's
    expect(r.headers.get("cache-control")).toMatch(/no-store/)
  })

  test("the https cookie names carry Secure and keep their __Secure- prefix", async () => {
    script({ me: 401 })
    const r = await expireSession(get("/api/session/expired", "__Secure-better-auth.session_token=dead"))
    const c = setCookies(r).find((x) => x.startsWith("__Secure-better-auth.session_token=;"))!
    expect(c).toMatch(/Secure/i)
    expect(c).toMatch(/HttpOnly/i)
    expect(c).toMatch(/Path=\//)
  })

  test("a session that is in fact valid is NOT cleared (a cross-site link must not sign anyone out): redirect home", async () => {
    const r = await expireSession(get("/api/session/expired", "better-auth.session_token=good; od-tenant=alpha"))
    expect(r.headers.get("location")).toBe(`${APP}/`)
    expect(setCookies(r)).toEqual([])
  })

  test("the API unreachable: nothing is cleared (it may be a blip), the visitor goes to /sign-in", async () => {
    script({ throws: true })
    const r = await expireSession(get("/api/session/expired", "better-auth.session_token=maybe"))
    expect(r.headers.get("location")).toBe(`${APP}/sign-in`)
    expect(setCookies(r)).toEqual([])
  })

  test("no session cookie at all: no API call, od-tenant cleared, /sign-in?reason=expired", async () => {
    const r = await expireSession(get("/api/session/expired", "od-tenant=alpha"))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.headers.get("location")).toBe(`${APP}/sign-in?reason=expired`)
    expect(cleared(r, "od-tenant")).toBe(true)
  })

  test("only allow-listed cookies go upstream", async () => {
    script({ me: 401 })
    await expireSession(get("/api/session/expired", "better-auth.session_token=dead; od-tenant=alpha; other=1"))
    expect(sent[0].cookie).toBe("better-auth.session_token=dead")
  })

  test("the redirect target is the configured web origin, not the request's own host", async () => {
    script({ me: 401 })
    const r = await expireSession(new Request("http://internal-host:3000/api/session/expired", { headers: { cookie: "better-auth.session_token=dead" } }))
    expect(r.headers.get("location")).toBe(`${APP}/sign-in?reason=expired`)
  })
})

describe("T6.3 /api/session/tenant: repairs a missing or stale od-tenant from the memberships the API confirms", () => {
  const C = "better-auth.session_token=tok"
  test("a stale cookie is replaced by the first membership (httpOnly, lax, secure in production, path /), then back to next", async () => {
    const r = await repairTenant(post(decodeURIComponent("%2Ftasks%3Fview%3Dboard"), `${C}; od-tenant=gone-co`))
    expect(r.status).toBe(303)
    expect(r.headers.get("location")).toBe(`${APP}/tasks?view=board`)
    const c = setCookies(r).find((x) => x.startsWith("od-tenant="))!
    expect(c).toMatch(/^od-tenant=alpha;/)
    expect(c).toMatch(/HttpOnly/i)
    expect(c).toMatch(/SameSite=lax/i)
    expect(c).toMatch(/Secure/i)
    expect(c).toMatch(/Path=\//)
    expect(c).not.toMatch(/Domain/i)
  })

  test("a missing cookie is set; a good cookie is left alone (no Set-Cookie)", async () => {
    expect(setCookies(await repairTenant(post(decodeURIComponent("%2F"), C))).some((c) => c.startsWith("od-tenant=alpha"))).toBe(true)
    const kept = await repairTenant(post(decodeURIComponent("%2Fsettings"), `${C}; od-tenant=bravo`))
    expect(setCookies(kept)).toEqual([])
    expect(kept.headers.get("location")).toBe(`${APP}/settings`)
  })

  test("it picks exactly what getSession would: a membership that 404s is skipped", async () => {
    script({ gone: ["alpha"] })
    const r = await repairTenant(post(decodeURIComponent("%2F"), `${C}; od-tenant=alpha`))
    expect(setCookies(r).find((x) => x.startsWith("od-tenant="))).toMatch(/^od-tenant=bravo;/)
  })

  test("next is a same-origin path only: //evil.com, https://evil.com, /\\evil.com and javascript: land on /", async () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/%2f/evil.com"]) {
      const r = await repairTenant(post(bad, `${C}; od-tenant=bravo`))
      expect(r.headers.get("location"), bad).toBe(`${APP}/`)
    }
  })

  test("no membership: staff to /platform, others to /onboarding, and the dead tenant cookie is cleared", async () => {
    script({ me: { ...ME, tenants: [], platformRole: "support" } })
    const staff = await repairTenant(post(decodeURIComponent("%2Ftasks"), `${C}; od-tenant=alpha`))
    expect(staff.headers.get("location")).toBe(`${APP}/platform`)
    expect(cleared(staff, "od-tenant")).toBe(true)
    script({ me: { ...ME, tenants: [] } })
    expect((await repairTenant(post(decodeURIComponent("%2Ftasks"), C))).headers.get("location")).toBe(`${APP}/onboarding`)
  })

  test("no membership + an invitation link (social sign-in lands here): the invitation is followed, not /onboarding; any other next is not", async () => {
    const invite = "/invite?token=db6467e9c5c643729ca8219e0559d659SyfaUkKYE5XA2jrfLo9sCOK25TBBOScdsl8b-zuHueg"
    script({ me: { ...ME, tenants: [] } })
    expect((await repairTenant(post(invite, C))).headers.get("location")).toBe(`${APP}${invite}`)
    expect((await repairTenant(post("/invite?token=a&x=1", C))).headers.get("location")).toBe(`${APP}/onboarding`)
  })

  test("an expired session clears the cookies and goes to /sign-in?reason=expired; no session goes to /sign-in", async () => {
    script({ me: 401 })
    const r = await repairTenant(post(decodeURIComponent("%2F"), `${C}; od-tenant=alpha`))
    expect(r.headers.get("location")).toBe(`${APP}/sign-in?reason=expired`)
    expect(cleared(r, "better-auth.session_token")).toBe(true)
    expect(cleared(r, "od-tenant")).toBe(true)
    script()
    expect((await repairTenant(post(decodeURIComponent("%2F"), "od-tenant=alpha"))).headers.get("location")).toBe(`${APP}/sign-in`)
  })

  test("the tenant sent upstream is a verified membership slug, never the raw cookie", async () => {
    await repairTenant(post(decodeURIComponent("%2F"), `${C}; od-tenant=evil-co`))
    const tenantCalls = sent.filter((s) => s.path === "/v1/me/tenant").map((s) => s.tenant)
    expect(tenantCalls).toEqual(["alpha"])
  })
})

describe("B7 T12: /api/session/tenant is a POST; the GET never writes", () => {
  const C = "better-auth.session_token=tok"
  test("GET sets no cookie, calls no API and answers a self-submitting same-origin form (a redirect target cannot POST)", async () => {
    const r = await repairTenantPage(get("/api/session/tenant?next=%2Ftasks%3Fview%3Dboard", `${C}; od-tenant=gone-co`))
    expect(r.status).toBe(200)
    expect(setCookies(r)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.headers.get("cache-control")).toMatch(/no-store/)
    const html = await r.text()
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/session\/tenant"/i)
    expect(html).toContain('name="next" value="/tasks?view=board"')
    expect(html).toMatch(/\.submit\(\)/)
    expect(html).toMatch(/<noscript>[\s\S]*<button/i)
  })
  test("GET with an unsafe next prints / in the form (never the attacker value, and the value is escaped)", async () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", '/"><script>alert(1)</script>']) {
      const html = await (await repairTenantPage(get(`/api/session/tenant?next=${encodeURIComponent(bad)}`))).text()
      expect(html, bad).not.toContain("evil.com")
      expect(html, bad).not.toContain("<script>alert")
    }
    expect(await (await repairTenantPage(get("/api/session/tenant?next=//evil.com"))).text()).toContain('name="next" value="/"')
  })
  test("POST sets the cookie for a membership slug only, then 303 to the validated next", async () => {
    const r = await repairTenant(post("/settings", `${C}; od-tenant=gone-co`))
    expect(r.status).toBe(303)
    expect(r.headers.get("location")).toBe(`${APP}/settings`)
    expect(setCookies(r).find((x) => x.startsWith("od-tenant="))).toMatch(/^od-tenant=alpha;/)
  })
  test("POST accepts a JSON body { next } too and rejects an absolute next", async () => {
    expect((await repairTenant(post("/tasks", `${C}; od-tenant=bravo`, { json: true }))).headers.get("location")).toBe(`${APP}/tasks`)
    expect((await repairTenant(post("https://evil.com/x", `${C}; od-tenant=bravo`, { json: true }))).headers.get("location")).toBe(`${APP}/`)
  })
  test("POST from another origin, with a cross-site fetch or with no Origin is refused 403 and writes nothing", async () => {
    for (const o of [{ origin: "https://evil.example" }, { site: "cross-site" }, { origin: null }]) {
      const r = await repairTenant(post("/", `${C}; od-tenant=gone-co`, o))
      expect(r.status, JSON.stringify(o)).toBe(403)
      expect(setCookies(r)).toEqual([])
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test("production with no known web origin refuses (fail closed)", async () => {
    vi.stubEnv("APP_ORIGIN", "")
    expect((await repairTenant(post("/", C))).status).toBe(403)
  })
})
