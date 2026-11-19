import { describe, expect, test } from "vitest"
import { ApiError } from "@/lib/api/problem"
import { mapRosterError, runRosterWrite } from "./errors"

const e = (status: number, code: string, extra: Record<string, unknown> = {}) => new ApiError(status, code, "req-1", extra)
const violation = { rule: "double_booking", shiftId: "s", personId: "p", severity: "block", message: "m", otherShiftIds: [] }

describe("roster write errors map to exactly one UI state", () => {
  test("error mapping table: each API code above maps to exactly one UI state", () => {
    const table: [ApiError, string, boolean][] = [
      [e(409, "version_conflict"), "conflict", true], // refetch, toast
      [e(412, "precondition_failed"), "conflict", true],
      [e(403, "roster_locked"), "locked", false], // read-only state, NOT an error toast
      [e(422, "reason_required"), "reason_required", false], // opens the reason dialog
      [e(422, "rule_blocked", { violations: [violation] }), "rule_blocked", false], // the conflicts panel
      [e(402, "billing_required"), "billing", false],
      [e(403, "module_not_entitled"), "not_entitled", false],
    ]
    for (const [err, state, toast] of table) {
      const m = mapRosterError(err)
      expect(m.state, `${err.status} ${err.code}`).toBe(state)
      expect(m.toast !== null, `${err.status} ${err.code} toast`).toBe(toast)
    }
    expect(mapRosterError(e(409, "version_conflict")).toast?.text).toBe("Changed by someone else.")
    expect(mapRosterError(e(409, "version_conflict")).refetch).toBe(true)
    expect(mapRosterError(e(403, "roster_locked")).refetch).toBe(true)
  })

  test("rule_blocked carries the violations (strictly mapped) for the conflicts panel; a 403 rule_blocked_office_required is a plain forbidden", () => {
    const m = mapRosterError(e(422, "rule_blocked", { violations: [violation] }))
    expect(m.state === "rule_blocked" && m.violations).toEqual([violation])
    // a malformed list never reaches the panel
    expect(mapRosterError(e(422, "rule_blocked", { violations: "x" }))).toMatchObject({ state: "rule_blocked", violations: [] })
  })

  test("403 rule_blocked_office_required is the conflicts panel with the API's violations and a needsOffice flag (a supervisor publishing over a blocked rule)", () => {
    const m = mapRosterError(e(403, "rule_blocked_office_required", { violations: [violation] }))
    expect(m).toMatchObject({ state: "rule_blocked", needsOffice: true, refetch: false, toast: null, violations: [violation] })
    expect(mapRosterError(e(422, "rule_blocked", { violations: [violation] }))).toMatchObject({ state: "rule_blocked", needsOffice: false })
    expect(mapRosterError(e(403, "forbidden")).state).toBe("forbidden")
  })

  test("428, MFA, 429 and a network failure each have their own state and calm copy (never a generic error)", () => {
    expect(mapRosterError(e(428, "precondition_required"))).toMatchObject({ state: "precondition_required", refetch: true, toast: { text: "Reload the page and try again.", ref: "req-1" } })
    expect(mapRosterError(e(403, "mfa_required"))).toMatchObject({ state: "mfa", refetch: false, toast: { text: "Enter your verification code." } })
    expect(mapRosterError(e(401, "mfa_challenge")).state).toBe("mfa")
    expect(mapRosterError(e(429, "rate_limited"))).toMatchObject({ state: "rate_limited", toast: { text: "Too many changes at once. Wait a moment, then try again." } })
    expect(mapRosterError(new TypeError("fetch failed"))).toMatchObject({ state: "network", toast: { text: "No connection. Your change was not saved." } })
    const named = new Set(["precondition_required", "mfa", "rate_limited", "network"])
    for (const err of [e(428, "x"), e(403, "mfa_required"), e(401, "mfa_challenge"), e(429, "x"), new TypeError("x")]) expect(named.has(mapRosterError(err).state)).toBe(true)
  })

  test("everything else falls back to the generic copy and keeps the request id", () => {
    expect(mapRosterError(e(403, "forbidden"))).toMatchObject({ state: "forbidden", toast: { text: "You can't do that.", ref: "req-1" } })
    expect(mapRosterError(e(422, "ineligible"))).toMatchObject({ state: "error", toast: { ref: "req-1" } })
    expect(mapRosterError(e(422, "ineligible")).toast?.text).not.toMatch(/422|ineligible/)
    expect(mapRosterError(e(404, "not_found")).state).toBe("not_found")
    expect(mapRosterError(e(401, "session_expired")).state).toBe("session_expired")
    expect(mapRosterError(e(500, "boom")).state).toBe("error")
  })

  test("runRosterWrite returns ok with the value, or the mapped error; a 409 retry is tried once more", async () => {
    expect(await runRosterWrite(async () => 5)).toEqual({ ok: true, value: 5 })
    let n = 0
    expect(await runRosterWrite(async () => { n++; if (n === 1) throw e(409, "retry"); return "x" })).toEqual({ ok: true, value: "x" })
    const r = await runRosterWrite(async () => { throw e(403, "roster_locked") })
    expect(r).toMatchObject({ ok: false, error: { state: "locked" } })
    n = 0
    expect(await runRosterWrite(async () => { n++; throw e(409, "retry") })).toMatchObject({ ok: false, error: { state: "error" } })
    expect(n).toBe(2)
  })
})
