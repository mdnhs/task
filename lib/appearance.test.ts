import { describe, expect, it } from "vitest"

import { DEFAULT_APPEARANCE, appearanceCss, parseAppearance, scaledRadius } from "./appearance"

describe("appearanceCss", () => {
  it("emits nothing for the default look", () => {
    expect(appearanceCss(DEFAULT_APPEARANCE)).toBe("")
  })
  it("emits only the tokens that differ from the default", () => {
    expect(appearanceCss({ corners: "sharp", text: "default", spacing: "comfortable" })).toBe(":root{--radius-scale:0.4}")
  })
  it("emits every changed scale", () => {
    const css = appearanceCss({ corners: "round", text: "large", spacing: "compact" })
    expect(css).toContain("--radius-scale:1.4")
    expect(css).toContain("--text-scale:1.1")
    expect(css).toContain("--space-scale:0.75")
  })
})

describe("parseAppearance", () => {
  it("falls back to the default for missing or garbled input", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance("x")).toEqual(DEFAULT_APPEARANCE)
  })
  it("keeps valid fields and defaults unknown ones", () => {
    expect(parseAppearance({ corners: "round", text: "huge" })).toEqual({ corners: "round", text: "default", spacing: "comfortable" })
  })
})

describe("scaledRadius", () => {
  it("scales a px radius with the Corners preset and keeps pills and circles", () => {
    expect(scaledRadius(14)).toBe("calc(14px * var(--radius-scale,1))")
    expect(scaledRadius("pill")).toBe(999)
    expect(scaledRadius("circle")).toBe("50%")
    expect(scaledRadius(undefined)).toBeUndefined()
  })
})
