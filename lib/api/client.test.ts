import { describe, expect, test, vi } from "vitest"
import { makeApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init })
// The generated `paths` are checked by tsc; here the runtime is exercised with loosely typed calls.
type Loose = { get(p: string, o?: unknown): Promise<unknown>; post(p: string, o?: unknown): Promise<unknown>; put(p: string, o?: unknown): Promise<unknown>; patch(p: string, o?: unknown): Promise<unknown>; delete(p: string, o?: unknown): Promise<unknown> }
const make = (fetch: typeof globalThis.fetch, extra: Parameters<typeof makeApiClient>[0] extends infer O ? Partial<O> : never = {}) => makeApiClient({ baseUrl: "http://api.test", fetch, ...extra }) as unknown as Loose

describe("makeApiClient", () => {
  test("fills path params (URL-encoded), serialises the query (arrays repeat, undefined is skipped) and parses JSON", async () => {
    const fetch = vi.fn(async () => json({ ok: 1 }))
    const api = make(fetch as never)
    await expect(api.get("/v1/tasks/{id}", { path: { id: "a b/c" }, query: { limit: 5, status: ["x", "y"], q: undefined, flag: false } })).resolves.toEqual({ ok: 1 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://api.test/v1/tasks/a%20b%2Fc?limit=5&status=x&status=y&flag=false")
    expect(init.method).toBe("GET")
    expect(new Headers(init.headers).get("accept")).toBe("application/json")
    expect(init.body).toBeUndefined()
  })

  test("a body is sent as JSON with a content-type; every verb maps to its method", async () => {
    const fetch = vi.fn(async () => json({}))
    const api = make(fetch as never)
    await api.post("/v1/x", { body: { a: 1 } })
    await api.put("/v1/x", { body: { a: 2 } })
    await api.patch("/v1/x", { body: { a: 3 } })
    await api.delete("/v1/x")
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([, i]) => i.method)).toEqual(["POST", "PUT", "PATCH", "DELETE"])
    expect(calls[0][1].body).toBe('{"a":1}')
    expect(new Headers(calls[0][1].headers).get("content-type")).toBe("application/json")
    expect(calls[3][1].body).toBeUndefined()
  })

  test("a missing path param is a programming error (throws before any request)", async () => {
    const fetch = vi.fn(async () => json({}))
    await expect(make(fetch as never).get("/v1/tasks/{id}", {})).rejects.toThrow(/id/)
    expect(fetch).not.toHaveBeenCalled()
  })

  test("204 resolves undefined; a non-2xx problem becomes an ApiError with status, code and requestId", async () => {
    const api = make((async (u: string) => (u.endsWith("/ok") ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, code: "version_conflict", requestId: "r-1" }), { status: 409, headers: { "content-type": "application/problem+json" } }))) as never)
    await expect(api.delete("/v1/ok")).resolves.toBeUndefined()
    const e = await api.patch("/v1/tasks/x", { body: {} }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ status: 409, code: "version_conflict", requestId: "r-1" })
  })

  test("a network failure is not wrapped: the TypeError reaches the caller (classifyApiError -> network)", async () => {
    const api = make((async () => { throw new TypeError("fetch failed") }) as never)
    await expect(api.get("/v1/me")).rejects.toBeInstanceOf(TypeError)
  })

  test("the headers callback is asked per request with the method; its headers are sent", async () => {
    const fetch = vi.fn(async () => json({}))
    const seen: string[] = []
    const api = make(fetch as never, { headers: async ({ method }: { method: string }) => { seen.push(method); return new Headers({ "x-test": "1", origin: "http://web" }) } } as never)
    await api.post("/v1/x", { body: {} })
    expect(seen).toEqual(["POST"])
    const h = new Headers(((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).headers)
    expect(h.get("x-test")).toBe("1")
    expect(h.get("origin")).toBe("http://web")
  })

  test("signal and cache options are passed to fetch", async () => {
    const fetch = vi.fn(async () => json({}))
    const ac = new AbortController()
    await make(fetch as never, { cache: "no-store" } as never).get("/v1/me", { signal: ac.signal })
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBe(ac.signal)
    expect(init.cache).toBe("no-store")
  })
})
