import { describe, expect, it } from "vitest"
import { TILT_MAX, TILT_SPEED, pivotOrigin, tiltFor } from "./drag-card"

describe("drag-card motion helper", () => {
  it("tilts with horizontal speed, clamped to the max, upright at rest", () => {
    expect(tiltFor(0)).toBe(0)
    expect(tiltFor(TILT_SPEED)).toBe(TILT_MAX)
    expect(tiltFor(-TILT_SPEED / 2)).toBe(-TILT_MAX / 2)
    expect(tiltFor(TILT_SPEED * 5)).toBe(TILT_MAX)
    expect(tiltFor(-TILT_SPEED * 5)).toBe(-TILT_MAX)
  })
  it("pivots on the grab point, or the centre without a pointer", () => {
    const rect = { left: 100, top: 50, width: 200, height: 80 }
    expect(pivotOrigin(rect, { clientX: 150, clientY: 70 })).toBe("25% 25%")
    expect(pivotOrigin(rect, undefined)).toBe("50% 50%")
    expect(pivotOrigin(undefined, { clientX: 1, clientY: 1 })).toBe("50% 50%")
  })
})
