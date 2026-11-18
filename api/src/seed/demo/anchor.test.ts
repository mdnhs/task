import { describe, expect, test } from "vitest"
import { latestReportOffset, makeAnchor, todayIn, weekOffset } from "./anchor"

const TZ = "Europe/Dublin"

describe("re-anchoring the mock dates", () => {
  test("the mock's today maps to the anchor day, keeping the same day offset and the local wall time", () => {
    const a = makeAnchor({ mockToday: "2026-10-20T09:00:00", anchor: "2026-12-01", tz: TZ })
    expect(a.offsetDays).toBe(42)
    expect(a.day("2026-10-20")).toBe("2026-12-01")
    expect(a.day("2026-10-12")).toBe("2026-11-23") // 8 days before
    expect(a.wall("2026-10-19T16:10:00")).toBe("2026-11-30T16:10:00")
    expect(a.wall("2026-10-14T14:20")).toBe("2026-11-25T14:20") // minutes-only wall strings keep their precision
  })

  test("a wall time keeps its local value across the 25 Oct DST end (the instant moves by an hour, the wall does not)", () => {
    const same = makeAnchor({ mockToday: "2026-10-20T09:00:00", anchor: "2026-10-20", tz: TZ })
    const later = makeAnchor({ mockToday: "2026-10-20T09:00:00", anchor: "2026-12-01", tz: TZ })
    // 2026-10-24 17:00 is BST (+01:00), the shifted 2026-12-05 17:00 is GMT (+00:00)
    expect(same.instant("2026-10-24T17:00:00").toISOString()).toBe("2026-10-24T16:00:00.000Z")
    expect(later.instant("2026-10-24T17:00:00").toISOString()).toBe("2026-12-05T17:00:00.000Z")
    expect(later.wall("2026-10-24T17:00:00")).toBe("2026-12-05T17:00:00")
  })

  test("an anchor that is not a real calendar day is refused", () => {
    expect(() => makeAnchor({ mockToday: "2026-10-20T09:00:00", anchor: "2026-13-40", tz: TZ })).toThrow(/anchor/)
    expect(() => makeAnchor({ mockToday: "2026-10-20T09:00:00", anchor: "tomorrow", tz: TZ })).toThrow(/anchor/)
  })

  test("todayIn reads the clock in the tenant zone, not the server's", () => {
    // 23:30 UTC on 30 Jun is already 1 Jul in Dublin (IST)
    expect(todayIn(new Date("2026-06-30T23:30:00Z"), TZ)).toBe("2026-07-01")
    expect(todayIn(new Date("2026-06-30T23:30:00Z"), "UTC")).toBe("2026-06-30")
  })
})

describe("--anchor latest-report", () => {
  test("the weekday-bound offset puts the newest mock report day exactly on the anchor day (the default only keeps it on or before, in whole weeks)", () => {
    const o = { mockToday: "2026-10-20T09:00:00", anchor: "2026-12-04", latestMockDay: "2026-10-19" }
    const exact = latestReportOffset(o)
    expect(exact).toBe(46)
    expect(makeAnchor({ mockToday: o.mockToday, anchor: o.anchor, tz: TZ, offsetDays: exact }).day("2026-10-19")).toBe("2026-12-04")
    // the default is a whole number of weeks, so the newest report can sit up to 6 days before the anchor day
    expect(weekOffset(o)).toBe(42)
    expect(weekOffset(o)).not.toBe(exact)
  })
  test("a newest report after the anchor day gives a negative offset (still lands on the anchor day)", () => {
    expect(latestReportOffset({ anchor: "2026-10-01", latestMockDay: "2026-10-19" })).toBe(-18)
  })
})
