import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { forwardToApi } from "@/lib/api/bff"

const APP = "https://app.example.com"
const API = "http://api.internal:3001"
const V1 = { prefix: "/v1" } as const
const AUTH = { prefix: "/api/auth" } as const

let fetchMock: ReturnType<typeof vi.fn>
const upstream = (init?: ResponseInit & { body?: BodyInit | null }) => new Response(init?.body ?? JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" }, ...init })
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers) }
}
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => new Request(`${APP}${path}`, init)
const post = (path: string, headers: Record<string, string> = {}, body: BodyInit | null = JSON.stringify({ a: 1 })) =>
  req(path, { method: "POST", headers: { "content-type": "application/json", origin: APP, ...headers }, body })
const problemOf = async (res: Response) => ({ res, body: (await res.json()) as Record<string, unknown> })

beforeEach(() => {
  vi.stubEnv("API_URL", API)
  vi.stubEnv("APP_ORIGIN", APP)
  vi.stubEnv("NODE_ENV", "production")
  fetchMock = vi.fn(async () => upstream())
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("tenant and header rules (I5)", () => {
  test("bff drops x-tenant, authorization and x-od-* from the browser and sets x-tenant from the od-tenant cookie", async () => {
    await forwardToApi(
      req("/v1/tasks?limit=5", {
        headers: {
          cookie: "od-tenant=acme; better-auth.session_token=tok",
          "x-tenant": "victim-co",
          authorization: "Bearer odk_abcdefgh_" + "x".repeat(43),
          "x-od-tenant": "acme",
          "x-od-admin": "1",
          host: "evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http",
          "x-forwarded-for": "203.0.113.9",
          accept: "application/json",
        },
      }),
      V1,
    )
    const { url, headers } = lastCall()
    expect(url).toBe(`${API}/v1/tasks?limit=5`)
    expect(headers.get("x-tenant")).toBe("acme")
    expect(headers.get("authorization")).toBeNull()
    expect([...headers.keys()].filter((k) => k.startsWith("x-od-"))).toEqual([])
    expect(headers.get("host")).toBeNull()
    expect(headers.get("x-forwarded-host")).toBeNull()
    expect(headers.get("x-forwarded-proto")).toBeNull()
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9")
    expect(headers.get("accept")).toBe("application/json")
  })

  test("a client x-tenant is dropped even when there is no tenant cookie: the call carries no tenant at all", async () => {
    await forwardToApi(req("/v1/me", { headers: { "x-tenant": "victim-co", cookie: "better-auth.session_token=tok" } }), V1)
    expect(lastCall().headers.get("x-tenant")).toBeNull()
  })

  test("a tenant cookie that is not a valid slug is ignored (no header injection through the cookie)", async () => {
    for (const bad of ["ACME", "a", "../x", "acme%0d%0ax-evil:1", "-acme", "x".repeat(60)]) {
      fetchMock.mockClear()
      await forwardToApi(req("/v1/me", { headers: { cookie: `od-tenant=${bad}` } }), V1)
      expect(lastCall().headers.get("x-tenant"), bad).toBeNull()
    }
  })

  test("bff forwards only better-auth, __Secure-better-auth and __Host-od-device cookies; od-tenant and anything else stay home", async () => {
    await forwardToApi(
      req("/v1/me", { headers: { cookie: "better-auth.session_token=a; __Secure-better-auth.session_token=b; __Host-od-device-1a2b3c4d=c; od-tenant=acme; od-role=owner; _ga=1" } }),
      V1,
    )
    expect(lastCall().headers.get("cookie")).toBe("better-auth.session_token=a; __Secure-better-auth.session_token=b; __Host-od-device-1a2b3c4d=c")
  })

  test("no allow-listed cookie means no Cookie header at all", async () => {
    await forwardToApi(req("/v1/me", { headers: { cookie: "od-tenant=acme; _ga=1" } }), V1)
    expect(lastCall().headers.has("cookie")).toBe(false)
  })

  test("bff: stale x-od-tenant (page tenant != cookie) -> 409 tenant_changed and no upstream call", async () => {
    const { res, body } = await problemOf(await forwardToApi(req("/v1/tasks", { headers: { cookie: "od-tenant=beta", "x-od-tenant": "acme" } }), V1))
    expect(res.status).toBe(409)
    expect(res.headers.get("content-type")).toMatch(/application\/problem\+json/)
    expect(body).toMatchObject({ status: 409, code: "tenant_changed", type: "about:blank" })
    expect(typeof body.requestId).toBe("string")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("x-od-tenant with no tenant cookie at all is also tenant_changed; a matching one passes; none at all passes", async () => {
    expect((await forwardToApi(req("/v1/tasks", { headers: { "x-od-tenant": "acme" } }), V1)).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await forwardToApi(req("/v1/tasks", { headers: { cookie: "od-tenant=acme", "x-od-tenant": "acme" } }), V1)).status).toBe(200)
    expect((await forwardToApi(req("/v1/tasks", { headers: { cookie: "od-tenant=acme" } }), V1)).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("a valid client x-request-id is kept for correlation; a hostile one is replaced", async () => {
    await forwardToApi(req("/v1/me", { headers: { "x-request-id": "web-abc_123" } }), V1)
    expect(lastCall().headers.get("x-request-id")).toBe("web-abc_123")
    await forwardToApi(req("/v1/me", { headers: { "x-request-id": "a b;x-evil: 1" } }), V1)
    expect(lastCall().headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
    await forwardToApi(req("/v1/me"), V1)
    expect(lastCall().headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe("CSRF (I6 layer 1)", () => {
  test("a non-GET with a foreign Origin -> 403 bad_origin, nothing is sent upstream", async () => {
    const { res, body } = await problemOf(await forwardToApi(post("/v1/tasks", { origin: "https://evil.example" }), V1))
    expect(res.status).toBe(403)
    expect(body.code).toBe("bad_origin")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("a sibling subdomain, another port, another scheme, 'null' and a missing Origin are all refused", async () => {
    for (const origin of ["https://evil.app.example.com", "https://app.example.com.evil.example", "https://app.example.com:8443", "http://app.example.com", "null", "https://example.com"]) {
      expect((await forwardToApi(post("/v1/tasks", { origin }), V1)).status, origin).toBe(403)
    }
    const noOrigin = new Request(`${APP}/v1/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    expect((await forwardToApi(noOrigin, V1)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("Sec-Fetch-Site cross-site or same-site is refused even when Origin looks right; same-origin passes", async () => {
    expect((await forwardToApi(post("/v1/tasks", { "sec-fetch-site": "cross-site" }), V1)).status).toBe(403)
    expect((await forwardToApi(post("/v1/tasks", { "sec-fetch-site": "same-site" }), V1)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await forwardToApi(post("/v1/tasks", { "sec-fetch-site": "same-origin" }), V1)).status).toBe(200)
  })

  test("a same-origin POST passes and the upstream call carries Origin: APP_ORIGIN (Better Auth needs it)", async () => {
    expect((await forwardToApi(post("/v1/tasks"), V1)).status).toBe(200)
    expect(lastCall().headers.get("origin")).toBe(APP)
    expect(lastCall().init.method).toBe("POST")
  })

  test("a GET without Origin passes and carries none upstream; a GET with a foreign Origin is not checked", async () => {
    await forwardToApi(req("/v1/me"), V1)
    expect(lastCall().headers.has("origin")).toBe(false)
    expect((await forwardToApi(req("/v1/me", { headers: { origin: "https://evil.example" } }), V1)).status).toBe(200)
  })

  test("PUT, PATCH and DELETE are checked like POST", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const r = new Request(`${APP}/v1/x`, { method, headers: { origin: "https://evil.example" } })
      expect((await forwardToApi(r, V1)).status, method).toBe(403)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("APP_ORIGIN with a path or trailing slash is normalised to an origin", async () => {
    vi.stubEnv("APP_ORIGIN", `${APP}/`)
    expect((await forwardToApi(post("/v1/tasks"), V1)).status).toBe(200)
  })

  test("the BFF is fail-closed without APP_ORIGIN in production: a 500 problem, no upstream call, no detail", async () => {
    vi.stubEnv("APP_ORIGIN", "")
    const { res, body } = await problemOf(await forwardToApi(post("/v1/tasks"), V1))
    expect(res.status).toBe(500)
    expect(body.code).toBe("internal")
    expect(JSON.stringify(body)).not.toMatch(/APP_ORIGIN|API_URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("path rules", () => {
  test.each([
    ["/healthz", V1],
    ["/readyz", V1],
    ["/v1/../healthz", V1],
    ["/v1/%2e%2e/healthz", V1],
    ["/v1/%2E%2E/healthz", V1],
    ["/v1/a%2f..%2f..%2fhealthz", V1],
    ["/v1/a%5c..%5chealthz", V1],
    ["//evil", V1],
    ["//evil.example/v1/me", V1],
    ["/v1//me", V1],
    ["/v1", V1],
    ["/v1x/me", V1],
    ["/webhooks/billing/stripe", V1],
    ["/v1/me", AUTH],
    ["/api/auth/../../healthz", AUTH],
    ["/api/authx/sign-in", AUTH],
    ["/healthz", AUTH],
  ] as const)("bff refuses %s (prefix %j): 404, no upstream call", async (path, opts) => {
    const res = await forwardToApi(req(path), opts)
    expect([400, 404]).toContain(res.status)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("the BFF refuses a raw request whose URL still holds a dot segment (a caller that bypasses URL normalisation)", async () => {
    const raw = { method: "GET", url: `${APP}/v1/../healthz`, headers: new Headers(), body: null, signal: new AbortController().signal } as unknown as Request
    expect([400, 404]).toContain((await forwardToApi(raw, V1)).status)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("/api/auth/list-sessions (it returns raw session tokens) is a 404 in every spelling", async () => {
    for (const p of ["/api/auth/list-sessions", "/api/auth/list-sessions/", "/api/auth/LIST-SESSIONS", "/api/auth/list-sessions?x=1"]) {
      const res = await forwardToApi(req(p), { ...AUTH, deny: /^\/api\/auth\/list-sessions\/?$/i })
      expect(res.status, p).toBe(404)
    }
    expect((await forwardToApi(post("/api/auth/list-sessions"), AUTH)).status).toBe(404) // built in: the route handler cannot forget the deny rule
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("the real path is forwarded as is, query included, onto API_URL only", async () => {
    await forwardToApi(req("/api/auth/verify-email?token=abc%2Bdef&x=1"), AUTH)
    expect(lastCall().url).toBe(`${API}/api/auth/verify-email?token=abc%2Bdef&x=1`)
    await forwardToApi(req("/v1/tasks/6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8/history"), V1)
    expect(lastCall().url).toBe(`${API}/v1/tasks/6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8/history`)
  })

  test("only GET POST PUT PATCH DELETE are forwarded (HEAD, OPTIONS and other verbs are 405)", async () => {
    for (const method of ["HEAD", "OPTIONS", "PROPFIND"]) {
      const r = await forwardToApi(new Request(`${APP}/v1/me`, { method }), V1)
      expect(r.status, method).toBe(405)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("redirects and cookies coming back", () => {
  test("bff does not follow redirects: a 302 to a presigned URL and the Google callback 302 reach the browser", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://bucket.r2.example/u/file?X-Amz-Signature=abc" } }))
    const a = await forwardToApi(req("/v1/files/abc/download"), V1)
    expect(a.status).toBe(302)
    expect(a.headers.get("location")).toBe("https://bucket.r2.example/u/file?X-Amz-Signature=abc")
    expect(lastCall().init.redirect).toBe("manual")
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `${APP}/settings/integrations?connected=google` } }))
    const b = await forwardToApi(req("/v1/integrations/google/callback?code=1&state=2", { headers: { cookie: "better-auth.session_token=t" } }), V1)
    expect(b.status).toBe(302)
    expect(b.headers.get("location")).toBe(`${APP}/settings/integrations?connected=google`)
  })

  test("bff copies several Set-Cookie headers separately and unchanged (httpOnly, SameSite, Secure, __Host- prefix intact)", async () => {
    const cookies = [
      "better-auth.session_token=abc.def; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax",
      "__Secure-better-auth.session_data=xyz; Path=/; Secure; HttpOnly; SameSite=Lax",
      "__Host-od-device-1a2b3c4d=sig.val; Max-Age=34560000; Path=/; Secure; HttpOnly; SameSite=Lax",
    ]
    const h = new Headers({ "content-type": "application/json" })
    for (const c of cookies) h.append("set-cookie", c)
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: h }))
    const res = await forwardToApi(post("/api/auth/sign-in/email"), AUTH)
    expect(res.headers.getSetCookie()).toEqual(cookies)
  })

  test("an upstream attempt to set the BFF-owned od-tenant cookie is dropped", async () => {
    const h = new Headers()
    h.append("set-cookie", "od-tenant=victim; Path=/")
    h.append("set-cookie", "better-auth.session_token=a; HttpOnly; Path=/")
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: h }))
    const res = await forwardToApi(req("/v1/me"), V1)
    expect(res.headers.getSetCookie()).toEqual(["better-auth.session_token=a; HttpOnly; Path=/"])
  })

  test("hop-by-hop and encoding headers are not copied back; content-type and x-request-id are; no-store is set", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-request-id": "up-1", "content-encoding": "gzip", "transfer-encoding": "chunked", connection: "keep-alive", "x-powered-by": "hono" } }))
    const res = await forwardToApi(req("/v1/me"), V1)
    expect(res.headers.get("x-request-id")).toBe("up-1")
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(res.headers.get("content-encoding")).toBeNull()
    expect(res.headers.get("connection")).toBeNull()
    expect(res.headers.get("x-powered-by")).toBeNull()
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
})

describe("errors (no internals leak)", () => {
  const UP = "ECONNREFUSED 10.0.0.5:3001 pg password=hunter2"

  test("bff maps an unreachable upstream, a 502 and a non-problem 500 to 502 upstream_unavailable problem+json with no upstream text and a fresh request id", async () => {
    const seen = new Set<string>()
    const cases: (() => Response | Promise<Response>)[] = [
      () => { throw new TypeError(`fetch failed: ${UP}`) },
      () => new Response(`<html>nginx upstream says ${UP}</html>`, { status: 502, headers: { "content-type": "text/html", "x-request-id": "up-502" } }),
      () => new Response(`Error: ${UP}`, { status: 500, headers: { "content-type": "text/plain", "x-request-id": "up-500" } }),
      () => new Response(`<html>${UP}</html>`, { status: 503 }),
      () => new Response(JSON.stringify({ code: "internal", requestId: "x" }), { status: 502, headers: { "content-type": "application/problem+json" } }),
    ]
    for (const c of cases) {
      fetchMock.mockImplementationOnce(async () => c())
      const { res, body } = await problemOf(await forwardToApi(req("/v1/tasks", { headers: { "x-request-id": "client-1" } }), V1))
      expect(res.status).toBe(502)
      expect(res.headers.get("content-type")).toMatch(/application\/problem\+json/)
      expect(body).toMatchObject({ type: "about:blank", status: 502, code: "upstream_unavailable" })
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|hunter2|nginx|html/i)
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
      expect(body.requestId).not.toBe("client-1")
      expect(res.headers.get("x-request-id")).toBe(body.requestId)
      seen.add(String(body.requestId))
    }
    expect(seen.size).toBe(cases.length)
  })

  test("a real problem body passes through untouched: status, body and the API's request id (404, 409, 422, and a 500 problem)", async () => {
    for (const status of [404, 409, 422, 500]) {
      const text = JSON.stringify({ type: "about:blank", title: "X", status, code: "some_code", requestId: `api-${status}`, errors: [{ path: "a" }] })
      fetchMock.mockResolvedValueOnce(new Response(text, { status, headers: { "content-type": "application/problem+json", "x-request-id": `api-${status}` } }))
      const res = await forwardToApi(req("/v1/tasks/x"), V1)
      expect(res.status).toBe(status)
      expect(await res.text()).toBe(text)
      expect(res.headers.get("x-request-id")).toBe(`api-${status}`)
    }
  })

  test("a 4xx without a problem body (Better Auth JSON) is passed through: it is the API's answer, not a failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }), { status: 401, headers: { "content-type": "application/json" } }))
    const res = await forwardToApi(post("/api/auth/sign-in/email"), AUTH)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" })
  })

  test("a missing API_URL is a 500 problem with no detail and no upstream call", async () => {
    vi.stubEnv("API_URL", "")
    const { res, body } = await problemOf(await forwardToApi(req("/v1/me"), V1))
    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toMatch(/API_URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("body cap and timeout", () => {
  const MIB2 = 2 * 1024 * 1024

  test("bff caps a body at 2 MiB (413): by Content-Length before reading, and by counting a stream with no length", async () => {
    const big = "x".repeat(MIB2 + 1)
    const a = await forwardToApi(post("/v1/tasks", {}, big), V1)
    expect(a.status).toBe(413)
    expect(((await a.json()) as { code: string }).code).toBe("payload_too_large")
    expect(fetchMock).not.toHaveBeenCalled()
    const chunk = new Uint8Array(512 * 1024).fill(97)
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(chunk); c.close() } })
    const r = new Request(`${APP}/v1/tasks`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit)
    expect((await forwardToApi(r, V1)).status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("exactly 2 MiB is forwarded, byte for byte", async () => {
    const exact = "y".repeat(MIB2)
    expect((await forwardToApi(post("/v1/tasks", {}, exact), V1)).status).toBe(200)
    const sent = lastCall().init.body as Uint8Array
    expect(new TextDecoder().decode(sent)).toBe(exact)
  })

  test("a GET has no body; a POST with no body is forwarded without one", async () => {
    await forwardToApi(req("/v1/me"), V1)
    expect(lastCall().init.body ?? undefined).toBeUndefined()
    await forwardToApi(new Request(`${APP}/v1/tasks/x/archive`, { method: "POST", headers: { origin: APP } }), V1)
    expect(lastCall().init.body ?? undefined).toBeUndefined()
  })

  test("bff times out after 30 s: the upstream call is aborted and the answer is the generic 502", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason ?? new DOMException("aborted", "AbortError")))))
    const p = forwardToApi(req("/v1/tasks"), V1)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    const res = await p
    expect(res.status).toBe(502)
    expect(((await res.json()) as { code: string }).code).toBe("upstream_unavailable")
  })

  test("the browser going away aborts the upstream call", async () => {
    const ac = new AbortController()
    let upstreamSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_res, rej) => { upstreamSignal = init.signal as AbortSignal; if (upstreamSignal.aborted) return rej(new DOMException("aborted", "AbortError")); upstreamSignal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))) }))
    const p = forwardToApi(new Request(`${APP}/v1/tasks`, { signal: ac.signal }), V1)
    await Promise.resolve()
    await Promise.resolve()
    ac.abort()
    await p
    expect(upstreamSignal?.aborted).toBe(true)
  })
})
