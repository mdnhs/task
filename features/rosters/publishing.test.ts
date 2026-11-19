import { describe, expect, it } from "vitest"
import type { RuleViolation } from "@/lib/roster-rules"
import { decideBody, groupByPerson, patchLines, publishBody, publishPlan, requestChangeBody, splitName } from "./publishing"

const v = (rule: string, severity: "block" | "warn", personId = "p1", shiftId = "s1"): RuleViolation => ({ rule: rule as RuleViolation["rule"], shiftId, personId, severity, message: `${rule} broken`, otherShiftIds: [] })

describe("publish plan: a block needs a reason only for office; a supervisor cannot publish over it (Review Focus 2 UI)", () => {
  it("no violations and warnings only: publishable by everyone, no reason", () => {
    for (const level of ["office", "supervisor"] as const) {
      expect(publishPlan([], level)).toEqual({ blocks: 0, warnings: 0, stopped: false, needsReason: false })
      expect(publishPlan([v("daily_rest", "warn")], level)).toMatchObject({ warnings: 1, stopped: false, needsReason: false })
    }
  })
  it("a block: office needs a reason, a supervisor is stopped", () => {
    const blocked = [v("double_booking", "block"), v("daily_rest", "warn")]
    expect(publishPlan(blocked, "office")).toEqual({ blocks: 1, warnings: 1, stopped: false, needsReason: true })
    expect(publishPlan(blocked, "supervisor")).toEqual({ blocks: 1, warnings: 1, stopped: true, needsReason: false })
    expect(publishPlan(blocked, null).stopped).toBe(true)
  })
  it("the body carries the version and, over a block, the reason with the rule ids (both or neither)", () => {
    expect(publishBody({ version: 4 }, "", [])).toEqual({ version: 4 })
    expect(publishBody({ version: 4 }, "  ", [v("double_booking", "block")])).toEqual({ version: 4 }) // a blank reason is no override
    expect(publishBody({ version: 4 }, "Agreed", [v("double_booking", "block"), v("daily_rest", "warn"), v("double_booking", "block")])).toEqual({ version: 4, reason: "Agreed", overrideRuleIds: ["double_booking"] })
  })
  it("groups by person, people with a block first, blocks first inside a person", () => {
    const g = groupByPerson([v("daily_rest", "warn", "a"), v("double_booking", "block", "b"), v("avg_48h", "warn", "b")], (id) => id.toUpperCase())
    expect(g.map((x) => x.name)).toEqual(["B", "A"])
    expect(g[0]!.items.map((i) => i.rule)).toEqual(["double_booking", "avg_48h"])
  })
})

describe("change request bodies", () => {
  const shift = { start: "08:00", end: "16:00", personId: "u1" as string | null }
  it("sends only the changed fields and the reason; nothing changed or no reason is no request", () => {
    expect(requestChangeBody(shift, { start: "09:00", end: "16:00", personId: "u1", reason: " Late open " })).toEqual({ patch: { start: "09:00" }, reason: "Late open" })
    expect(requestChangeBody(shift, { start: "08:00", end: "16:00", personId: null, reason: "Cover" })).toEqual({ patch: { userId: null }, reason: "Cover" })
    expect(requestChangeBody(shift, { ...shift, reason: "x" })).toBeNull()
    expect(requestChangeBody(shift, { start: "09:00", end: "16:00", personId: "u1", reason: "  " })).toBeNull()
  })
  it("describes a patch against the shift as it is now", () => {
    const names = (id: string | null) => (id === "u2" ? "Ben" : id === "u1" ? "Ann" : "Open shift")
    expect(patchLines({ start: "09:00", userId: "u2" }, { start: "08:00", end: "16:00", date: "2026-11-02", personId: "u1", role: "r", unpaidBreakMin: 30 }, names)).toEqual(["Start 08:00 → 09:00", "Person Ann → Ben"])
    expect(patchLines({ start: "09:00" }, undefined, names)).toEqual(["Start 09:00"])
  })
  it("a decision carries the override only on approve, reason and rule ids together under overrideReason", () => {
    const over = { reason: "Agreed", violations: [v("daily_rest", "block")] }
    expect(decideBody("approve", " ok ", over)).toEqual({ decision: "approve", note: "ok", overrideReason: "Agreed", overrideRuleIds: ["daily_rest"] })
    expect(decideBody("reject", "", over)).toEqual({ decision: "reject" })
    expect(decideBody("approve", "", undefined)).toEqual({ decision: "approve" })
  })
})

describe("splitName: the person is named once", () => {
  it("a sentence that starts with the name keeps it as the name; otherwise the name goes in front", () => {
    expect(splitName("Ann Byrne", "Ann Byrne is on two shifts")).toEqual({ name: "Ann Byrne", rest: " is on two shifts" })
    expect(splitName("Ann Byrne", "Already rostered elsewhere")).toEqual({ name: "Ann Byrne", rest: " Already rostered elsewhere" })
  })
})
