import { describe, expect, it } from "vitest"
import { can, canReview, canWriteFor, filterNav, moduleForHref } from "./permissions"
import type { Access, Module, Role } from "./types"

const mods: Module[] = ["dashboard", "tasks", "reports", "attention", "staff", "recruitment", "files", "payroll", "orders", "settings", "audit"]
const mk = (id: string, over: Partial<Record<Module, Access>>): Role => ({
  id,
  label: id,
  description: "",
  home: "staff",
  access: Object.fromEntries(mods.map((m) => [m, over[m] ?? "none"])) as Record<Module, Access>,
})
const employee = mk("employee", { tasks: "write", reports: "read", dashboard: "read" })
const auditor = mk("auditor", Object.fromEntries(mods.map((m) => [m, "read"])) as Record<Module, Access>)

describe("can", () => {
  it("denies none", () => expect(can(employee, "payroll")).toBe(false))
  it("write allows write", () => expect(can(employee, "tasks", "write")).toBe(true))
  it("read does not allow write", () => expect(can(auditor, "tasks", "write")).toBe(false))
  it("write implies read", () => expect(can(employee, "tasks")).toBe(true))
  it("read allows read", () => expect(can(auditor, "tasks")).toBe(true))
})

describe("moduleForHref", () => {
  it("maps routes", () => {
    expect(moduleForHref("/tasks/TSK-1042")).toBe("tasks")
    expect(moduleForHref("/settings/billing")).toBe("settings")
    expect(moduleForHref("/")).toBe("dashboard")
    expect(moduleForHref("/payroll-issues")).toBe("payroll")
    expect(moduleForHref("/nope")).toBeNull()
  })
})

describe("canWriteFor", () => {
  const owner = mk("owner", Object.fromEntries(mods.map((m) => [m, "write"])) as Record<Module, Access>)
  it("suspended tenant is read-only", () => expect(canWriteFor(owner, "suspended", "tasks")).toBe(false))
  it("auditor never writes", () => expect(canWriteFor(auditor, "active", "tasks")).toBe(false))
  it("owner on active tenant writes", () => expect(canWriteFor(owner, "active", "tasks")).toBe(true))
})

describe("filterNav", () => {
  const items = [{ href: "/" }, { href: "/tasks" }, { href: "/payroll-issues" }]
  it("hides modules the role can't read", () =>
    expect(filterNav(items, employee).map((i) => i.href)).toEqual(["/", "/tasks"]))
})

describe("canReview", () => {
  const manager: Role = { ...mk("manager", { reports: "write" }), home: "manager" }
  it("manager-home writer reviews", () => expect(canReview(manager)).toBe(true))
  it("staff-home writer does not", () => expect(canReview(mk("supervisor", { reports: "write" }))).toBe(false))
  it("manager-home reader does not", () => expect(canReview({ ...auditor, home: "manager" })).toBe(false))
  it("suspended tenant does not", () => expect(canReview(manager, "suspended")).toBe(false))
})
