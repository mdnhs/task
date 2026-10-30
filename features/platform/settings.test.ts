import { describe, expect, it } from "vitest"

import { fromSettings, paymentsLabel, settingsDiff, toSettings, validateSettings, type SettingsForm } from "./settings"
import type { PlatformSettings } from "./types"

const NOW = "2026-10-20T09:00:00"
const BASE: PlatformSettings = {
  payments: { provider: "Stripe", mode: "test", status: "connected" },
  defaultTrialDays: 14, retentionDays: 90, supportAccessHours: 24, announcement: null,
}
const form = (over: Partial<SettingsForm> = {}): SettingsForm => ({ ...fromSettings(BASE), ...over })

describe("paymentsLabel", () => {
  it("reads the provider and its mode", () => {
    expect(paymentsLabel(BASE.payments)).toBe("Stripe · Test mode")
    expect(paymentsLabel({ ...BASE.payments, mode: "live" })).toBe("Stripe · Live")
  })
})

describe("validateSettings", () => {
  it("accepts the seed", () => {
    expect(validateSettings(form(), NOW)).toEqual({})
  })
  it("checks whole numbers in range", () => {
    expect(validateSettings(form({ defaultTrialDays: "0" }), NOW).defaultTrialDays).toMatch(/1 to 90/)
    expect(validateSettings(form({ retentionDays: "12.5" }), NOW).retentionDays).toMatch(/whole number/)
    expect(validateSettings(form({ supportAccessHours: "200" }), NOW).supportAccessHours).toMatch(/1 to 72/)
  })
  it("needs a message for a shown announcement and an end after now", () => {
    expect(validateSettings(form({ announce: true, message: " " }), NOW).message).toMatch(/message/i)
    expect(validateSettings(form({ announce: true, message: "Hello there", endsAt: "2026-10-20T08:00" }), NOW).endsAt).toMatch(/after now/i)
    expect(validateSettings(form({ announce: true, message: "Hello there", endsAt: "2026-10-21T08:00" }), NOW)).toEqual({})
    expect(validateSettings(form({ announce: false, message: "" }), NOW)).toEqual({})
  })
  it("doesn't block an unrelated edit when the saved announcement's end has already passed", () => {
    const saved = form({ announce: true, message: "Hello there", endsAt: "2026-10-19T08:00" })
    expect(validateSettings({ ...saved, defaultTrialDays: "21" }, NOW, saved)).toEqual({})
    // Touching the end (or the announcement) checks it again.
    expect(validateSettings({ ...saved, endsAt: "2026-10-20T07:00" }, NOW, saved).endsAt).toMatch(/after now/i)
    expect(validateSettings({ ...saved, message: "Hello again" }, NOW, saved).endsAt).toMatch(/after now/i)
  })
})

describe("toSettings / settingsDiff", () => {
  it("keeps payments read-only and drops the announcement when it is off", () => {
    const next = toSettings(BASE, form({ defaultTrialDays: "21", announce: false, message: "kept in the form only" }))
    expect(next.payments).toBe(BASE.payments)
    expect(next.defaultTrialDays).toBe(21)
    expect(next.announcement).toBeNull()
  })
  it("builds the announcement with a seconds-precision end", () => {
    const next = toSettings(BASE, form({ announce: true, kind: "info", message: " New reports module ", endsAt: "2026-10-25T18:00" }))
    expect(next.announcement).toEqual({ kind: "info", message: "New reports module", endsAt: "2026-10-25T18:00:00" })
  })
  it("diffs only the changed fields", () => {
    const next = toSettings(BASE, form({ retentionDays: "120", announce: true, message: "Hello there" }))
    expect(settingsDiff(BASE, next)).toEqual({
      before: { retentionDays: 90, announcement: null },
      after: { retentionDays: 120, announcement: { kind: "info", message: "Hello there", endsAt: null } },
    })
    expect(settingsDiff(BASE, toSettings(BASE, form()))).toEqual({ before: {}, after: {} })
  })
})
