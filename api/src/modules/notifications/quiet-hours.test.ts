import { describe, expect, test } from "vitest"
import { quietWindow } from "./quiet-hours"

const P = { quietStart: "22:00", quietEnd: "07:00" }
const w = (prefs: { quietStart: string | null; quietEnd: string | null }, tz: string, iso: string) => {
  const r = quietWindow(prefs, tz, new Date(iso))
  return { quiet: r.quiet, endsAt: r.endsAt.toISOString() }
}

describe("quietWindow", () => {
  test("no window, or start == end: never quiet, endsAt is now", () => {
    const now = "2026-11-16T23:30:00.000Z"
    expect(w({ quietStart: null, quietEnd: null }, "Europe/Dublin", now)).toEqual({ quiet: false, endsAt: now })
    expect(w({ quietStart: "22:00", quietEnd: "22:00" }, "Europe/Dublin", now)).toEqual({ quiet: false, endsAt: now })
  })

  test("a window spanning midnight (22:00-07:00, winter)", () => {
    expect(w(P, "Europe/Dublin", "2026-11-16T09:00:00Z")).toEqual({ quiet: false, endsAt: "2026-11-16T09:00:00.000Z" })
    expect(w(P, "Europe/Dublin", "2026-11-16T23:30:00Z")).toEqual({ quiet: true, endsAt: "2026-11-17T07:00:00.000Z" })
    expect(w(P, "Europe/Dublin", "2026-11-17T03:00:00Z")).toEqual({ quiet: true, endsAt: "2026-11-17T07:00:00.000Z" })
    expect(w(P, "Europe/Dublin", "2026-11-16T22:00:00Z").quiet).toBe(true) // start inclusive
    expect(w(P, "Europe/Dublin", "2026-11-16T21:59:00Z").quiet).toBe(false)
    expect(w(P, "Europe/Dublin", "2026-11-17T06:59:00Z").quiet).toBe(true)
    expect(w(P, "Europe/Dublin", "2026-11-17T07:00:00Z").quiet).toBe(false) // end exclusive
  })

  test("a same-day window (13:00-14:30), in summer time", () => {
    const d = { quietStart: "13:00", quietEnd: "14:30" }
    expect(w(d, "Europe/Dublin", "2026-07-01T12:15:00Z")).toEqual({ quiet: true, endsAt: "2026-07-01T13:30:00.000Z" }) // 13:15 IST
    expect(w(d, "Europe/Dublin", "2026-07-01T13:30:00Z").quiet).toBe(false)
    expect(w(d, "Europe/Dublin", "2026-07-01T11:59:00Z").quiet).toBe(false)
  })

  test("is computed in the given zone, not the server's", () => {
    // 17:00Z is 22:30 in Asia/Kolkata (UTC+5:30, no DST) but 17:00 in Dublin winter
    expect(w(P, "Asia/Kolkata", "2026-11-16T17:00:00Z")).toEqual({ quiet: true, endsAt: "2026-11-17T01:30:00.000Z" })
    expect(w(P, "Europe/Dublin", "2026-11-16T17:00:00Z").quiet).toBe(false)
  })

  test("autumn DST change (Europe/Dublin, 2026-10-25 02:00 IST -> 01:00 GMT): the window ends at 07:00 LOCAL, an hour later in UTC", () => {
    expect(w(P, "Europe/Dublin", "2026-10-24T20:59:00Z").quiet).toBe(false) // 21:59 IST
    expect(w(P, "Europe/Dublin", "2026-10-24T21:00:00Z").quiet).toBe(true) // 22:00 IST
    expect(w(P, "Europe/Dublin", "2026-10-24T22:30:00Z")).toEqual({ quiet: true, endsAt: "2026-10-25T07:00:00.000Z" }) // 23:30 IST, 07:00 GMT
    expect(w(P, "Europe/Dublin", "2026-10-25T00:30:00Z")).toEqual({ quiet: true, endsAt: "2026-10-25T07:00:00.000Z" }) // 01:30 IST (first pass)
    expect(w(P, "Europe/Dublin", "2026-10-25T01:30:00Z")).toEqual({ quiet: true, endsAt: "2026-10-25T07:00:00.000Z" }) // 01:30 GMT (second pass)
    expect(w(P, "Europe/Dublin", "2026-10-25T06:59:00Z").quiet).toBe(true)
    expect(w(P, "Europe/Dublin", "2026-10-25T07:00:00Z").quiet).toBe(false)
  })

  test("spring DST change (Europe/Dublin, 2027-03-28 01:00 GMT -> 02:00 IST): the window ends at 07:00 LOCAL, an hour earlier in UTC", () => {
    expect(w(P, "Europe/Dublin", "2027-03-27T23:30:00Z")).toEqual({ quiet: true, endsAt: "2027-03-28T06:00:00.000Z" }) // 23:30 GMT, 07:00 IST
    expect(w(P, "Europe/Dublin", "2027-03-28T00:30:00Z")).toEqual({ quiet: true, endsAt: "2027-03-28T06:00:00.000Z" })
    expect(w(P, "Europe/Dublin", "2027-03-28T05:59:00Z").quiet).toBe(true) // 06:59 IST
    expect(w(P, "Europe/Dublin", "2027-03-28T06:00:00Z").quiet).toBe(false) // 07:00 IST
    expect(w(P, "Europe/Dublin", "2027-03-28T20:59:00Z").quiet).toBe(false) // 21:59 IST
    expect(w(P, "Europe/Dublin", "2027-03-28T21:00:00Z")).toEqual({ quiet: true, endsAt: "2027-03-29T06:00:00.000Z" }) // 22:00 IST
  })

  test("a window boundary inside the spring gap (01:30-03:00) still resolves to a real instant", () => {
    const g = { quietStart: "01:30", quietEnd: "03:00" }
    expect(w(g, "Europe/Dublin", "2027-03-28T00:59:00Z").quiet).toBe(false) // 00:59 GMT
    expect(w(g, "Europe/Dublin", "2027-03-28T01:00:00Z")).toEqual({ quiet: true, endsAt: "2027-03-28T02:00:00.000Z" }) // 02:00 IST .. 03:00 IST
  })
})

