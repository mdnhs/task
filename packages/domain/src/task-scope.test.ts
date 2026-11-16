import { describe, expect, it } from "vitest"

import { activeTasks, assigneesOf, isAssignee } from "./task-scope"

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
