import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { addShifts, addShiftsChecked, canEditShift, eligible, moveShift, moveShiftChecked, newShiftIds, prunePeople, removeShift, shiftHistory, validateShiftForm, type ShiftInput } from "./editing"

const week = (status: RosterWeek["status"], locationId = "L1"): RosterWeek => ({ id: "w1", locationId, weekStart: "2026-10-19", status, publishedAt: null, publishedBy: null, autoRepeatDays: null })
const access = (patch: Partial<RosterAccess>): RosterAccess => ({ scope: "locations", locationIds: ["L1"], editDraft: false, editPublished: false, approve: false, ...patch })
const supervisor = access({ editDraft: true })
const office = access({ scope: "all", editDraft: true, editPublished: true, approve: true })
const tpl: ShiftTemplate = { id: "t1", locationId: "L1", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 30, role: "Door staff", requires: ["SIA"] }
const input: ShiftInput = { weekId: "w1", locationId: "L1", date: "2026-10-20", templateId: "t1", role: "Door staff", start: "18:00", end: "02:00", unpaidBreakMin: 30 }
const m = (id: string, patch: Partial<WorkforceMember> = {}): WorkforceMember => ({ id, name: id, role: "r", dept: "d", homeLocationId: null, qualifications: [], leftOn: null, ...patch })

describe("canEditShift", () => {
  it("supervisor edits a draft, not a published week", () => {
    expect(canEditShift(supervisor, week("draft"))).toBe(true)
    expect(canEditShift(supervisor, week("published"))).toBe(false)
  })
  it("office role edits both", () => {
    expect(canEditShift(office, week("draft"))).toBe(true)
    expect(canEditShift(office, week("published"))).toBe(true)
  })
  it("read-only roles edit nothing, and a supervisor not granted the location edits nothing", () => {
    expect(canEditShift(access({}), week("draft"))).toBe(false)
    expect(canEditShift(supervisor, week("draft", "L2"))).toBe(false)
  })
})

describe("addShifts", () => {
  it("one shift per person; each is its own object, so changing one start leaves the other (AC-RS-02)", () => {
    const a = addShifts({ ...input }, ["a", "b"], ["s1", "s2"])
    expect(a.map((s) => s.personId)).toEqual(["a", "b"])
    expect(a.map((s) => s.id)).toEqual(["s1", "s2"])
    expect(a[0]).not.toBe(a[1])
    expect(a[0].start).toBe(a[1].start)
    a[1].start = "19:30"
    expect(a[0].start).toBe("18:00")
    expect(a[1].start).toBe("19:30")
    expect(input.start).toBe("18:00")
  })
  it("no people makes one open shift", () => {
    const a = addShifts(input, [], ["s1"])
    expect(a).toHaveLength(1)
    expect(a[0].personId).toBeNull()
  })
  it("copies the times, break, role and week", () => {
    const [s] = addShifts(input, ["a"], ["s1"])
    expect(s).toMatchObject({ weekId: "w1", locationId: "L1", date: "2026-10-20", templateId: "t1", role: "Door staff", start: "18:00", end: "02:00", unpaidBreakMin: 30, confirmedAt: null })
  })
})

describe("moveShift", () => {
  it("changes only the date", () => {
    const s: RosterShift = { id: "s1", weekId: "w1", locationId: "L1", date: "2026-10-20", personId: "a", templateId: "t1", role: "r", start: "22:00", end: "06:00", unpaidBreakMin: 0, confirmedAt: null }
    expect(moveShift(s, "2026-10-22")).toEqual({ ...s, date: "2026-10-22" })
  })
})

