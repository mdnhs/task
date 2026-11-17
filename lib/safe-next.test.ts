import { describe, expect, test } from "vitest"
import { safeNext } from "@/lib/safe-next"

describe("T6.3 safeNext: a post-sign-in redirect is same-origin and path-only", () => {
  test.each([
    "//evil.com", "///evil.com", "////evil.com", "https://evil.com", "http://evil.com/x", "HTTPS://evil.com", "/\\evil.com", "\\evil.com", "\\\\evil.com", "/\\/evil.com",
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "evil.com", "evil.com/path", "http:evil.com", "https:evil.com",
    " //evil.com", "\t//evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/ /evil.com", "//\u0000evil.com", "/%2f/evil.com", "/%2F%2Fevil.com", "/%5cevil.com", "/%5Cevil.com", "/%09/evil.com",
    "/.//evil.com", "/..//evil.com", "/%2e%2e//evil.com", "//@evil.com", "/api/session/expired", "/api/auth/sign-out", "/v1/me", "/sign-in", "/sign-in?next=/x", "", "   ", "/" + "a".repeat(3000),
  ])("refuses %j and falls back to /", (bad) => {
    expect(safeNext(bad)).toBe("/")
  })

  test("a non-string is the fallback", () => {
    for (const v of [null, undefined, 1, {}, ["/x"], ["//evil.com"]]) expect(safeNext(v as never)).toBe("/")
    expect(safeNext("//evil.com", "/home")).toBe("/home")
  })

  test("a plain app path (with a query) passes; the hash is dropped; the result is always one path starting with a single slash", () => {
    expect(safeNext("/tasks")).toBe("/tasks")
    expect(safeNext("/tasks?view=board&q=a%20b")).toBe("/tasks?view=board&q=a%20b")
    expect(safeNext("/tasks/TSK-1042")).toBe("/tasks/TSK-1042")
    expect(safeNext("/settings/users#frag")).toBe("/settings/users")
    expect(safeNext("/")).toBe("/")
    expect(safeNext("/platform")).toBe("/platform")
    expect(safeNext("/account/security")).toBe("/account/security")
  })

  test("whatever goes in, the output never leaves the origin when resolved against it", () => {
    const inputs = ["/ok", "//evil.com", "/\\evil.com", "https://evil.com", "/a/../../evil.com", "/%2e%2e/%2e%2e/evil.com", "/x?next=//evil.com"]
    for (const i of inputs) expect(new URL(safeNext(i), "https://app.example.com").origin, i).toBe("https://app.example.com")
  })
})
