import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { rearmClientStoresOnce, registerClientStoreReset } from "@/lib/client-stores"
import { apiBrowser, browserGet, makeBrowserClient, setPageTenant } from "@/lib/api/browser"

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  setPageTenant(null)
})
afterEach(() => vi.unstubAllGlobals())
const sent = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers) }
}

describe("apiBrowser (the only API the browser has: same-origin /v1)", () => {
  test("calls go to the same origin (a relative /v1 URL), never to a host", async () => {
    await (apiBrowser as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    expect(sent().url).toBe("/v1/me")
  })

  test("x-od-tenant carries the tenant the page was rendered for; it is absent when no page tenant is set", async () => {
    await (apiBrowser as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    expect(sent().headers.has("x-od-tenant")).toBe(false)
    setPageTenant("acme")
    await (apiBrowser as unknown as { get(p: string): Promise<unknown> }).get("/v1/tasks")
    expect(sent().headers.get("x-od-tenant")).toBe("acme")
  })

  test("it can never set x-tenant, authorization or a cookie header itself", async () => {
    setPageTenant("acme")
    await (apiBrowser as unknown as { post(p: string, o?: unknown): Promise<unknown> }).post("/v1/tasks", { body: {} })
    const h = sent().headers
    expect(h.has("x-tenant")).toBe(false)
    expect(h.has("authorization")).toBe(false)
    expect(h.has("cookie")).toBe(false)
  })

  test("credentials are same-origin and the cache is off", async () => {
    await (apiBrowser as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    expect(sent().init.credentials).toBe("same-origin")
    expect(sent().init.cache).toBe("no-store")
  })

  test("setPageTenant ignores a value that is not a slug", async () => {
    setPageTenant("Not A Slug")
    await (apiBrowser as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    expect(sent().headers.has("x-od-tenant")).toBe(false)
  })
})

describe("T6.3 a client mutation that gets 401: one toast, one redirect (no pile-up from parallel calls)", () => {
  const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r1" }), { status, headers: { "content-type": "application/problem+json" } })
  const post = (api: ReturnType<typeof makeBrowserClient>) => (api as unknown as { post(p: string, o?: unknown): Promise<unknown> }).post("/v1/tasks", { body: {} })

  test("401 session_expired or unauthenticated calls onSessionExpired once, however many calls fail, and each call still rejects", async () => {
    const onSessionExpired = vi.fn()
    const f = vi.fn(async () => problem(401, "session_expired"))
    const api = makeBrowserClient({ fetch: f as never, onSessionExpired })
    const results = await Promise.allSettled([post(api), post(api), post(api)])
    expect(results.every((r) => r.status === "rejected")).toBe(true)
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    await post(api).catch(() => {})
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    const other = makeBrowserClient({ fetch: (async () => problem(401, "unauthenticated")) as never, onSessionExpired })
    await post(other).catch(() => {})
    expect(onSessionExpired).toHaveBeenCalledTimes(2) // a fresh client is a fresh page: its own single redirect
  })

  test("the 401 problem body is still the error the caller sees (status and code), not swallowed by the guard", async () => {
    const api = makeBrowserClient({ fetch: (async () => problem(401, "session_expired")) as never, onSessionExpired: vi.fn() })
    await expect(post(api)).rejects.toMatchObject({ status: 401, code: "session_expired" })
  })

  test("a 401 that is an MFA challenge is NOT a dead session (the step-up handles it), nor is 403, 404, 409 or 500", async () => {
    const onSessionExpired = vi.fn()
    for (const [status, code] of [[401, "mfa_challenge"], [401, "mfa_enrolment_required"], [403, "mfa_required"], [403, "forbidden"], [404, "not_found"], [409, "version_conflict"], [500, "internal"]] as const) {
      await post(makeBrowserClient({ fetch: (async () => problem(status, code)) as never, onSessionExpired })).catch(() => {})
    }
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  test("a 401 whose body is not JSON (a proxy page) still counts as an expired session", async () => {
    const onSessionExpired = vi.fn()
    const api = makeBrowserClient({ fetch: (async () => new Response("<html>401</html>", { status: 401 })) as never, onSessionExpired })
    await post(api).catch(() => {})
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
  })

  test("the default handler toasts once and sends the page to the cookie-clearing route", async () => {
    const assign = vi.fn()
    vi.stubGlobal("window", { location: { assign } })
    const toast = await import("sonner")
    const spy = vi.spyOn(toast.toast, "error").mockImplementation(() => "id" as never)
    const api = makeBrowserClient({ fetch: (async () => problem(401, "session_expired")) as never })
    await Promise.allSettled([post(api), post(api)])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith("/api/session/expired")
    spy.mockRestore()
  })
})

describe("B7 T12: a session killed on another device clears the stores of this one", () => {
  const body = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r" }), { status, headers: { "content-type": "application/problem+json" } })
  const reset = vi.fn()
  beforeEach(() => { rearmClientStoresOnce(); reset.mockReset() })
  registerClientStoreReset(() => reset())

  test("the next call that answers 401 session_expired clears the stores once, however many calls fail together", async () => {
    const handler = vi.fn()
    const c = makeBrowserClient({ fetch: (async () => body(401, "session_expired")) as never, onSessionExpired: handler }) as unknown as { get(p: string): Promise<unknown> }
    await Promise.all([c.get("/v1/a"), c.get("/v1/b"), c.get("/v1/c")].map((p) => p.catch(() => undefined)))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test("an MFA challenge and a 403 do not clear anything", async () => {
    for (const [s, code] of [[401, "mfa_challenge"], [403, "forbidden"]] as const) {
      const c = makeBrowserClient({ fetch: (async () => body(s, code)) as never, onSessionExpired: vi.fn() }) as unknown as { get(p: string): Promise<unknown> }
      await c.get("/v1/a").catch(() => undefined)
    }
    expect(reset).not.toHaveBeenCalled()
  })
})

describe("browserGet (a file through the BFF, B8 Task 22)", () => {
  test("a relative /v1 GET with the page tenant, same-origin cookies and no-store; the raw Response comes back unread; anything but /v1 is refused before a request", async () => {
    setPageTenant("acme")
    fetchMock.mockResolvedValueOnce(new Response("BEGIN:VCALENDAR", { status: 200, headers: { "content-type": "text/calendar", "content-disposition": "attachment" } }))
    const res = await browserGet("/v1/roster/mine.ics?from=2026-11-16")
    expect(sent().url).toBe("/v1/roster/mine.ics?from=2026-11-16")
    expect(sent().headers.get("x-od-tenant")).toBe("acme")
    expect(sent().init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" })
    expect(res.headers.get("content-disposition")).toBe("attachment")
    expect(() => browserGet("https://api.example.com/v1/roster/mine.ics")).toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
