import { describe, expect, test } from "vitest"
import nextConfig from "../next.config"

describe("B6 final: global security headers (clickjacking, referrer, sniffing)", () => {
  test("every route gets frame blocking, a strict referrer policy and nosniff; no full CSP", async () => {
    const rules = await nextConfig.headers!()
    const all = rules.filter((r) => r.source === "/:path*")
    expect(all.length).toBe(1)
    const h = Object.fromEntries(all[0].headers.map((x) => [x.key.toLowerCase(), x.value]))
    expect(h["x-frame-options"]).toBe("DENY")
    expect(h["content-security-policy"]).toBe("frame-ancestors 'none'")
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["x-content-type-options"]).toBe("nosniff")
  })
})
