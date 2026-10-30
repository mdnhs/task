import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { PLATFORM_ACTIONS, STAFF_ROLES, actionForPath, requireStaff, staffCan } from "./permissions"
import type { StaffMember } from "./types"

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: "s1", name: "A", email: "a@x.test", role: "owner", mfa: true, lastSignInAt: null, status: "active", ...over,
})

describe("staffCan", () => {
  it("owner can do every action", () => {
    for (const a of PLATFORM_ACTIONS) expect(staffCan("owner", a)).toBe(true)
  })

  it("viewer can only do *.read actions", () => {
    for (const a of PLATFORM_ACTIONS) expect(staffCan("viewer", a)).toBe(a.endsWith(".read"))
  })

  it("support handles support access and data requests, not billing or plans", () => {
    expect(staffCan("support", "support.request")).toBe(true)
    expect(staffCan("support", "data.requests")).toBe(true)
    expect(staffCan("support", "tenants.read")).toBe(true)
    expect(staffCan("support", "billing.write")).toBe(false)
    expect(staffCan("support", "plans.write")).toBe(false)
    expect(staffCan("support", "billing.read")).toBe(false)
  })

  it("billing handles billing and plans, not support access", () => {
    expect(staffCan("billing", "billing.write")).toBe(true)
    expect(staffCan("billing", "plans.write")).toBe(true)
    expect(staffCan("billing", "tenants.read")).toBe(true)
    expect(staffCan("billing", "support.request")).toBe(false)
    expect(staffCan("billing", "data.requests")).toBe(false)
  })

  it("only the owner manages the team and settings", () => {
    for (const r of STAFF_ROLES) {
      expect(staffCan(r, "team.manage")).toBe(r === "owner")
      expect(staffCan(r, "settings.write")).toBe(r === "owner")
    }
  })
})

describe("settings", () => {
  it("every staff role can open Settings (read only without settings.write)", () => {
    for (const r of STAFF_ROLES) expect(staffCan(r, "settings.read")).toBe(true)
  })
})

describe("requireStaff", () => {
  it("allows an active member with the action", () => {
    expect(requireStaff(member({ role: "billing" }), "billing.write")).toBe(true)
  })
  it("refuses a member without the action", () => {
    expect(requireStaff(member({ role: "support" }), "billing.read")).toBe(false)
  })
  it("refuses an invited or disabled member even as owner", () => {
    expect(requireStaff(member({ status: "disabled" }), "tenants.read")).toBe(false)
    expect(requireStaff(member({ status: "invited" }), "tenants.read")).toBe(false)
  })
})

describe("actionForPath", () => {
  it("maps each console page to its gate", () => {
    expect(actionForPath("/platform")).toBe("tenants.read")
    expect(actionForPath("/platform/tenants")).toBe("tenants.read")
    expect(actionForPath("/platform/tenants/t1")).toBe("tenants.read")
    expect(actionForPath("/platform/billing")).toBe("billing.read")
    expect(actionForPath("/platform/plans")).toBe("billing.read")
    expect(actionForPath("/platform/plans/business/edit")).toBe("plans.write")
    expect(actionForPath("/platform/support")).toBe("support.request")
    expect(actionForPath("/platform/data-requests")).toBe("data.requests")
    expect(actionForPath("/platform/audit")).toBe("audit.read")
    expect(actionForPath("/platform/team")).toBe("team.manage")
    expect(actionForPath("/platform/settings")).toBe("settings.read")
  })
  it("returns null outside the console", () => {
    expect(actionForPath("/tasks")).toBeNull()
  })
})

describe("navigation", () => {
  // filterForStaff drops any href without a PAGE_ACTIONS gate, so an unmapped nav link would vanish silently.
  const nav = JSON.parse(readFileSync("public/data/platform/navigation.json", "utf8")) as { menu: { href: string }[]; general: { href: string }[] }
  it("maps every console nav href to a page gate", () => {
    for (const { href } of [...nav.menu, ...nav.general]) expect(actionForPath(href), href).not.toBeNull()
  })
  it("gives the owner every nav link", () => {
    for (const { href } of nav.menu) expect(requireStaff(member(), actionForPath(href)!), href).toBe(true)
  })
})
