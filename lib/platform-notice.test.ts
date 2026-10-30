import { describe, expect, it } from "vitest"

import { activeNotice, noticeKey, type PlatformNotice } from "./platform-notice"

const NOW = "2026-10-20T09:00:00"
const notice = (over: Partial<PlatformNotice> = {}): PlatformNotice => ({ kind: "maintenance", message: "Planned maintenance on Sunday 02:00-03:00.", endsAt: null, ...over })

describe("activeNotice", () => {
  it("is null without an announcement", () => {
    expect(activeNotice({ announcement: null }, NOW)).toBeNull()
    expect(activeNotice(null, NOW)).toBeNull()
  })
  it("shows an announcement with no end", () => {
    expect(activeNotice({ announcement: notice() }, NOW)).toEqual(notice())
  })
  it("shows it until endsAt and is null from endsAt on", () => {
    expect(activeNotice({ announcement: notice({ endsAt: "2026-10-20T09:01:00" }) }, NOW)?.kind).toBe("maintenance")
    expect(activeNotice({ announcement: notice({ endsAt: "2026-10-20T09:00:00" }) }, NOW)).toBeNull()
    expect(activeNotice({ announcement: notice({ endsAt: "2026-10-19T23:30" }) }, NOW)).toBeNull()
  })
  it("ignores a blank message", () => {
    expect(activeNotice({ announcement: notice({ message: "   " }) }, NOW)).toBeNull()
  })
  it("trims the message", () => {
    expect(activeNotice({ announcement: notice({ message: "  Hello  " }) }, NOW)?.message).toBe("Hello")
  })
})

describe("noticeKey", () => {
  it("changes when the announcement changes, so a new one shows again after a dismiss", () => {
    expect(noticeKey(notice())).toBe(noticeKey(notice()))
    expect(noticeKey(notice())).not.toBe(noticeKey(notice({ message: "Other" })))
    expect(noticeKey(notice())).not.toBe(noticeKey(notice({ kind: "info" })))
  })
})
