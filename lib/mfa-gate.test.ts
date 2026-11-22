import { describe, expect, test } from "vitest"
import { mfaGateCopy, mfaGraceDaysLeft, mfaGraceEndsAtOf, mfaPrompt } from "@/lib/mfa-gate"

const NOW = new Date("2026-12-01T10:00:00Z")

describe("mfaGateCopy: who turned it on", () => {
  test("the owner is told it is a workspace setting and where to change it (Settings > Roles); a non-owner that their admin turned it on", () => {
    const o = mfaGateCopy("owner")
    expect(o.reason).toBe("Two-step verification is required for this workspace. You can change this under Settings → Roles.")
    expect(mfaGateCopy("member").reason).toBe("Your workspace admin turned on two-step verification.")
    expect(o.effort).toBe("Takes about 2 minutes. You need an authenticator app on your phone.")
    expect(mfaGateCopy("member").effort).toBe(o.effort)
    for (const c of [o, mfaGateCopy("member")]) expect(c.reason).not.toMatch(/administrator requires/i)
  })
})

describe("grace period: one server-provided value behind a tiny adapter", () => {
  test("the adapter returns null (no grace) unless the API sent a valid ISO instant", () => {
    for (const v of [undefined, null, "", "soon", 5, {}]) expect(mfaGraceEndsAtOf({ mfaGraceEndsAt: v })).toBeNull()
    expect(mfaGraceEndsAtOf({})).toBeNull()
    expect(mfaGraceEndsAtOf(undefined)).toBeNull()
    expect(mfaGraceEndsAtOf({ mfaGraceEndsAt: "2026-12-04T00:00:00.000Z" })).toBe("2026-12-04T00:00:00.000Z")
  })
  test("days left rounds up and is null once the deadline has passed", () => {
    expect(mfaGraceDaysLeft("2026-12-04T00:00:00.000Z", NOW)).toBe(3)
    expect(mfaGraceDaysLeft("2026-12-01T12:00:00.000Z", NOW)).toBe(1)
    expect(mfaGraceDaysLeft("2026-12-01T10:00:00.000Z", NOW)).toBeNull()
    expect(mfaGraceDaysLeft("2026-11-30T00:00:00.000Z", NOW)).toBeNull()
    expect(mfaGraceDaysLeft(null, NOW)).toBeNull()
  })
  const base = { required: true, enrolled: false, now: NOW }
  test("banner while the grace runs and the person is not enrolled; nothing after (the API gate takes over), when not required, or when enrolled", () => {
    expect(mfaPrompt({ ...base, graceEndsAt: "2026-12-04T00:00:00.000Z" })).toEqual({ kind: "banner", daysLeft: 3 })
    expect(mfaPrompt({ ...base, graceEndsAt: "2026-11-01T00:00:00.000Z" })).toEqual({ kind: "none" })
    expect(mfaPrompt({ ...base, graceEndsAt: null })).toEqual({ kind: "none" })
    expect(mfaPrompt({ ...base, required: false, graceEndsAt: "2026-12-04T00:00:00.000Z" })).toEqual({ kind: "none" })
    expect(mfaPrompt({ ...base, enrolled: true, graceEndsAt: "2026-12-04T00:00:00.000Z" })).toEqual({ kind: "none" })
  })
})
