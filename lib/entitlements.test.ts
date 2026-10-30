import { describe, expect, it } from "vitest"
import { effectiveModules, filterByEntitlement, hasModule, hasProductModule, missingModules, planModules, resolveEntitlements, withPlanModules, restrictRole, type EntitlementsData } from "./entitlements"
import type { Role } from "./types"

const data: EntitlementsData = {
  productModules: [
    { id: "M0", label: "Core", description: "" },
    { id: "M1", label: "Tasks", description: "" },
    { id: "M8", label: "Payroll", description: "" },
  ],
  modules: { dashboard: "M0", tasks: "M1", shifts: "M1", payroll: "M8" },
  assistant: "M2",
  defaultPlan: "small",
  plans: { small: ["M0", "M1"], big: ["M0", "M1", "M8", "M2"] },
}
const role = { id: "owner", label: "Owner", description: "", home: "manager", access: { dashboard: "write", tasks: "write", reports: "write", attention: "write", staff: "write", shifts: "write", recruitment: "write", files: "write", payroll: "write", orders: "write", settings: "write", audit: "write", whatsapp: "write" } } as Role

describe("entitlements", () => {
  const small = resolveEntitlements(data, "small")
  const big = resolveEntitlements(data, "big")

  it("resolves a plan and falls back to the default for an unknown one", () => {
    expect(resolveEntitlements(data, "nope").planId).toBe("small")
    expect(resolveEntitlements(data, undefined).allowed).toEqual(["M0", "M1"])
  })
  it("hasModule follows the plan; unmapped modules are core", () => {
    expect(hasModule(small, "tasks")).toBe(true)
    expect(hasModule(small, "shifts")).toBe(true)
    expect(hasModule(small, "payroll")).toBe(false)
    expect(hasModule(big, "payroll")).toBe(true)
    expect(hasModule(small, "whatsapp")).toBe(true)
  })
  it("hasProductModule covers the assistant", () => {
    expect(hasProductModule(small, small.assistant)).toBe(false)
    expect(hasProductModule(big, big.assistant)).toBe(true)
  })
  it("filterByEntitlement drops items outside the plan", () => {
    const nav = [{ href: "/" }, { href: "/tasks" }, { href: "/shifts" }, { href: "/payroll-issues" }]
    expect(filterByEntitlement(nav, small).map((n) => n.href)).toEqual(["/", "/tasks", "/shifts"])
    expect(filterByEntitlement(nav, big)).toHaveLength(4)
  })
  it("restrictRole removes access to missing modules only", () => {
    const r = restrictRole(role, small)
    expect(r.access.payroll).toBe("none")
    expect(r.access.tasks).toBe("write")
    expect(restrictRole(role, big)).toBe(role)
    expect(missingModules(small)).toEqual(["payroll"])
  })
  it("planModules marks what a plan includes", () => {
    expect(planModules(data, "small").map((m) => [m.id, m.included])).toEqual([["M0", true], ["M1", true], ["M8", false]])
  })
  it("withPlanModules sets a plan's modules in catalogue order and drops unknown ids", () => {
    const next = withPlanModules(data, "small", ["M8", "x", "M0"])
    expect(next.plans.small).toEqual(["M0", "M8"])
    expect(data.plans.small).not.toEqual(next.plans.small)
    expect(planModules(next, "small").filter((m) => m.included).map((m) => m.id)).toEqual(["M0", "M8"])
  })

  // Task 5: per-tenant module overrides feed the same path as plan modules: plan modules ± overrides.
  it("applies grants and revokes on top of the plan, in catalogue order; core modules can't be revoked", () => {
    const withCore = { ...data, core: ["M0"] }
    const ent = resolveEntitlements(withCore, "small", [{ module: "M8", mode: "grant" }, { module: "M1", mode: "revoke" }, { module: "M0", mode: "revoke" }, { module: "zz", mode: "grant" }])
    expect(ent.allowed).toEqual(["M0", "M8"])
    expect(hasModule(ent, "payroll")).toBe(true)
    expect(hasModule(ent, "tasks")).toBe(false)
    expect(effectiveModules(withCore, "small", undefined)).toEqual(["M0", "M1"])
    expect(resolveEntitlements(data, "small").allowed).toEqual(["M0", "M1"])
  })
  it("planModules marks overridden modules and what the plan itself has", () => {
    const rows = planModules(data, "small", [{ module: "M8", mode: "grant" }, { module: "M1", mode: "revoke" }])
    expect(rows.map((m) => [m.id, m.included, m.inPlan, m.override ?? null])).toEqual([["M0", true, true, null], ["M1", false, true, "revoke"], ["M8", true, false, "grant"]])
  })
})
