import { describe, expect, test } from "vitest"
import { dayBoundsInTz, wallInTz } from "./tz"

describe("dayBoundsInTz: a tenant calendar day as UTC instants", () => {
  test("a normal day", () => expect(dayBoundsInTz("2026-11-18", "Europe/Dublin")).toEqual({ from: "2026-11-18T00:00:00.000Z", to: "2026-11-18T23:59:59.999Z" }))
  test("the day DST ends in Dublin (25 Oct 2026) is 25 hours long", () => expect(dayBoundsInTz("2026-10-25", "Europe/Dublin")).toEqual({ from: "2026-10-24T23:00:00.000Z", to: "2026-10-25T23:59:59.999Z" }))
  test("the day DST starts in Dublin (29 Mar 2026) is 23 hours long", () => expect(dayBoundsInTz("2026-03-29", "Europe/Dublin")).toEqual({ from: "2026-03-29T00:00:00.000Z", to: "2026-03-29T22:59:59.999Z" }))
  test("a zone ahead of UTC", () => expect(dayBoundsInTz("2026-11-18", "Pacific/Auckland")).toEqual({ from: "2026-11-17T11:00:00.000Z", to: "2026-11-18T10:59:59.999Z" }))
  test("round trip: the start instant is local midnight", () => expect(wallInTz(dayBoundsInTz("2026-06-01", "America/New_York").from, "America/New_York")).toBe("2026-06-01T00:00:00"))
  test("a bad day or zone throws", () => {
    expect(() => dayBoundsInTz("nope", "UTC")).toThrow()
    expect(() => dayBoundsInTz("2026-11-18", "Not/AZone")).toThrow()
  })
})

describe("dayBoundsInTz in zones whose midnight does not exist (the domain's wallToEpoch rule, R8-1)", () => {
  test("Havana, 8 Mar 2026: midnight is skipped, the day starts at the transition", () => expect(dayBoundsInTz("2026-03-08", "America/Havana")).toEqual({ from: "2026-03-08T05:00:00.000Z", to: "2026-03-09T03:59:59.999Z" }))
  test("Santiago, 6 Sep 2026: midnight is skipped, the day starts at the transition", () => expect(dayBoundsInTz("2026-09-06", "America/Santiago")).toEqual({ from: "2026-09-06T04:00:00.000Z", to: "2026-09-07T02:59:59.999Z" }))
  test("Cairo, 25 Oct 2026: the day is 25 hours", () => expect(dayBoundsInTz("2026-10-25", "Africa/Cairo")).toEqual({ from: "2026-10-24T21:00:00.000Z", to: "2026-10-25T20:59:59.999Z" }))
})
