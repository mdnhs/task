import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { readAuto, readDismissed, readSnoozed, todaySubject, writeAuto, writeDismissed, writeSnoozed } from "./today-prefs"

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  const g = globalThis as Record<string, unknown>
  g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } }
  g.document = { cookie: "" }
})
afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.window
  delete g.document
})

describe("T6.7 fix: Today prefs are keyed by tenant AND user (a person in two companies keeps two choices)", () => {
  test("the subject carries the tenant slug and the user id", () => {
    expect(todaySubject("coppers", "usr_1")).toBe("coppers:usr_1")
    expect(todaySubject("acme", "usr_1")).not.toBe(todaySubject("coppers", "usr_1"))
  })
  test("auto, dismissed and snoozed in one tenant are not seen in the other", () => {
    const a = todaySubject("coppers", "usr_1")
    const b = todaySubject("acme", "usr_1")
    writeAuto(a, true)
    writeDismissed(a, "2026-10-24", true)
    writeSnoozed(a, "2026-10-24", ["TSK-1"])
    expect(readAuto(a)).toBe(true)
    expect(readDismissed(a, "2026-10-24")).toBe(true)
    expect(readSnoozed(a, "2026-10-24")).toEqual(["TSK-1"])
    expect(readAuto(b)).toBe(false)
    expect(readDismissed(b, "2026-10-24")).toBe(false)
    expect(readSnoozed(b, "2026-10-24")).toEqual([])
  })
  test("an old key written for the bare user id is simply ignored (no migration)", () => {
    store.set("opsdesk:today:auto:usr_1", "1")
    expect(readAuto(todaySubject("coppers", "usr_1"))).toBe(false)
  })
})
