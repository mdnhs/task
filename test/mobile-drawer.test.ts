import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// iOS Safari/Chrome: the mobile drawer must fill the dynamic viewport and keep a scrollable menu (a start-aligned, auto-height fixed grid child collapsed the menu to nothing).
const css = readFileSync("app/opsdesk.css", "utf8")
const mobile = css.slice(css.lastIndexOf("@media (max-width:1080px){\n  .app{padding:0}"))

describe("mobile sidebar drawer css", () => {
  it("pins all four edges with a dvh height (100vh fallback) and stretches", () => {
    expect(mobile).toMatch(/\.sidebar\{position:fixed;inset:0 auto 0 0;height:100vh;height:100dvh;/)
    expect(mobile).toContain("align-self:stretch")
  })
  it("keeps the menu a shrinkable scroll container", () => {
    expect(css).toMatch(/\.sidebar-scroll\{flex:1;min-height:0;overflow-y:auto/)
  })
  it("respects the iOS safe areas", () => {
    expect(mobile).toContain("safe-area-inset-top")
    expect(mobile).toContain("safe-area-inset-bottom")
  })
})

describe("role label", () => {
  it("session-core strips a stored 'Tenant ' prefix from the role label", () => {
    expect(readFileSync("lib/session-core.ts", "utf8")).toContain('role.label.replace(/^tenant\\s+/i, "")')
  })
})
