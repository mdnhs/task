import { describe, expect, it } from "vitest"

import { newTaskHref, parseNewTaskParams, safeFrom } from "./new-task"

describe("safeFrom", () => {
  it("keeps internal paths", () => {
    expect(safeFrom("/")).toBe("/")
    expect(safeFrom("/tasks?page=2")).toBe("/tasks?page=2")
  })
  it("rejects external, protocol-relative and missing values", () => {
    expect(safeFrom("https://evil.test")).toBe("/tasks")
    expect(safeFrom("//evil.test")).toBe("/tasks")
    expect(safeFrom("/\\evil.test")).toBe("/tasks")
    expect(safeFrom(undefined)).toBe("/tasks")
    expect(safeFrom(["/"])).toBe("/tasks")
  })
  it("never returns to the form itself", () => {
    expect(safeFrom("/tasks/new")).toBe("/tasks")
    expect(safeFrom("/tasks/new?from=/")).toBe("/tasks")
  })
})

describe("parseNewTaskParams", () => {
  it("reads from, a known assignee and then=task", () => {
    expect(parseNewTaskParams({ from: "/", assignee: "p2", then: "task" }, ["p1", "p2"])).toEqual({ from: "/", assignee: "p2", openCreated: true })
  })
  it("drops an unknown assignee and defaults the rest", () => {
    expect(parseNewTaskParams({ assignee: "zz" }, ["p1"])).toEqual({ from: "/tasks", assignee: "", openCreated: false })
  })
})

describe("newTaskHref", () => {
  it("leaves the default origin out", () => {
    expect(newTaskHref()).toBe("/tasks/new")
    expect(newTaskHref({ from: "/tasks" })).toBe("/tasks/new")
  })
  it("encodes origin, assignee and the open-created flag", () => {
    expect(newTaskHref({ from: "/", assignee: "p1", openCreated: true })).toBe("/tasks/new?from=%2F&assignee=p1&then=task")
  })
})
