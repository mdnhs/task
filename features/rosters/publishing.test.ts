import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { RuleViolation } from "@/lib/roster-rules"
import type { RosterShift, RosterWeek } from "@/lib/rosters"
import type { RuleContext } from "@/lib/roster-rules"
import type { ShiftTemplate } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { BlockedError } from "./exchange"
import { decideRequest, editPublished, publishWeek, requestChange, type PatchCheck } from "./publishing"

const week: RosterWeek = { id: "w1", locationId: "L1", weekStart: "2026-10-19", status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null }
const shift: RosterShift = { id: "s1", weekId: "w1", locationId: "L1", date: "2026-10-20", personId: "p1", templateId: "t1", role: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 30, confirmedAt: "2026-10-15T10:00:00" }
const acc = (p: Partial<RosterAccess>): RosterAccess => ({ scope: "locations", locationIds: ["L1"], editDraft: false, editPublished: false, approve: false, ...p })
const supervisor = acc({ editDraft: true })
const office = acc({ scope: "all", editDraft: true, editPublished: true, approve: true })
const v = (severity: "block" | "warn"): RuleViolation => ({ rule: severity === "block" ? "double_booking" : "daily_rest", shiftId: "s1", personId: "p1", severity, message: "m", otherShiftIds: [] })
const AT = "2026-10-16T09:00:00"

describe("publishWeek", () => {
  it("publishes a clean week and writes a history entry", () => {
    const r = publishWeek(week, supervisor, [], null, "me", AT)
    expect(r.week).toMatchObject({ status: "published", publishedAt: AT, publishedBy: "me" })
    expect(r.entry).toMatchObject({ weekId: "w1", locationId: "L1", shiftId: null, by: "me", at: AT, action: "publish", reason: null })
    expect(week.status).toBe("draft")
  })
  it("warnings do not block, even for a supervisor", () => {
    expect(publishWeek(week, supervisor, [v("warn")], null, "me", AT).week.status).toBe("published")
  })
  it("throws on a blocking violation with no reason", () => {
    expect(() => publishWeek(week, office, [v("block")], null, "me", AT)).toThrow()
    expect(() => publishWeek(week, office, [v("block")], "   ", "me", AT)).toThrow()
  })
  it("a supervisor cannot publish over a blocking violation, reason or not", () => {
    expect(() => publishWeek(week, supervisor, [v("block")], "needed", "me", AT)).toThrow()
  })
  it("an office role with a reason can, and the reason is recorded", () => {
    const r = publishWeek(week, office, [v("block")], " cover needed ", "me", AT)
    expect(r.week.status).toBe("published")
    expect(r.entry.reason).toBe("cover needed")
  })
  it("read-only roles and published weeks are refused", () => {
    expect(() => publishWeek(week, acc({}), [], null, "me", AT)).toThrow()
    expect(() => publishWeek({ ...week, status: "published" }, office, [], null, "me", AT)).toThrow()
  })
})

describe("editPublished", () => {
  it("records before and after, clears confirmedAt and keeps the rest", () => {
    const r = editPublished(shift, { start: "19:00" }, office, "late open", "me", AT)
    expect(r.shift).toMatchObject({ start: "19:00", end: "02:00", confirmedAt: null })
    expect(r.entry).toMatchObject({ shiftId: "s1", weekId: "w1", locationId: "L1", action: "edit-published", reason: "late open", before: { start: "18:00" }, after: { start: "19:00" } })
    expect(shift.confirmedAt).not.toBeNull()
  })
  it("throws for a supervisor (AC-RS-05) and on an empty reason", () => {
    expect(() => editPublished(shift, { start: "19:00" }, supervisor, "why", "me", AT)).toThrow()
    expect(() => editPublished(shift, { start: "19:00" }, office, "  ", "me", AT)).toThrow()
  })
})

describe("location scope", () => {
  const limited = acc({ scope: "all", locationIds: ["L2"], editDraft: true, editPublished: true, approve: true })
  it("an office role limited away from the shift's location cannot edit or decide", () => {
    expect(() => editPublished(shift, { start: "19:00" }, limited, "why", "me", AT)).toThrow()
    const req = requestChange(shift, { start: "20:00" }, "x", "sup", AT, ["cr-9"])
    expect(() => decideRequest(req, shift, limited, true, null, "me", AT)).toThrow()
  })
  it("history ids are unique for repeated edits in the same second", () => {
    const a = editPublished(shift, { start: "19:00" }, office, "a", "me", AT).entry.id
    const b = editPublished(shift, { start: "19:00" }, office, "a", "me", AT).entry.id
    expect(a).not.toBe(b)
  })
  it("decideRequest refuses a request that belongs to another shift or week", () => {
    const req = requestChange(shift, { start: "20:00" }, "x", "sup", AT, ["cr-8"])
    expect(() => decideRequest(req, { ...shift, id: "other" }, office, true, null, "me", AT)).toThrow()
    expect(() => decideRequest(req, { ...shift, weekId: "w2" }, office, true, null, "me", AT)).toThrow()
  })
})

