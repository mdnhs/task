import { describe, expect, it } from "vitest"
import { countNumber, formatCount, parseCount } from "./count-format"

describe("parseCount", () => {
  it("reads plain integers and decimals", () => {
    expect(parseCount("42")).toEqual({ prefix: "", suffix: "", target: 42, decimals: 0, group: "" })
    expect(parseCount("1.6")).toMatchObject({ target: 1.6, decimals: 1 })
  })
  it("reads currency and grouping", () => {
    expect(parseCount("€12,400")).toEqual({ prefix: "€", suffix: "", target: 12400, decimals: 0, group: "," })
    expect(parseCount("£1,234,567.50")).toMatchObject({ prefix: "£", target: 1234567.5, decimals: 2, group: "," })
    expect(parseCount("$ 640")).toMatchObject({ prefix: "$ ", target: 640 })
  })
  it("reads suffixes and a space or no-break space as the group", () => {
    expect(parseCount("94%")).toMatchObject({ target: 94, suffix: "%" })
    expect(parseCount("4.2k")).toMatchObject({ target: 4.2, decimals: 1, suffix: "k" })
    expect(parseCount("12 400 kr")).toMatchObject({ target: 12400, group: " ", suffix: " kr" })
    expect(parseCount("1 234")).toMatchObject({ target: 1234, group: " " })
  })
  it("refuses what it cannot read safely", () => {
    for (const v of ["—", "", "n/a", "12.400,50 €", "1,23", "1,234 567", "3-5", "2026-10-20", "12:30", "v2.1.3", "10 of 20"]) expect(parseCount(v), v).toBeNull()
  })
})

describe("formatCount", () => {
  it("round-trips a value", () => {
    for (const v of ["€12,400", "94%", "£1,234,567.50", "4.2k", "640", "12 400 kr"]) {
      const s = parseCount(v)!
      expect(formatCount(s.target, s), v).toBe(v)
    }
  })
  it("groups and pads while counting", () => {
    const s = parseCount("€12,400.50")!
    expect(formatCount(0, s)).toBe("€0.00")
    expect(formatCount(1234.5, s)).toBe("€1,234.50")
    expect(formatCount(999.99, s)).toBe("€999.99")
  })
})

describe("countNumber", () => {
  it("gives the number or null", () => {
    expect(countNumber("€12,400")).toBe(12400)
    expect(countNumber("—")).toBeNull()
  })
})
