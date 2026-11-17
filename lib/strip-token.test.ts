import { describe, expect, test, vi } from "vitest"
import { stripQueryFromAddressBar } from "@/lib/strip-token"

describe("K5: a token in the address bar is removed (history, screenshots, Referer)", () => {
  const win = (search: string) => ({ location: { pathname: "/verify-email", search }, history: { replaceState: vi.fn() } })

  test("replaces the entry with the bare path, keeping no query", () => {
    const w = win("?token=abc")
    stripQueryFromAddressBar(w)
    expect(w.history.replaceState).toHaveBeenCalledWith(null, "", "/verify-email")
  })

  test("does nothing when there is no query (no history churn)", () => {
    const w = win("")
    stripQueryFromAddressBar(w)
    expect(w.history.replaceState).not.toHaveBeenCalled()
  })

  test("never throws (a sandboxed frame or an old browser)", () => {
    const w = { location: { pathname: "/x", search: "?t=1" }, history: { replaceState: () => { throw new Error("blocked") } } }
    expect(() => stripQueryFromAddressBar(w)).not.toThrow()
  })
})
