import { describe, expect, test } from "vitest"
import { STEPS, backOf, canFinish, mfaReturnTarget, mfaSetupHref, nextOf, stepNumber, type Step } from "@/lib/mfa-stepper"

describe("the enrolment stepper state machine", () => {
  test("four real steps, in the order of the existing flow", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["password", "scan", "code", "backup"])
    expect(STEPS.map((s) => s.label)).toEqual(["Password", "Scan with your authenticator app", "Enter the 6-digit code", "Save your backup codes"])
    expect(STEPS.map((s) => stepNumber(s.id))).toEqual([1, 2, 3, 4])
  })
  test("next walks forward and stops at the last step", () => {
    const seen: Step[] = ["password"]
    for (let s = nextOf("password"); s; s = nextOf(s)) seen.push(s)
    expect(seen).toEqual(["password", "scan", "code", "backup"])
    expect(nextOf("backup")).toBeNull()
  })
  test("Back is safe only before the factor is turned on: never from the first step and never from the backup codes (2FA is already on and the codes are shown once)", () => {
    expect(backOf("password")).toBeNull()
    expect(backOf("scan")).toBe("password")
    expect(backOf("code")).toBe("scan")
    expect(backOf("backup")).toBeNull()
  })
  test("the backup step can only be finished once the person confirmed they saved the codes", () => {
    expect(canFinish(false)).toBe(false)
    expect(canFinish(true)).toBe(true)
  })
})

describe("return-to: where the person lands after setup", () => {
  test.each([
    "//evil.com", "https://evil.com", "http://evil.com/x", "/\\evil.com", "\\evil.com", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "/%2F%2Fevil.com", "/%2f/evil.com", "/%5cevil.com",
    "/\t/evil.com", "/\n/evil.com", " //evil.com", "///evil.com", "evil.com", "", "/api/auth/sign-out", "/sign-in", "/mfa", "/mfa?next=/tasks",
  ])("refuses %j and falls back to /", (bad) => {
    expect(mfaReturnTarget(bad)).toBe("/")
  })
  test("non-strings fall back too", () => {
    for (const v of [null, undefined, 5, ["/x"], {}]) expect(mfaReturnTarget(v)).toBe("/")
  })
  test("a same-origin path, with its query, is kept", () => {
    expect(mfaReturnTarget("/settings/template")).toBe("/settings/template")
    expect(mfaReturnTarget("/tasks?view=board")).toBe("/tasks?view=board")
  })
  test("the set-up link carries the (validated) current path as next", () => {
    expect(mfaSetupHref("/settings/template")).toBe("/mfa?next=%2Fsettings%2Ftemplate")
    expect(mfaSetupHref("/tasks?view=board")).toBe("/mfa?next=%2Ftasks%3Fview%3Dboard")
    expect(mfaSetupHref("//evil.com")).toBe("/mfa")
    expect(mfaSetupHref("/mfa")).toBe("/mfa")
  })
})
