import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { forwardToApi } from "@/lib/api/bff"
import { makeApiClient } from "@/lib/api/client"
import { classifyApiError } from "@/lib/api/problem"
import { fetchTemplate, putTemplate } from "@/lib/report-template"
import { resetDb } from "../../api/test/harness"
import { world } from "../../api/src/modules/shift-reports/world"

vi.mock("server-only", () => ({}))

const ORIGIN = "http://localhost:3000"
beforeEach(async () => {
  await resetDb()
})
afterEach(() => vi.unstubAllGlobals())

describe("report template ETag through the real BFF (ruling S6)", () => {
  test("the BFF forwards If-Match upstream and returns ETag downstream, on the 200 and on the 412; the typed client round-trips the tag", async () => {
    const w = await world()
    vi.stubEnv("API_URL", "http://api.internal")
    vi.stubEnv("APP_ORIGIN", ORIGIN)
    // the browser's side: same-origin fetch into forwardToApi, which calls the (stubbed) upstream = the real app
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
      return w.app.request(url.pathname + url.search, { method: init?.method, headers: init?.headers, body: init?.body as BodyInit | undefined })
    })
    const seen: Headers[] = []
    const browserFetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN)
      const headers = new Headers(init?.headers)
      headers.set("cookie", `${w.owner.cookie}; od-tenant=${w.tenant.slug}`)
      if ((init?.method ?? "GET") !== "GET") headers.set("origin", ORIGIN)
      seen.push(headers)
      return forwardToApi(new Request(url, { method: init?.method, headers, body: init?.body as BodyInit | undefined }), { prefix: "/v1" })
    }
    const api = makeApiClient({ baseUrl: "", fetch: browserFetch })

    const first = await fetchTemplate(api)
    expect(first.etag).toMatch(/^"[0-9a-f]{32}"$/)
    const saved = await putTemplate(api, first.data, first.etag)
    expect(saved.etag).toMatch(/^"[0-9a-f]{32}"$/)
    expect(saved.etag).not.toBe(first.etag)
    expect(seen.at(-1)!.get("if-match")).toBe(first.etag)

    // the old tag: 412 reaches the browser as the same status and carries the current tag
    const raw = await browserFetch("/v1/shift-reports/template", { method: "PUT", headers: { "content-type": "application/json", "if-match": first.etag! }, body: JSON.stringify({ departments: first.data.departments }) })
    expect(raw.status).toBe(412)
    expect(raw.headers.get("etag")).toBe(saved.etag)
    const stale = await putTemplate(api, first.data, first.etag).then(() => null, (e: unknown) => e)
    expect(classifyApiError(stale).kind).toBe("version_conflict")
    // no header at all: 428
    const none = await putTemplate(api, first.data, null).then(() => null, (e: unknown) => e)
    expect(classifyApiError(none).code).toBe("precondition_required")
  })
})
