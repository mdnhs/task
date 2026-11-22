import { match } from "next/dist/compiled/path-to-regexp"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { forwardToApi } from "@/lib/api/bff"
import nextConfig from "@/next.config"

// What reaches the browser for GET /v1/branding/{kind}: the API's own `default-src 'none'; sandbox` must survive both the BFF and next.config headers().

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.internal:3001")
  vi.stubEnv("APP_ORIGIN", "https://app.example.com")
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test("the BFF passes the API's CSP, nosniff, ETag and caching headers of a branding image through unchanged", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png", "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff", etag: '"abc"', "cache-control": "private, no-cache", vary: "Cookie" } })))
  const res = await forwardToApi(new Request("https://app.example.com/v1/branding/logo?v=abc", { headers: { cookie: "od-tenant=acme" } }), { prefix: "/v1" })
  expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
  expect(res.headers.get("cache-control")).toBe("private, no-cache")
  expect(res.headers.get("vary")).toBe("Cookie")
  expect(res.headers.get("content-type")).toBe("image/png")
})

test("next.config headers() never overrides the Content-Security-Policy of /v1/* responses (it would replace the API's sandbox policy)", async () => {
  const entries = await nextConfig.headers!()
  for (const path of ["/v1/branding/logo", "/v1/branding/favicon"]) {
    const hit = entries.filter((e) => match(e.source, { decode: decodeURIComponent })(path))
    expect(hit.length).toBeGreaterThan(0) // the framing, referrer and nosniff headers still apply
    for (const e of hit) expect(e.headers.map((h) => h.key.toLowerCase())).not.toContain("content-security-policy")
  }
  // pages keep frame-ancestors
  const page = entries.filter((e) => match(e.source, { decode: decodeURIComponent })("/settings/branding"))
  expect(page.flatMap((e) => e.headers).find((h) => h.key === "Content-Security-Policy")?.value).toBe("frame-ancestors 'none'")
})