describe("change requests", () => {
  const req = requestChange(shift, { start: "20:00" }, "event moved", "sup", AT, ["cr-1"])
  it("builds an open request", () => {
    expect(req).toEqual({ id: "cr-1", weekId: "w1", shiftId: "s1", by: "sup", at: AT, patch: { start: "20:00" }, why: "event moved", status: "open", decidedBy: null, decidedAt: null, note: null })
    expect(() => requestChange(shift, {}, "x", "sup", AT, ["cr-2"])).toThrow()
    expect(() => requestChange(shift, { start: "20:00" }, " ", "sup", AT, ["cr-2"])).toThrow()
  })
  it("approving applies the patch, clears confirmedAt and logs", () => {
    const r = decideRequest(req, shift, office, true, "ok", "boss", AT)
    expect(r.request).toMatchObject({ status: "approved", decidedBy: "boss", decidedAt: AT, note: "ok" })
    expect(r.shift).toMatchObject({ start: "20:00", confirmedAt: null })
    expect(r.entry).toMatchObject({ shiftId: "s1", locationId: "L1", before: { start: "18:00" }, after: { start: "20:00" } })
  })
  it("rejecting leaves the shift unchanged", () => {
    const r = decideRequest(req, shift, office, false, "no", "boss", AT)
    expect(r.request.status).toBe("rejected")
    expect(r.shift).toBe(shift)
    expect(r.entry).toBeNull()
  })
  it("a supervisor cannot decide, and a decided request cannot be decided again", () => {
    expect(() => decideRequest(req, shift, supervisor, true, null, "sup", AT)).toThrow()
    const done = decideRequest(req, shift, office, true, null, "boss", AT).request
    expect(() => decideRequest(done, shift, office, false, null, "boss", AT)).toThrow()
  })
})

describe("patch keys are whitelisted", () => {
  it("a request or an edit with a key outside the list throws", () => {
    for (const patch of [{ locationId: "L2" }, { id: "x" }, { confirmedAt: null }, { weekId: "w9" }] as Partial<RosterShift>[]) {
      expect(() => requestChange(shift, patch, "why", "sup", AT, ["cr-x"])).toThrow(/change/i)
    }
    expect(() => editPublished(shift, { locationId: "L2" } as Partial<RosterShift>, office, "why", "me", AT)).toThrow(/change/i)
    expect(() => editPublished(shift, { start: "25:00" }, office, "why", "me", AT)).toThrow()
    expect(() => editPublished(shift, { unpaidBreakMin: -5 }, office, "why", "me", AT)).toThrow()
  })
  it("an approved request cannot be forced to another location or week by a crafted patch", () => {
    const crafted = { id: "cr-z", weekId: "w1", shiftId: "s1", by: "sup", at: AT, patch: { locationId: "L2", weekId: "w9" } as Partial<RosterShift>, why: "x", status: "open" as const, decidedBy: null, decidedAt: null, note: null }
    expect(() => decideRequest(crafted, shift, office, true, null, "boss", AT)).toThrow(/change/i)
  })
  it("a request cannot move a shift into another week, but a same-week day change is fine", () => {
    const next = requestChange(shift, { date: "2026-10-27" }, "x", "sup", AT, ["cr-n"])
    expect(() => decideRequest(next, shift, office, true, null, "boss", AT)).toThrow(/week/i)
    const same = requestChange(shift, { date: "2026-10-22" }, "x", "sup", AT, ["cr-s"])
    expect(decideRequest(same, shift, office, true, null, "boss", AT).shift.date).toBe("2026-10-22")
  })
  it("the office edit path may carry the week id (a move across weeks), nothing else extra", () => {
    const wk = (id: string, locationId: string) => ({ id, locationId, weekStart: "2026-10-26", status: "published" as const, publishedAt: null, publishedBy: null, autoRepeatDays: null })
    const c = { members: [], templates: [], ctx: { shifts: [shift], members: [], leave: [], availability: [], templates: [], avgWeekReferenceWeeks: 17, tz: "Europe/Dublin", visibleLocationIds: null, severity: {} } as unknown as RuleContext, weeks: [wk("w2", "L1"), wk("w3", "L2")] }
    expect(editPublished(shift, { weekId: "w2" }, office, "why", "me", AT, c).shift).toMatchObject({ weekId: "w2" })
    expect(() => editPublished(shift, { weekId: "w3" }, office, "why", "me", AT, c)).toThrow(/week/i) // another location's week
    expect(() => editPublished(shift, { weekId: "w9" }, office, "why", "me", AT, c)).toThrow(/week/i) // no such week
    expect(() => editPublished(shift, { weekId: "w2" }, office, "why", "me", AT)).toThrow(/week/i) // no weeks to check against
    expect(editPublished(shift, { weekId: "w1", start: "19:00" }, office, "why", "me", AT).shift.start).toBe("19:00") // its own week is fine
  })
})