describe("eligible", () => {
  const lic = (expires: string | null) => [{ type: "SIA", expires }]
  it("keeps holders of the required licence, drops those without", () => {
    const got = eligible([m("a", { qualifications: lic("2027-01-01") }), m("b"), m("c", { qualifications: lic(null) })], tpl, "2026-10-20")
    expect(got.map((x) => x.id)).toEqual(["a", "c"])
  })
  it("drops an expired licence (valid through its expiry date)", () => {
    const got = eligible([m("a", { qualifications: lic("2026-10-19") }), m("b", { qualifications: lic("2026-10-20") })], tpl, "2026-10-20")
    expect(got.map((x) => x.id)).toEqual(["b"])
  })
  it("drops a member who left on or before the date", () => {
    const q = lic(null)
    const got = eligible([m("a", { qualifications: q, leftOn: "2026-10-20" }), m("b", { qualifications: q, leftOn: "2026-10-21" }), m("c", { qualifications: q, leftOn: "2026-09-01" })], tpl, "2026-10-20")
    expect(got.map((x) => x.id)).toEqual(["b"])
  })
  it("a template that requires nothing suggests everyone still employed", () => {
    expect(eligible([m("a"), m("b", { leftOn: "2026-01-01" })], { ...tpl, requires: [] }, "2026-10-20").map((x) => x.id)).toEqual(["a"])
  })
})

describe("prunePeople", () => {
  const q = [{ type: "SIA", expires: null }]
  const ms = [m("a", { qualifications: q }), m("b", { qualifications: q, leftOn: "2026-10-21" }), m("c")]
  it("drops picks who no longer qualify or have left, keeps the rest", () => {
    expect(prunePeople(["a", "b", "c"], ms, tpl, "2026-10-20")).toEqual({ kept: ["a", "b"], dropped: ["c"] })
    expect(prunePeople(["a", "b"], ms, tpl, "2026-10-22")).toEqual({ kept: ["a"], dropped: ["b"] })
  })
  it("keep protects the person already on the shift", () => {
    expect(prunePeople(["c"], ms, tpl, "2026-10-20", ["c"])).toEqual({ kept: ["c"], dropped: [] })
  })
})

describe("newShiftIds", () => {
  const taken = [{ id: "s-x-0" }, { id: "s-x-1" }] as RosterShift[]
  it("makes the asked count, unique, and skips taken ids", () => {
    const ids = newShiftIds(3, taken, "x")
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    for (const t of taken) expect(ids).not.toContain(t.id)
  })
})

describe("shiftHistory", () => {
  it("writes a week- and shift-level entry with before and after", () => {
    const e = shiftHistory("shift.moved", { weekId: "w1", locationId: "L1", shiftId: "s1" }, { date: "a" }, { date: "b" }, "me", "2026-10-20T09:00:00", [])
    expect(e).toMatchObject({ weekId: "w1", locationId: "L1", shiftId: "s1", action: "shift.moved", by: "me", before: { date: "a" }, after: { date: "b" }, reason: null })
  })
})

describe("validateShiftForm", () => {
  it("asks for a template, times and a sane break", () => {
    expect(validateShiftForm({ templateId: "", start: "", end: "", unpaidBreakMin: "-5" })).toMatchObject({ templateId: expect.any(String), start: expect.any(String), end: expect.any(String), unpaidBreakMin: expect.any(String) })
    expect(validateShiftForm({ templateId: "t1", start: "09:00", end: "17:00", unpaidBreakMin: "30" })).toEqual({})
  })
})

