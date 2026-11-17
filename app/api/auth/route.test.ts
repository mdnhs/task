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

describe("app/api/auth/[...path]/route.ts", () => {
  test("exports exactly GET, POST, PUT, PATCH and DELETE", () => {
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k)).sort()).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"])
  })

  test("sign-in is forwarded with Origin set to the web origin, and its cookies come back unchanged", async () => {
    const h = new Headers({ "content-type": "application/json" })
    h.append("set-cookie", "better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax")
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: h }))
    const res = await route.POST(new Request(`${APP}/api/auth/sign-in/email`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.ie", password: "x" }) }))
    expect(res.headers.getSetCookie()).toEqual(["better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax"])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://api.internal:3001/api/auth/sign-in/email")
    expect(new Headers(init.headers).get("origin")).toBe(APP)
  })

  test("/api/auth/list-sessions is a 404 for GET and POST and never reaches the API", async () => {
    expect((await route.GET(new Request(`${APP}/api/auth/list-sessions`))).status).toBe(404)
    expect((await route.POST(new Request(`${APP}/api/auth/list-sessions`, { method: "POST", headers: { origin: APP }, body: "{}" }))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("a cross-origin sign-in POST is refused (login CSRF)", async () => {
    const res = await route.POST(new Request(`${APP}/api/auth/sign-in/email`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("a path outside /api/auth/ is not reachable here", async () => {
    expect((await route.GET(new Request(`${APP}/api/auth/../../healthz`))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
