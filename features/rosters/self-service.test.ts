import { describe, expect, it } from "vitest"
import { toExchange, toLeave } from "./adapters"
import { exchangeDto, leaveDto } from "./fixtures"
import { canCancelLeave, endsAfter, halves, isUpcoming, leaveKindLabel, myRequests, realMinutes, toDecide, validateAvailability, validateLeave, windowsBody } from "./self-service"

// B8 Task 22: the My roster helpers on the API's shapes. The API decides every request again; these shape what the page offers.
const leave = (o: Partial<ReturnType<typeof toLeave>> = {}) => ({ ...toLeave(leaveDto), ...o })

describe("leave", () => {
  it("own leave never shows Approve: toDecide drops the caller's own requests whatever the list holds, and decided ones", () => {
    const own = leave({ id: "a", personId: "me" })
    const other = leave({ id: "b", personId: "p2", from: "2026-12-01" })
    const earlier = leave({ id: "c", personId: "p3", from: "2026-11-20" })
    const done = leave({ id: "d", personId: "p4", status: "approved" })
    expect(toDecide([own, other, earlier, done], "me").map((l) => l.id)).toEqual(["c", "b"])
    expect(toDecide([own], "me")).toEqual([]) // staff: the API lists only their own, so nothing to decide
    expect(toDecide([own, other], "")).toEqual([]) // no known caller: nothing is offered
  })
  it("cancel is offered for a waiting or approved leave that has not started; never a decided-against one", () => {
    expect(canCancelLeave(leave({ from: "2026-12-01" }), "2026-11-19T09:00:00")).toBe(true)
    expect(canCancelLeave(leave({ from: "2026-11-19", status: "approved" }), "2026-11-19T09:00:00")).toBe(false) // starts today: the API's 422 leave_started
    expect(canCancelLeave(leave({ status: "rejected" }), "2026-11-19")).toBe(false)
  })
  it("checks dates and type before sending; kinds show a label, an unknown one as stored", () => {
    expect(validateLeave({ from: "", to: "", kind: "annual" })).toEqual({ from: "Pick a start date", to: "Pick an end date" })
    expect(validateLeave({ from: "2026-12-05", to: "2026-12-01", kind: "annual" })).toEqual({ to: "End is before the start" })
    expect([leaveKindLabel("sick"), leaveKindLabel("compassionate")]).toEqual(["Sick", "compassionate"])
  })
})

describe("availability", () => {
  it("an overnight window is split at midnight as the API stores it; an identical one is refused; the set is sent whole", () => {
    expect(halves({ weekday: 5, from: "22:00", to: "06:00" })).toEqual([{ weekday: 5, from: "22:00", to: "24:00" }, { weekday: 6, from: "00:00", to: "06:00" }])
    expect(halves({ weekday: 0, from: "20:00", to: "00:00" })).toEqual([{ weekday: 0, from: "20:00", to: "24:00" }])
    const have = [{ personId: "me", weekday: 5, from: "22:00", to: "24:00" }, { personId: "me", weekday: 6, from: "00:00", to: "06:00" }] as const
    expect(validateAvailability({ weekday: 5, from: "22:00", to: "06:00" }, [...have])).toBe("Already added")
    expect(validateAvailability({ weekday: 1, from: "09:00", to: "09:00" })).toBe("Start and end must differ")
    expect(windowsBody([...have], { add: { weekday: 1, from: "09:00", to: "12:00" } })).toEqual([{ weekday: 5, from: "22:00", to: "24:00" }, { weekday: 6, from: "00:00", to: "06:00" }, { weekday: 1, from: "09:00", to: "12:00" }])
    expect(windowsBody([...have], { drop: have[0] })).toEqual([{ weekday: 6, from: "00:00", to: "06:00" }])
  })
})

describe("shifts and requests", () => {
  it("still to come and length come from the API's instants (a clock-change night is its real length)", () => {
    const night = { startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z" }
    expect(realMinutes(night)).toBe(540)
    expect(endsAfter(night, "2026-10-25T05:59:00.000Z")).toBe(true)
    expect(endsAfter(night, "2026-10-25T06:00:00.000Z")).toBe(false)
    expect(isUpcoming({ date: "2026-11-02", start: "22:00", end: "06:00" }, "2026-11-03T05:00:00", "Europe/Dublin")).toBe(true)
  })
  it("my requests: my own open claims and swaps (cancel) and swaps offered to me (decline); decided ones are not shown", () => {
    const base = toExchange(exchangeDto)
    const claim = { ...base, id: "1", fromUserId: "me" }
    const offered = { ...base, id: "2", kind: "swap" as const, fromUserId: "p2", toUserId: "me" }
    const done = { ...base, id: "3", fromUserId: "me", status: "approved" as const }
    const others = { ...base, id: "4", fromUserId: "p2" }
    expect(myRequests([claim, offered, done, others], "me")).toEqual({ mine: [claim], offered: [offered] })
    expect(myRequests([claim], "")).toEqual({ mine: [], offered: [] })
  })
})
