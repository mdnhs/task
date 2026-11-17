import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import * as route from "./[...path]/route"

const APP = "https://app.example.com"
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.internal:3001")
  vi.stubEnv("APP_ORIGIN", APP)
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("app/v1/[...path]/route.ts", () => {
  test("exports exactly GET, POST, PUT, PATCH and DELETE (nothing else is reachable)", () => {
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k)).sort()).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"])
  })

  test("a GET goes to API_URL/v1/... with the tenant from the cookie", async () => {
    const res = await route.GET(new Request(`${APP}/v1/tasks`, { headers: { cookie: "od-tenant=acme; better-auth.session_token=t" } }))
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://api.internal:3001/v1/tasks")
    expect(new Headers(init.headers).get("x-tenant")).toBe("acme")
  })

  test("a cross-origin POST is refused here, before the API", async () => {
    const res = await route.POST(new Request(`${APP}/v1/tasks`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("the Stripe webhook is not reachable through /v1 (it lives on the API host)", async () => {
    const res = await route.POST(new Request(`${APP}/webhooks/billing/stripe`, { method: "POST", headers: { origin: APP }, body: "{}" }))
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
