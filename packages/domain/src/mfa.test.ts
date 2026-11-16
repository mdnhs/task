import { describe, expect, it } from "vitest"
import type { MfaPolicy } from "./mfa"
import { describeMfaPolicy, mfaRequired, needsMfaGate, parseMfaPolicy, qrPattern, verifyMockTotp } from "./mfa"

describe("mfa", () => {
  it("verifies the fixed mock code", () => {
    expect(verifyMockTotp("123456")).toBe(true)
    expect(verifyMockTotp("123 456")).toBe(true)
    expect(verifyMockTotp("000000")).toBe(false)
  })
  it("requires by mode and role", () => {
    expect(mfaRequired({ mode: "off", roles: [] }, "owner")).toBe(false)
    expect(mfaRequired({ mode: "all", roles: [] }, "employee")).toBe(true)
    expect(mfaRequired({ mode: "roles", roles: ["admin"] }, "admin")).toBe(true)
    expect(mfaRequired({ mode: "roles", roles: ["admin"] }, "employee")).toBe(false)
  })
  it("gates only when required and not enrolled (AC-M0-02)", () => {
    const all: MfaPolicy = { mode: "all", roles: [] }
    expect(needsMfaGate(all, "owner", false)).toBe(true)
    expect(needsMfaGate(all, "owner", true)).toBe(false)
    expect(needsMfaGate({ mode: "off", roles: [] }, "owner", false)).toBe(false)
  })
  it("parses policy input", () => {
    expect(parseMfaPolicy({ mode: "roles", roles: ["admin", "admin"] }, ["admin", "owner"])).toEqual({ mode: "roles", roles: ["admin"] })
    expect(parseMfaPolicy({ mode: "all", roles: ["x"] }, ["admin"])).toBeNull()
    expect(parseMfaPolicy({ mode: "all", roles: ["admin"] }, ["admin"])).toEqual({ mode: "all", roles: [] })
    expect(parseMfaPolicy({ mode: "bad" }, [])).toBeNull()
  })
  it("describes and draws", () => {
    expect(describeMfaPolicy({ mode: "roles", roles: ["admin"] }, { admin: "Admin" })).toBe("Required for Admin")
    expect(qrPattern("a")).toEqual(qrPattern("a"))
    expect(qrPattern("a")[0][0]).toBe(true)
  })
})
