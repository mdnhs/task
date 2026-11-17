import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { makeActionRunner } from "@/lib/api/action"
import { ApiError, userMessage } from "@/lib/api/problem"
import { MAX_WRONG_CODES, makeCodeAttempts, prefsBody, toPrefs } from "./adapters"
import { makeAccountClient } from "./client"

const PREFS = {
  channels: {
    invite: { inApp: true, email: true, push: true }, member: { inApp: true, email: false, push: true }, file: { inApp: true, email: false, push: true },
    security: { inApp: true, email: true, push: true }, dsr: { inApp: true, email: true, push: true }, billing: { inApp: true, email: true, push: true },
    system: { inApp: true, email: false, push: true }, task: { inApp: true, email: false, push: true }, report: { inApp: true, email: false, push: false },
  },
  quietStart: "22:00", quietEnd: "07:00",
}

describe("T6.5 account: notification preferences", () => {
  test("toPrefs lists every kind the API has with its channels and quiet hours; a missing kind throws", () => {
    const p = toPrefs(PREFS)
    expect(p.rows.map((r) => r.kind)).toEqual(["task", "report", "member", "invite", "file", "dsr", "billing", "security", "system"])
    expect(p.rows.find((r) => r.kind === "report")).toMatchObject({ label: "Shift report", inApp: true, email: false, push: false })
    expect(p.rows.find((r) => r.kind === "security")!.locked).toBe(true)
    expect(p.quiet).toEqual({ start: "22:00", end: "07:00" })
    const { task: _t, ...partial } = PREFS.channels
    expect(() => toPrefs({ ...PREFS, channels: partial })).toThrow(/task/)
  })
  test("prefsBody sends one changed switch plus the quiet hours as they are", () => {
    expect(prefsBody(toPrefs(PREFS), { kind: "task", channel: "email", on: true })).toEqual({ channels: { task: { email: true } }, quietStart: "22:00", quietEnd: "07:00" })
    expect(prefsBody(toPrefs(PREFS), { quiet: null })).toEqual({ channels: {}, quietStart: null, quietEnd: null })
    expect(prefsBody(toPrefs(PREFS), { quiet: { start: "21:00", end: "06:30" } })).toEqual({ channels: {}, quietStart: "21:00", quietEnd: "06:30" })
  })
  test("savePrefs PUTs the body; an invalid quiet window has its own copy", async () => {
    const { client, calls } = fakeApi({ "PUT /v1/me/notification-preferences": PREFS })
    await makeAccountClient(client).savePrefs({ channels: { task: { email: true } }, quietStart: "22:00", quietEnd: "07:00" })
    expect(calls[0]).toMatchObject({ method: "put", path: "/v1/me/notification-preferences" })
    expect(userMessage(new ApiError(422, "invalid_quiet_hours", "r")).text).toBe("Pick two different times.")
  })
})

describe("T6.5 account: This device (enter a code)", () => {
  test("bindDevice POSTs the typed code to the device's bind route; the code is never kept", async () => {
    const dev = { id: "d1", userId: "u1", type: "pc", owner: "company", label: "Front desk PC", trusted: true, lastSeen: null }
    const { client, calls } = fakeApi({ "POST /v1/devices/{id}/bind": dev })
    await makeAccountClient(client).bindDevice("d1", " abcd2345jk ")
    expect(calls[0]).toMatchObject({ method: "post", path: "/v1/devices/{id}/bind", body: { code: "ABCD2345JK" } })
  })
  test("a wrong code shows one generic message (no hint which part was wrong)", async () => {
    const { client } = fakeApi({ "POST /v1/devices/{id}/bind": problem(422, "invalid_enrolment_code") })
    const e = await makeAccountClient(client).bindDevice("d1", "WRONG").catch((x: unknown) => x)
    expect(userMessage(e)).toEqual({ text: "That code didn't work. Check it, or ask for a new one.", ref: "req-1" })
    expect(userMessage(new ApiError(409, "device_already_bound", "r")).text).toBe("This device is already set up. Ask an admin to reset it.")
  })
  test("five wrong codes in a row show the locked message; a success resets the count", () => {
    const a = makeCodeAttempts()
    for (let i = 0; i < MAX_WRONG_CODES - 1; i++) a.record(false)
    expect(a.locked()).toBe(false)
    a.record(false)
    expect(a.locked()).toBe(true)
    expect(a.message()).toBe("Too many wrong codes. Ask an admin for a new code.")
    const b = makeCodeAttempts()
    for (let i = 0; i < 4; i++) b.record(false)
    b.record(true)
    b.record(false)
    expect(b.locked()).toBe(false)
    expect(MAX_WRONG_CODES).toBe(5)
  })
  test("after a bind the page refreshes so the chip and Drive come from the API's next answer", async () => {
    const dev = { id: "d1", userId: "u1", type: "pc", owner: "company", label: "PC", trusted: true, lastSeen: null }
    const { client } = fakeApi({ "POST /v1/devices/{id}/bind": dev })
    const refresh = vi.fn()
    const run = makeActionRunner({ notify: vi.fn(), refresh })
    const r = await run("bind", () => makeAccountClient(client).bindDevice("d1", "ABCD2345JK"))
    expect(r.ok).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
