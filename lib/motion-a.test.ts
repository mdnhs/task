import { describe, expect, it } from "vitest"
import { growInset, numDir } from "./motion"

describe("numDir", () => {
  it("decrease rolls down", () => expect(numDir("48", "27")).toBe("down"))
  it("increase rolls up", () => expect(numDir("7", "12")).toBe("up"))
  it("equal rolls up", () => expect(numDir("5", "5")).toBe("up"))
  it("non-numeric rolls up", () => {
    expect(numDir("—", "4")).toBe("up")
    expect(numDir("9+", "3")).toBe("down")
  })
})

describe("growInset", () => {
  const panel = { left: 1000, top: 18, width: 400, height: 800 }
  it("insets to the trigger's footprint", () => {
    const r = growInset({ left: 1200, top: 20, width: 44, height: 44 }, panel)
    expect(r).toEqual({ top: 2, right: 156, bottom: 754, left: 200, radius: 22 })
  })
  it("clamps a trigger left of the panel to the panel's left edge", () => {
    const r = growInset({ left: 900, top: 20, width: 44, height: 44 }, panel)
    expect(r.left).toBe(0)
    expect(r.right).toBe(356)
  })
  it("clamps a trigger above the panel to its top", () => {
    const r = growInset({ left: 1300, top: 0, width: 44, height: 44 }, panel)
    expect(r.top).toBe(0)
    expect(r.bottom).toBe(756)
  })
  it("never insets past the panel when the trigger is bigger", () => {
    const r = growInset({ left: 0, top: 0, width: 2000, height: 2000 }, panel)
    expect(r).toEqual({ top: 0, right: 0, bottom: 0, left: 0, radius: 200 })
  })
})
