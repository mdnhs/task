import { match } from "next/dist/compiled/path-to-regexp"
import { describe, expect, test } from "vitest"
import nextConfig from "../next.config"

describe("B6 final: global security headers (clickjacking, referrer, sniffing)", () => {
  test("every route gets frame blocking, a strict referrer policy and nosniff; no full CSP", async () => {
    const rules = await nextConfig.headers!()
    // pages get frame-ancestors; /v1/* (the API behind the BFF) keeps its own Content-Security-Policy (branding-headers.test.ts)
    for (const [path, csp] of [["/", "frame-ancestors 'none'"], ["/settings/branding", "frame-ancestors 'none'"], ["/v1/tasks", undefined]] as const) {
      const hit = rules.filter((r) => match(r.source, { decode: decodeURIComponent })(path))
      expect(hit.length, path).toBe(1)
      const h = Object.fromEntries(hit[0].headers.map((x) => [x.key.toLowerCase(), x.value]))
      expect(h["x-frame-options"]).toBe("DENY")
      expect(h["content-security-policy"]).toBe(csp)
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin")
      expect(h["x-content-type-options"]).toBe("nosniff")
    }
  })
})