describe("guarded add, move and remove", () => {
  const cur: RosterShift = { id: "s1", weekId: "w1", locationId: "L1", date: "2026-10-20", personId: "p1", templateId: "t1", role: "Door staff", start: "18:00", end: "02:00", unpaidBreakMin: 30, confirmedAt: null }
  const next = { ...week("draft"), id: "w2", weekStart: "2026-10-26" }
  describe("addShiftsChecked", () => {
    it("adds on a draft week for a supervisor, one shift per person", () => {
      expect(addShiftsChecked(supervisor, week("draft"), input, ["a", "b"], ["x", "y"], null).map((s) => s.personId)).toEqual(["a", "b"])
    })
    it("a supervisor on a published week throws, and so does a read-only role or an ungranted location", () => {
      expect(() => addShiftsChecked(supervisor, week("published"), input, ["a"], ["x"], "why")).toThrow()
      expect(() => addShiftsChecked(access({}), week("draft"), input, ["a"], ["x"], null)).toThrow()
      expect(() => addShiftsChecked(supervisor, week("draft", "L2"), { ...input, locationId: "L2" }, ["a"], ["x"], null)).toThrow()
    })
    it("an office role on a published week needs a reason", () => {
      expect(() => addShiftsChecked(office, week("published"), input, ["a"], ["x"], "  ")).toThrow(/reason/i)
      expect(addShiftsChecked(office, week("published"), input, ["a"], ["x"], "cover")[0].personId).toBe("a")
    })
    it("refuses an input that is not in the week it is added to", () => {
      expect(() => addShiftsChecked(supervisor, week("draft"), { ...input, weekId: "w9" }, ["a"], ["x"], null)).toThrow()
    })
  })
  describe("moveShiftChecked", () => {
    it("moves within a draft week, or into the next draft week, and sets the week", () => {
      expect(moveShiftChecked(supervisor, cur, week("draft"), week("draft"), "2026-10-22")).toMatchObject({ date: "2026-10-22", weekId: "w1" })
      expect(moveShiftChecked(supervisor, cur, week("draft"), next, "2026-10-27")).toMatchObject({ date: "2026-10-27", weekId: "w2" })
    })
    it("a supervisor on a published week throws, on either end", () => {
      expect(() => moveShiftChecked(supervisor, cur, week("published"), week("published"), "2026-10-22")).toThrow()
      expect(() => moveShiftChecked(supervisor, cur, week("draft"), { ...next, status: "published" }, "2026-10-27")).toThrow()
    })
    it("published weeks go through the office edit path, not this one; a date outside the target week is refused", () => {
      expect(() => moveShiftChecked(office, cur, week("published"), week("published"), "2026-10-22")).toThrow(/published/i)
      expect(() => moveShiftChecked(supervisor, cur, week("draft"), week("draft"), "2026-11-30")).toThrow()
      expect(() => moveShiftChecked(supervisor, { ...cur, weekId: "wX" }, week("draft"), week("draft"), "2026-10-22")).toThrow()
    })
  })
  describe("removeShift", () => {
    const AT = "2026-10-21T10:00:00"
    it("removes from a draft week and writes the before and after", () => {
      const other = { ...cur, id: "s2" }
      const r = removeShift(supervisor, week("draft"), [cur, other], "s1", "me", AT, [], null)
      expect(r.shifts.map((s) => s.id)).toEqual(["s2"])
      expect(r.entry).toMatchObject({ action: "shift.removed", weekId: "w1", locationId: "L1", shiftId: "s1", by: "me", at: AT, before: cur, after: null, reason: null })
    })
    it("a supervisor cannot remove from a published week; an office role needs a reason", () => {
      expect(() => removeShift(supervisor, week("published"), [cur], "s1", "me", AT, [], "why")).toThrow()
      expect(() => removeShift(office, week("published"), [cur], "s1", "me", AT, [], " ")).toThrow(/reason/i)
      const r = removeShift(office, week("published"), [cur], "s1", "me", AT, [], " wrong day ")
      expect(r.shifts).toEqual([])
      expect(r.entry.reason).toBe("wrong day")
    })
    it("refuses a shift that is not in the week, or does not exist, and never mutates", () => {
      const all = [cur]
      expect(() => removeShift(supervisor, week("draft"), all, "nope", "me", AT, [], null)).toThrow()
      expect(() => removeShift(supervisor, { ...week("draft"), id: "w2" }, all, "s1", "me", AT, [], null)).toThrow()
      expect(all).toHaveLength(1)
    })
  })
})
