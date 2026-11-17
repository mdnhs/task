import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// next/headers is the request scope; server-only is a build-time marker that throws outside a server graph.
const jar = new Map<string, string>()
let incoming = new Headers()
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => incoming,
}))

import { apiServer } from "@/lib/api/server"

const APP = "https://app.example.com"
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  jar.clear()
  incoming = new Headers()
  vi.stubEnv("API_URL", "http://api.internal:3001")
  vi.stubEnv("APP_ORIGIN", APP)
  vi.stubEnv("NODE_ENV", "production")
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const sent = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers) }
}

describe("apiServer (server components and server actions call API_URL directly)", () => {
  test("apiServer sets Origin on POST/PUT/PATCH/DELETE, never forwards a client x-tenant, and uses cache no-store", async () => {
    jar.set("od-tenant", "acme")
    jar.set("better-auth.session_token", "tok")
    incoming = new Headers({ "x-tenant": "victim-co", "x-od-tenant": "victim-co", authorization: "Bearer odk_x", origin: "https://evil.example" })
    const api = await apiServer()
    for (const m of ["post", "put", "patch", "delete"] as const) {
      await (api as unknown as Record<string, (p: string, o?: unknown) => Promise<unknown>>)[m]("/v1/tasks/x", { body: {} })
      const { headers, init } = sent()
      expect(headers.get("origin"), m).toBe(APP)
      expect(headers.get("x-tenant"), m).toBe("acme")
      expect(headers.get("authorization"), m).toBeNull()
      expect([...headers.keys()].some((k) => k.startsWith("x-od-")), m).toBe(false)
      expect(init.cache, m).toBe("no-store")
    }
    await (api as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    expect(sent().headers.has("origin")).toBe(false)
    expect(sent().url).toBe("http://api.internal:3001/v1/me")
    expect(sent().init.cache).toBe("no-store")
  })

  test("only allow-listed cookies are replayed; od-tenant stays out of the Cookie header and becomes X-Tenant", async () => {
    jar.set("od-tenant", "acme")
    jar.set("better-auth.session_token", "tok")
    jar.set("__Host-od-device-1a2b3c4d", "dev")
    jar.set("od-role", "owner")
    jar.set("_ga", "1")
    await (await apiServer() as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    const h = sent().headers
    expect(h.get("cookie")).toBe("better-auth.session_token=tok; __Host-od-device-1a2b3c4d=dev")
    expect(h.get("x-tenant")).toBe("acme")
  })

  test("an invalid tenant cookie sends no X-Tenant; a request id is generated; the user agent and client IP chain are passed on", async () => {
    jar.set("od-tenant", "Not A Slug")
    incoming = new Headers({ "user-agent": "Mozilla/5.0 Test", "x-forwarded-for": "203.0.113.9" })
    await (await apiServer() as unknown as { get(p: string): Promise<unknown> }).get("/v1/me")
    const h = sent().headers
    expect(h.get("x-tenant")).toBeNull()
    expect(h.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
    expect(h.get("user-agent")).toBe("Mozilla/5.0 Test")
    expect(h.get("x-forwarded-for")).toBe("203.0.113.9")
  })

  test("a problem answer becomes an ApiError (the status and code survive, the title does not)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ type: "about:blank", title: "Not Found", status: 404, code: "not_found", requestId: "r-1" }), { status: 404, headers: { "content-type": "application/problem+json" } }))
    const e = await (await apiServer() as unknown as { get(p: string): Promise<unknown> }).get("/v1/tasks/x").catch((x: unknown) => x)
    expect(e).toMatchObject({ status: 404, code: "not_found", requestId: "r-1" })
  })
})
