import { describe, expect, it } from "vitest"

import type { Access, Module, Role } from "./types"
import { activeTasks, assigneesOf, isAssignee, taskScope } from "./task-scope"

describe("task scope", () => {
  const t = { assignee: "p1", assignees: ["p2", "p1"] }
  it("knows every assignee, primary first", () => {
    expect(assigneesOf(t)).toEqual(["p1", "p2"])
    expect(isAssignee(t, "p2")).toBe(true)
    expect(isAssignee(t, "p3")).toBe(false)
    expect(isAssignee({ assignee: "p3" }, "p3")).toBe(true)
  })
  it("drops archived tasks", () => {
    expect(activeTasks([{ ref: "A" }, { ref: "B", archivedAt: "2026-10-20T09:00:00" }]).map((x) => x.ref)).toEqual(["A"])
  })
})

const mods: Module[] = ["dashboard", "tasks", "reports", "attention", "staff", "shifts", "recruitment", "files", "payroll", "orders", "settings", "audit", "roster"]
const mk = (home: Role["home"], tasks: Access, extra: Partial<Role> = {}): Role => ({
  id: "r", label: "r", description: "", home, access: Object.fromEntries(mods.map((m) => [m, m === "tasks" ? tasks : "none"])) as Record<Module, Access>, ...extra,
})

describe("taskScope (FR-M1-10, ruling D5)", () => {
  it("employee → own, manager (reportScope team) → team, ops/owner → all, a role without tasks:read → null; a clone of manager keeps team", () => {
    expect(taskScope(mk("staff", "write"), "u1")).toEqual({ kind: "own", personId: "u1" })
    expect(taskScope(mk("staff", "read"), "u1")).toEqual({ kind: "own", personId: "u1" })
    expect(taskScope(mk("manager", "write", { reportScope: "team" }), "m1")).toEqual({ kind: "team", managerId: "m1" })
    expect(taskScope(mk("manager", "write"), "o1")).toEqual({ kind: "all" })
    expect(taskScope(mk("manager", "read"), "a1")).toEqual({ kind: "all" })
    expect(taskScope(mk("manager", "none"), "x")).toBeNull()
    expect(taskScope(mk("staff", "none"), "x")).toBeNull()
    // a clone carries the template's reportScope (the API resolves it through cloned_from and passes it in)
    expect(taskScope({ ...mk("manager", "write"), reportScope: "team" }, "m2")).toEqual({ kind: "team", managerId: "m2" })
  })
})
