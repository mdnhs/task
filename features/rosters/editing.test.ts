import { describe, expect, it } from "vitest"
import type { RuleViolation } from "@/lib/roster-rules"
import { DAY_T, NIGHT_T, PERSON, payloadFixture } from "./fixtures"
import { addBody, blockingRules, newOpenId, overrideFields, patchBody, removeShiftLocal, setShiftLocal, shiftsAddedLocal, validateShiftForm } from "./editing"

const v = (rule: RuleViolation["rule"], severity: RuleViolation["severity"], shiftId = "sh-mon-ann"): RuleViolation => ({ rule, shiftId, personId: PERSON.ann, severity, message: "m", otherShiftIds: [] })

describe("override fields (AI2 #3): the reason and the rule ids always travel together", () => {
  it("blockingRules lists each blocking rule once and leaves warnings out", () => {
    expect(blockingRules([v("double_booking", "block"), v("daily_rest", "warn"), v("double_booking", "block", "x"), v("avg_48h", "block")])).toEqual(["double_booking", "avg_48h"])
    expect(blockingRules([v("daily_rest", "warn")])).toEqual([])
  })
  it("overrideFields sets overrideReason and overrideRuleIds together, or neither; a blank reason is no override", () => {
    expect(overrideFields("  Cover for sickness ", [v("double_booking", "block"), v("daily_rest", "warn")])).toEqual({ reason: "Cover for sickness", overrideRuleIds: ["double_booking"] })
    expect(overrideFields("", [v("double_booking", "block")])).toEqual({})
    expect(overrideFields("why", [v("daily_rest", "warn")])).toEqual({ reason: "why" }) // a reason alone (a published week with nothing blocking) carries no ids
    const both = overrideFields("why", [v("double_booking", "block")])
    expect("reason" in both).toBe("overrideRuleIds" in both)
    // decisions (change requests, open shifts, swaps) name the reason overrideReason
    expect(overrideFields("Client asked", [v("left", "block")], "overrideReason")).toEqual({ overrideReason: "Client asked", overrideRuleIds: ["left"] })
    expect(overrideFields("", [v("left", "block")], "overrideReason")).toEqual({})
  })
})

describe("request bodies", () => {
  const p = payloadFixture()
  const mon = p.shifts[0]!
  it("patchBody sends the shift's version and only what changed (a move is the date)", () => {
    expect(patchBody(mon, { date: "2026-11-03" })).toEqual({ version: 1, patch: { date: "2026-11-03" } })
    expect(patchBody(mon, { date: mon.date, start: "09:00", personId: PERSON.ben, unpaidBreakMin: 30 })).toEqual({ version: 1, patch: { start: "09:00", userId: PERSON.ben } })
    expect(patchBody(mon, { personId: null })).toEqual({ version: 1, patch: { userId: null } })
    expect(patchBody(mon, { date: "2026-11-03" }, { reason: "Cover", overrideRuleIds: ["double_booking"] })).toEqual({ version: 1, patch: { date: "2026-11-03" }, reason: "Cover", overrideRuleIds: ["double_booking"] })
    expect(patchBody(mon, {})).toBeNull() // nothing changed: no request
  })
  it("addBody makes one entry with one person per shift and sends times only when they differ from the shift type", () => {
    const t = p.shiftTypes.find((x) => x.id === DAY_T)!
    expect(addBody(t, { date: "2026-11-04", people: [PERSON.ann, PERSON.ben], start: "08:00", end: "16:00", unpaidBreakMin: 30 })).toEqual({ shifts: [{ date: "2026-11-04", userIds: [PERSON.ann, PERSON.ben], shiftTypeId: DAY_T }] })
    expect(addBody(t, { date: "2026-11-04", people: [], start: "09:00", end: "16:00", unpaidBreakMin: 15 }, { reason: "Cover" })).toEqual({ shifts: [{ date: "2026-11-04", userIds: [null], shiftTypeId: DAY_T, start: "09:00", unpaidBreakMin: 15 }], reason: "Cover" })
  })
})

describe("optimistic edits keep the week's day columns right (the API's reload settles them)", () => {
  it("a move changes the date and the two days' counts, and leaves the original untouched", () => {
    const p = payloadFixture()
    const moved = setShiftLocal(p, "sh-mon-ann", { date: "2026-11-05" })
    expect(moved.shifts.find((s) => s.id === "sh-mon-ann")!.date).toBe("2026-11-05")
    const days = moved.weeks[0]!.days
    expect([days[0]!.count, days[3]!.count]).toEqual([1, 1])
    expect([days[0]!.short, days[3]!.short]).toEqual([3, 3])
    expect(days[3]!.shiftIds).toEqual(["sh-mon-ann"])
    expect(p.shifts.find((s) => s.id === "sh-mon-ann")!.date).toBe("2026-11-02")
    expect(p.weeks[0]!.days[0]!.count).toBe(2)
  })
  it("a removed shift disappears and the count falls; added shifts appear with temporary ids and version 0", () => {
    const p = payloadFixture()
    const gone = removeShiftLocal(p, "sh-mon-ben")
    expect(gone.shifts.some((s) => s.id === "sh-mon-ben")).toBe(false)
    expect(gone.weeks[0]!.days[0]!.count).toBe(1)
    const t = p.shiftTypes.find((x) => x.id === NIGHT_T)!
    const added = shiftsAddedLocal(p, p.weeks[0]!.id, t, { date: "2026-11-06", people: [PERSON.ann, null], start: "22:00", end: "06:00", unpaidBreakMin: 30 })
    const fresh = added.shifts.filter((s) => !p.shifts.some((x) => x.id === s.id))
    expect(fresh).toHaveLength(2)
    expect(fresh.every((s) => s.id.startsWith("local-") && s.version === 0 && s.date === "2026-11-06")).toBe(true)
    expect(added.weeks[0]!.days[4]!.count).toBe(1) // the open one never counts
    expect(newOpenId(3)).toMatch(/^local-/)
  })
})

describe("validateShiftForm", () => {
  it("asks for a shift, both times and a break of 0 to 480 minutes", () => {
    expect(validateShiftForm({ templateId: "", start: "", end: "", unpaidBreakMin: "" })).toEqual({ templateId: "Choose a shift", start: "Pick a start time", end: "Pick an end time", unpaidBreakMin: "Break is 0 to 480 minutes" })
    expect(validateShiftForm({ templateId: "t", start: "08:00", end: "16:00", unpaidBreakMin: "30" })).toEqual({})
    expect(validateShiftForm({ templateId: "t", start: "08:00", end: "16:00", unpaidBreakMin: "481" }).unpaidBreakMin).toBeDefined()
  })
})