describe("eligibility and the blocking rule check before a published change applies", () => {
  const tpl: ShiftTemplate = { id: "t1", locationId: "L1", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 30, role: "Door", requires: ["PSA"] }
  const mem = (id: string, quals: WorkforceMember["qualifications"] = [{ type: "PSA", expires: "2027-01-01" }], leftOn: string | null = null): WorkforceMember => ({ id, name: id.toUpperCase(), role: "r", dept: "d", homeLocationId: "L1", qualifications: quals, leftOn })
  const busy: RosterShift = { ...shift, id: "s2", personId: "p2", date: "2026-10-21", start: "10:00", end: "14:00" }
  const check = (members: WorkforceMember[], shifts: RosterShift[] = [shift, busy]): PatchCheck => ({
    members, templates: [tpl],
    ctx: { shifts, members, leave: [], availability: [], templates: [tpl], avgWeekReferenceWeeks: 17, tz: "Europe/Dublin", visibleLocationIds: ["L1"],
      severity: { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "warn", weekly_rest: "warn", avg_48h: "warn", expired_licence: "warn", left: "warn" } } as RuleContext,
  })
  it("a person without a valid licence is refused whoever approves", () => {
    const c = check([mem("p1"), mem("p2", [])])
    expect(() => editPublished(shift, { personId: "p2" }, office, "cover", "me", AT, c)).toThrow(/licence/i)
    const req = requestChange(shift, { personId: "p2" }, "cover", "sup", AT, ["cr-1"])
    expect(() => decideRequest(req, shift, office, true, null, "boss", AT, undefined, c)).toThrow(/licence/i)
  })
  it("someone who left, or a person missing from the list, is refused", () => {
    expect(() => editPublished(shift, { personId: "p2" }, office, "cover", "me", AT, check([mem("p1"), mem("p2", undefined, "2026-10-01")]))).toThrow(/left/i)
    expect(() => editPublished(shift, { personId: "p9" }, office, "cover", "me", AT, check([mem("p1")]))).toThrow(/verify/i)
  })
  it("a change that double-books throws; the approver can go ahead with a reason, the edit's own reason counts", () => {
    const c = check([mem("p1"), mem("p2")], [shift, { ...busy, personId: "p2", date: "2026-10-20", start: "20:00", end: "23:00" }])
    const req = requestChange(shift, { personId: "p2" }, "cover", "sup", AT, ["cr-2"])
    expect(() => decideRequest(req, shift, office, true, null, "boss", AT, undefined, c)).toThrow(BlockedError)
    expect(() => decideRequest(req, shift, office, true, null, "boss", AT, "  ", c)).toThrow(BlockedError)
    const r = decideRequest(req, shift, office, true, null, "boss", AT, "short staffed", c)
    expect(r.shift.personId).toBe("p2")
    expect(r.entry?.reason).toContain("short staffed")
    expect(editPublished(shift, { personId: "p2" }, office, "short staffed", "me", AT, c).shift.personId).toBe("p2")
  })
  it("a time change alone keeps the person already on the shift, and an unrelated old warning does not block", () => {
    const c = check([mem("p1", [])]) // licence long gone, still on the shift
    expect(editPublished(shift, { start: "19:00" }, office, "later start", "me", AT, c).shift.start).toBe("19:00")
  })
  it("a clean change applies as before", () => {
    const c = check([mem("p1"), mem("p2")])
    expect(editPublished(shift, { personId: "p2" }, office, "cover", "me", AT, c).shift.personId).toBe("p2")
  })
})
