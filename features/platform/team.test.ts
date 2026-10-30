import { describe, expect, it } from "vitest"

import { canBeOwner, changeStaffRole, disableStaff, inviteStaff, mfaLabel, teamData } from "./team"
import type { StaffMember } from "./types"

const WHY = "Covering billing while Sofia is away"
const m = (id: string, over: Partial<StaffMember> = {}): StaffMember => ({
  id, name: `Person ${id}`, email: `${id}@opsdesk.test`, role: "support", mfa: true, lastSignInAt: "2026-10-19T08:00:00", status: "active", ...over,
})
const OWNER = m("stf-1", { role: "owner" })
const STAFF = [OWNER, m("stf-2"), m("stf-3", { mfa: false }), m("stf-4", { role: "billing", status: "disabled" })]

describe("changeStaffRole", () => {
  it("refuses owner for a member without MFA", () => {
    expect(canBeOwner(STAFF[2])).toBe(false)
    expect(() => changeStaffRole(STAFF[2], "owner", WHY, { staff: STAFF, operatorId: "stf-1" })).toThrow(/two-step verification/i)
  })
  it("makes a member with MFA an owner", () => {
    expect(changeStaffRole(STAFF[1], "owner", WHY, { staff: STAFF, operatorId: "stf-1" }).role).toBe("owner")
  })
  it("allows a non-owner role change without MFA", () => {
    expect(changeStaffRole(STAFF[2], "viewer", WHY, { staff: STAFF, operatorId: "stf-1" }).role).toBe("viewer")
  })
  it("needs a reason, a different role, an active-or-invited member and not yourself", () => {
    const ctx = { staff: STAFF, operatorId: "stf-1" }
    expect(() => changeStaffRole(STAFF[1], "billing", "short", ctx)).toThrow(/reason/i)
    expect(() => changeStaffRole(STAFF[1], "support", WHY, ctx)).toThrow(/already/i)
    expect(() => changeStaffRole(STAFF[3], "viewer", WHY, ctx)).toThrow(/disabled/i)
    expect(() => changeStaffRole(OWNER, "viewer", WHY, ctx)).toThrow(/your own/i)
  })
  it("never leaves the platform without an active owner", () => {
    const two = [OWNER, m("stf-9", { role: "owner" })]
    expect(() => changeStaffRole(OWNER, "viewer", WHY, { staff: [OWNER, m("stf-2")], operatorId: "stf-2" })).toThrow(/last active owner/i)
    expect(changeStaffRole(OWNER, "viewer", WHY, { staff: two, operatorId: "stf-9" }).role).toBe("viewer")
  })
})

describe("disableStaff", () => {
  it("disables an active member with a reason", () => {
    expect(disableStaff(STAFF[1], WHY, { staff: STAFF, operatorId: "stf-1" }).status).toBe("disabled")
  })
  it("refuses yourself, an already disabled member and the last active owner", () => {
    expect(() => disableStaff(OWNER, WHY, { staff: STAFF, operatorId: "stf-1" })).toThrow(/yourself/i)
    expect(() => disableStaff(STAFF[3], WHY, { staff: STAFF, operatorId: "stf-1" })).toThrow(/already/i)
    expect(() => disableStaff(OWNER, WHY, { staff: STAFF, operatorId: "stf-2" })).toThrow(/last active owner/i)
    expect(() => disableStaff(STAFF[1], "x", { staff: STAFF, operatorId: "stf-1" })).toThrow(/reason/i)
  })
})

describe("inviteStaff", () => {
  it("adds an invited member without MFA or sign-in, numbered after the highest id", () => {
    expect(inviteStaff(STAFF, { name: " Niamh Doyle ", email: "Niamh@OpsDesk.app ", role: "viewer" })).toEqual({
      id: "stf-5", name: "Niamh Doyle", email: "niamh@opsdesk.app", role: "viewer", mfa: false, lastSignInAt: null, status: "invited",
    })
  })
  it("refuses a bad or taken email, a missing name and the owner role (MFA comes after sign-in)", () => {
    expect(() => inviteStaff(STAFF, { name: "A B", email: "nope", role: "viewer" })).toThrow(/email/i)
    expect(() => inviteStaff(STAFF, { name: "A B", email: "STF-2@opsdesk.test", role: "viewer" })).toThrow(/already/i)
    expect(() => inviteStaff(STAFF, { name: " ", email: "a@b.co", role: "viewer" })).toThrow(/name/i)
    expect(() => inviteStaff(STAFF, { name: "A B", email: "a@b.co", role: "owner" })).toThrow(/two-step verification/i)
  })
})

describe("mfaLabel / teamData", () => {
  it("labels MFA and counts the team", () => {
    expect(mfaLabel(STAFF[0])).toEqual({ tone: "ok", label: "On" })
    expect(mfaLabel(STAFF[2])).toEqual({ tone: "warn", label: "MFA required" })
    const d = teamData({ operatorId: "stf-1", staff: STAFF })
    expect(d.operatorId).toBe("stf-1")
    expect(d.staff).toHaveLength(4)
  })
})
