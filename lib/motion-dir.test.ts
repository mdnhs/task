import { describe, expect, it } from "vitest"
import { slideDir } from "./motion"

describe("slideDir", () => {
  it("forward is next", () => expect(slideDir(0, 2)).toBe("next"))
  it("backward is prev", () => expect(slideDir(3, 1)).toBe("prev"))
  it("no change is no slide", () => expect(slideDir(2, 2)).toBeUndefined())
  it("unknown index (-1) is no slide", () => {
    expect(slideDir(-1, 2)).toBeUndefined()
    expect(slideDir(1, -1)).toBeUndefined()
  })
  it("NaN is no slide", () => expect(slideDir(NaN, 1)).toBeUndefined())
})
