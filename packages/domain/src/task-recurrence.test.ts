import { describe, expect, it } from "vitest"
import { describeRepeat, nextOccurrences, repeatError } from "./task-recurrence"
import type { RepeatRule } from "./task-model"

// T5.1 (F15, D11): `per_shift` is a rule on a shift pattern; its dates come from the server (assignments), never from nextOccurrences.
describe("per_shift repeat rule", () => {
  const rule: RepeatRule = { freq: "per_shift", patternId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }
  it("needs a pattern", () => {
    expect(repeatError(rule, "2026-10-24")).toBe("")
    expect(repeatError({ freq: "per_shift" }, "2026-10-24")).toBe("Choose a shift pattern")
  })
  it("has no dates of its own and a label", () => {
    expect(nextOccurrences(rule, "2026-10-01", "2026-10-31")).toEqual([])
    expect(describeRepeat(rule)).toBe("Every shift")
    expect(describeRepeat({ ...rule, until: "2026-12-31" })).toBe("Every shift until 2026-12-31")
  })
  it("the other frequencies are unchanged", () => {
    expect(nextOccurrences({ freq: "daily" }, "2026-10-24", "2026-10-26")).toEqual(["2026-10-25", "2026-10-26"])
    expect(repeatError({ freq: "weekly" }, "2026-10-24")).toBe("Choose at least one day")
  })
})
