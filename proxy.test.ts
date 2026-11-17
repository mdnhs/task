import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"
import { config, proxy } from "@/proxy"

const APP = "https://app.example.com"
beforeEach(() => vi.stubEnv("APP_ORIGIN", APP))
afterEach(() => vi.unstubAllEnvs())

/** The negative-lookahead matcher, turned into a plain regex (it uses only the common subset of path-to-regexp). */
const lookahead = config.matcher.find((m) => m.includes("?!"))!
const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m.replace(/:path\*/, ".*")}$`).test(path))
const next = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new NextRequest(`${APP}${path}`, init)

describe("proxy matcher (B6 I7)", () => {
  test("it has the negative-lookahead matcher plus the /data entries", () => {
    expect(lookahead).toBeTruthy()
    expect(config.matcher).toEqual(expect.arrayContaining(["/data", "/data/:path*"]))
  })

  test("/v1/*, /api/*, _next and static files are not matched (the BFF handlers do their own checks); app pages and /data are", () => {
    for (const p of ["/v1/tasks", "/v1/me/tenant", "/api/auth/sign-in/email", "/_next/static/chunk.js", "/favicon.ico", "/logo.png"]) expect(matches(p), p).toBe(false)
    for (const p of ["/tasks", "/tasks/TSK-1042", "/", "/settings/users", "/data", "/data/tasks/tasks.json", "/sign-in", "/sign-up"]) expect(matches(p), p).toBe(true)
  })

  test("a path that merely starts with v1 is still an app path (only the /v1/ segment is excluded)", () => {
    expect(matches("/v1x")).toBe(true)
  })
})

describe("proxy: /data stays a 404, existing page redirect unchanged", () => {
  test("/data and /data/x.json are 404", () => {
    expect(proxy(next("/data")).status).toBe(404)
    expect(proxy(next("/data/tasks/tasks.json")).status).toBe(404)
  })

  test("T6.3: no Better Auth session cookie redirects pages to /sign-in with a safe next; the public auth pages are not redirected", () => {
    const r = proxy(next("/tasks?view=board"))
    expect(r.status).toBe(307)
    expect(r.headers.get("location")).toBe(`${APP}/sign-in?next=${encodeURIComponent("/tasks?view=board")}`)
    expect(proxy(next("/")).headers.get("location")).toBe(`${APP}/sign-in`)
    expect(proxy(next("/platform/tenants")).headers.get("location")).toContain("/sign-in")
    expect(proxy(next("/onboarding")).headers.get("location")).toContain("/sign-in") // needs a session; the page checks it for real
    for (const p of ["/sign-in", "/sign-up", "/forgot-password", "/verify-email", "/reset-password", "/verify-email/x"]) expect(proxy(next(p)).headers.get("location"), p).toBeNull()
  })

  test("T6.3: Next's _rsc marker is not carried into next", () => {
    const loc = proxy(next("/tasks?view=board&_rsc=abc12")).headers.get("location") ?? ""
    expect(new URL(loc).searchParams.get("next")).toBe("/tasks?view=board")
    expect(new URL(proxy(next("/tasks?_rsc=abc12")).headers.get("location") ?? "").searchParams.get("next")).toBe("/tasks")
  })

  test("T6.3: only the session cookie counts (the two_factor and dont_remember cookies and the old od-auth do not); the https name works too", () => {
    for (const cookie of ["better-auth.two_factor=x", "better-auth.dont_remember=1", "od-auth=in", "better-auth.session_token_x=1", "x-better-auth.session_token=1"]) {
      expect(proxy(next("/tasks", { headers: { cookie } })).headers.get("location"), cookie).toContain("/sign-in")
    }
    for (const cookie of ["better-auth.session_token=tok", "__Secure-better-auth.session_token=tok", "a=1; better-auth.session_token=tok"]) {
      expect(proxy(next("/tasks", { headers: { cookie } })).headers.get("location"), cookie).toBeNull()
    }
  })

  test("T6.3: a cookie that merely EXISTS is not authorisation: the proxy only lets the request reach the page, whose layout checks the session with the API", () => {
    const res = proxy(next("/tasks", { headers: { cookie: "better-auth.session_token=forged" } }))
    expect(res.status).toBe(200)
    expect(res.headers.get("x-middleware-request-x-od-path")).toBe("/tasks")
  })

  test("T6.3: a hostile path cannot smuggle an off-site next (it is encoded into the query, and the sign-in page validates it again)", () => {
    const loc = proxy(next("/%2F%2Fevil.com")).headers.get("location") ?? ""
    expect(new URL(loc).origin).toBe(APP)
    expect(new URL(loc).pathname).toBe("/sign-in")
  })

  test("a normal page request passes and carries the x-od-path headers", () => {
    const res = proxy(next("/tasks?view=board", { headers: { cookie: "better-auth.session_token=t" } }))
    expect(res.status).toBe(200)
    expect(res.headers.get("x-middleware-request-x-od-path")).toBe("/tasks")
    expect(res.headers.get("x-middleware-request-x-od-search")).toBe("?view=board")
  })
})

describe("proxy: Next server actions get an Origin check of their own (I6 layer 3, defence in depth)", () => {
  const action = (path: string, headers: Record<string, string> = {}) => next(path, { method: "POST", headers: { "next-action": "abc123", "content-type": "text/plain;charset=UTF-8", ...headers }, body: "[]" })

  test("a server action POST with a foreign Origin is 403, on app pages and on the public auth pages alike", () => {
    for (const p of ["/tasks", "/settings/users", "/sign-in", "/onboarding"]) {
      expect(proxy(action(p, { origin: "https://evil.example" })).status, p).toBe(403)
    }
  })

  test("a sibling subdomain, another port and 'null' are refused; the same origin passes", () => {
    for (const origin of ["https://evil.app.example.com", "https://app.example.com:8443", "null", "http://app.example.com"]) {
      expect(proxy(action("/tasks", { origin })).status, origin).toBe(403)
    }
    expect(proxy(action("/tasks", { origin: APP })).status).toBe(200)
  })

  test("a server action without Origin is refused (Next itself would let it through with a warning)", () => {
    expect(proxy(action("/tasks")).status).toBe(403)
  })

  test("Sec-Fetch-Site cross-site / same-site is refused even with the right Origin", () => {
    expect(proxy(action("/tasks", { origin: APP, "sec-fetch-site": "cross-site" })).status).toBe(403)
    expect(proxy(action("/tasks", { origin: APP, "sec-fetch-site": "same-site" })).status).toBe(403)
    expect(proxy(action("/tasks", { origin: APP, "sec-fetch-site": "same-origin" })).status).toBe(200)
  })

  test("a plain navigation POST or a GET with next-action is not an action: untouched", () => {
    expect(proxy(next("/tasks", { method: "POST", headers: { origin: "https://evil.example" }, body: "x" })).status).toBe(200)
    expect(proxy(next("/tasks", { headers: { "next-action": "x", origin: "https://evil.example", cookie: "better-auth.session_token=t" } })).status).toBe(200)
  })

  test("M4: in production an unset or invalid APP_ORIGIN refuses every server action (fail closed, like the BFF), whatever Origin and Host say", () => {
    vi.stubEnv("NODE_ENV", "production")
    for (const value of ["", "   ", "not a url", "ftp://app.example.com"]) {
      vi.stubEnv("APP_ORIGIN", value)
      const same = next("/tasks", { method: "POST", headers: { "next-action": "a", origin: APP, host: "app.example.com" }, body: "[]" })
      expect(proxy(same).status, `APP_ORIGIN=${JSON.stringify(value)}`).toBe(403)
      const fwd = next("/sign-in", { method: "POST", headers: { "next-action": "a", origin: APP, "x-forwarded-host": "app.example.com" }, body: "[]" })
      expect(proxy(fwd).status).toBe(403)
    }
    vi.stubEnv("APP_ORIGIN", APP)
    expect(proxy(next("/tasks", { method: "POST", headers: { "next-action": "a", origin: APP }, body: "[]" })).status).toBe(200)
  })

  test("with APP_ORIGIN unset (dev), the request's own Host is the reference", () => {
    vi.stubEnv("APP_ORIGIN", "")
    const same = next("/tasks", { method: "POST", headers: { "next-action": "a", origin: APP, host: "app.example.com" }, body: "[]" })
    expect(proxy(same).status).toBe(200)
    const other = next("/tasks", { method: "POST", headers: { "next-action": "a", origin: "https://evil.example", host: "app.example.com" }, body: "[]" })
    expect(proxy(other).status).toBe(403)
  })
})
