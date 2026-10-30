import { describe, expect, it } from "vitest"

import { unzoom, unzoomOverlay } from "./zoom"

describe("unzoom", () => {
  it("turns on-screen px into CSS px inside a zoomed element", () => {
    expect(unzoom(110, 1.1)).toBeCloseTo(100)
    expect(unzoom(92, 0.92)).toBeCloseTo(100)
  })
  it("leaves px alone without zoom", () => {
    expect(unzoom(100, 1)).toBe(100)
    expect(unzoom(100, undefined)).toBe(100)
    expect(unzoom(100, 0)).toBe(100)
  })
})

describe("unzoomOverlay", () => {
  it("keeps a fixed overlay under the pointer inside a zoomed body", () => {
    // rect.left 220 on screen, pointer moved 55 → on screen the overlay must end at 275, i.e. CSS left + x = 275 / 1.1
    const t = unzoomOverlay({ x: 55, y: 11, scaleX: 1, scaleY: 1 }, { left: 220, top: 110 }, 1.1)
    expect((220 + t.x) * 1.1).toBeCloseTo(275)
    expect((110 + t.y) * 1.1).toBeCloseTo(121)
  })
  it("is a no-op without zoom", () => {
    const t = { x: 5, y: 6, scaleX: 1, scaleY: 1 }
    expect(unzoomOverlay(t, { left: 10, top: 10 }, 1)).toBe(t)
  })
})
