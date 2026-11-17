import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { apiBrowser, setPageTenant } from "@/lib/api/browser"

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
