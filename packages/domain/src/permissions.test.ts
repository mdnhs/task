import { describe, expect, it } from "vitest"
import { can, canReview, canWriteFor, filterNav, moduleForHref, reportScope, shiftScope } from "./permissions"
import type { Access, Module, Role } from "./types"

const mods: Module[] = ["dashboard", "tasks", "reports", "attention", "staff", "shifts", "recruitment", "files", "payroll", "orders", "settings", "audit"]
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

describe("shiftScope", () => {
  it("maps /shifts to the shifts module", () => expect(moduleForHref("/shifts")).toBe("shifts"))
  it("write roles see everyone", () => expect(shiftScope(mk("ops", { shifts: "write" }))).toBe("all"))
  it("staff-home readers see only their own", () => expect(shiftScope(mk("employee", { shifts: "read" }))).toBe("own"))
  it("manager-home readers (auditor) see everyone read-only", () => expect(shiftScope({ ...mk("auditor", { shifts: "read" }), home: "manager" })).toBe("all"))
  it("no access", () => expect(shiftScope(mk("platform", {}))).toBe("none"))
})

describe("reportScope (FR-M1-28)", () => {
  it("staff-home roles see their own", () => expect(reportScope(mk("employee", { reports: "read" }), "p-me")).toEqual({ kind: "own", personId: "p-me" }))
  it("a team-scoped manager sees the people below their person", () =>
    expect(reportScope({ ...mk("manager", { reports: "write" }), home: "manager", person: "p-lead", reportScope: "team" }, "p-me")).toEqual({ kind: "team", managerId: "p-lead" }))
  it("other manager-home roles see all", () => expect(reportScope({ ...mk("ops", { reports: "write" }), home: "manager" }, "p-me")).toEqual({ kind: "all" }))
  it("no access", () => expect(reportScope(mk("hr", {}), "p-me")).toBeNull())
})
