import { describe, expect, it } from "vitest"

import { compact, isCompacted, money } from "./money"

describe("money (D11 exact values)", () => {
  it("shows cents only when there are any", () => {
    expect(money(149.5, "EUR")).toBe("€149.50")
    expect(money(149, "EUR")).toBe("€149")
    expect(money(1234567, "EUR")).toBe("€1,234,567")
    expect(money(0.1 + 0.2, "EUR")).toBe("€0.30")
    expect(money(12, "")).toBe("12")
  })
  it("uses the amount's own currency", () => {
    expect(money(149.4, "GBP")).toBe("£149.40")
  })
})

describe("compact (KPI cards)", () => {
  it("shortens from a thousand up, via the same module", () => {
    expect(compact(12_400, "EUR")).toEqual({ prefix: "€", value: "12.4", suffix: "k" })
    expect(compact(1_234_567, "EUR")).toEqual({ prefix: "€", value: "1.2", suffix: "m" })
    expect(compact(640, "EUR")).toEqual({ prefix: "€", value: "640", suffix: "" })
    expect(isCompacted(compact(12_400, "EUR").suffix)).toBe(true)
  })
})