describe("quietWindow endsAt is always a real, non-quiet instant after now (DST gaps, UTC-negative zones)", () => {
  const zones = ["America/New_York", "America/Los_Angeles", "America/Sao_Paulo", "Europe/Dublin", "Europe/Berlin", "Australia/Sydney", "Australia/Lord_Howe", "Asia/Kolkata"]
  // days around the 2026/2027 transitions of every zone above (UTC dates, one day either side)
  const days = ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-28", "2026-03-29", "2026-04-04", "2026-04-05", "2026-10-03", "2026-10-04", "2026-10-24", "2026-10-25", "2026-11-01", "2026-11-02",
    "2027-03-13", "2027-03-14", "2027-03-27", "2027-03-28", "2027-04-03", "2027-04-04", "2027-10-02", "2027-10-03", "2027-10-30", "2027-10-31", "2027-11-07", "2027-11-08"]
  const windows = [["22:00", "02:30"], ["22:00", "07:00"], ["23:00", "01:30"], ["21:00", "02:15"], ["00:30", "02:30"], ["01:00", "03:00"], ["13:00", "14:30"], ["22:30", "02:00"]] as const

  test("property: endsAt > now and not quiet at endsAt", () => {
    let checked = 0
    for (const tz of zones) for (const day of days) for (const [quietStart, quietEnd] of windows) for (let h = 0; h < 24; h++) for (const m of [0, 30]) {
      const now = new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`)
      const r = quietWindow({ quietStart, quietEnd }, tz, now)
      if (!r.quiet) continue
      checked++
      const ctx = `${tz} ${quietStart}-${quietEnd} now=${now.toISOString()} endsAt=${r.endsAt.toISOString()}`
      expect(r.endsAt.getTime(), ctx).toBeGreaterThan(now.getTime())
      expect(quietWindow({ quietStart, quietEnd }, tz, r.endsAt).quiet, ctx).toBe(false)
      expect(r.endsAt.getTime() - now.getTime(), ctx).toBeLessThanOrEqual(27 * 3600_000)
    }
    expect(checked).toBeGreaterThan(1000)
  })

  test("regression: New York 22:00-02:30 on the night of the spring change ends at 03:00 EDT, not 01:30 EST", () => {
    const r = quietWindow({ quietStart: "22:00", quietEnd: "02:30" }, "America/New_York", new Date("2026-03-08T03:00:00Z")) // 22:00 EST
    expect(r.quiet).toBe(true)
    expect(quietWindow({ quietStart: "22:00", quietEnd: "02:30" }, "America/New_York", r.endsAt).quiet).toBe(false)
    expect(r.endsAt.getTime()).toBeGreaterThan(new Date("2026-03-08T06:59:00Z").getTime())
  })
})
