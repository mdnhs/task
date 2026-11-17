import { describe, expect, test } from "vitest"
import { activityFromSessions, kindOf, securityFromSessions, wallTime } from "./security-data"

const items = [
  { id: "s1", label: "Chrome on macOS", createdAt: "2026-11-18T08:55:00.000Z", lastSeenAt: "2026-11-18T09:30:00.000Z", current: true },
  { id: "s2", label: "Safari on iOS", createdAt: "2026-11-17T18:12:00.000Z", lastSeenAt: "2026-11-17T18:20:00.000Z", current: false },
  { id: "s3", label: "Edge on Windows", createdAt: "2026-11-10T11:40:00.000Z", lastSeenAt: "2026-11-16T11:40:00.000Z", current: false },
]

describe("T6.3 the Security tab's data from GET /v1/me/sessions (I21)", () => {
  test("wallTime renders the instant as the tenant's wall clock, across DST", () => {
    expect(wallTime("2026-11-18T09:30:00.000Z", "Europe/Dublin")).toBe("2026-11-18T09:30:00")
    expect(wallTime("2026-07-01T09:30:00.000Z", "Europe/Dublin")).toBe("2026-07-01T10:30:00")
    expect(wallTime("2026-11-18T23:30:00.000Z", "Asia/Dubai")).toBe("2026-11-19T03:30:00")
    expect(wallTime("garbage", "Europe/Dublin")).toBe("")
  })

  test("a phone label is a phone, everything else a laptop; no location anywhere", () => {
    expect(kindOf("Safari on iOS")).toBe("phone")
    expect(kindOf("Chrome on Android")).toBe("phone")
    expect(kindOf("Chrome on macOS")).toBe("laptop")
    expect(kindOf("Unknown device")).toBe("laptop")
  })

  test("sessions keep the API order, the current one is marked, and only label, last-seen and current are used", () => {
    const d = securityFromSessions(items, { timezone: "Europe/Dublin", twoFactorEnabled: true })
    expect(d.mfa).toBe(true)
    expect(d.resetLinkMinutes).toBe(60)
    expect(d.sessions.map((s) => [s.id, s.device, s.kind, s.lastActive, s.current])).toEqual([
      ["s1", "Chrome on macOS", "laptop", "2026-11-18T09:30:00", true],
      ["s2", "Safari on iOS", "phone", "2026-11-17T18:20:00", false],
      ["s3", "Edge on Windows", "laptop", "2026-11-16T11:40:00", false],
    ])
    expect(JSON.stringify(d)).not.toMatch(/location|token|ip/i)
  })

  test("the activity list is the last five sign-ins, newest first", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, label: "Chrome on macOS", createdAt: `2026-11-1${i}T08:00:00.000Z`, lastSeenAt: `2026-11-1${i}T08:00:00.000Z`, current: i === 7 }))
    const a = activityFromSessions(many, "Europe/Dublin")
    expect(a).toHaveLength(5)
    expect(a[0]).toMatchObject({ text: "Signed in from Chrome on macOS", at: "2026-11-17T08:00:00" })
    expect(a.map((x) => x.at)).toEqual([...a.map((x) => x.at)].sort().reverse())
  })
})
