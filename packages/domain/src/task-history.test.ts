import { describe, expect, it } from "vitest"

import { diffFields, formatChange } from "./task-history"

const ctx = { tz: "Europe/Dublin", nameOf: (id: string) => (id === "u1" ? "Ann Byrne" : "Former member"), teamName: (id: string) => (id === "t1" ? "Cleaning" : "Former team") }

describe("task history", () => {
  it("diffFields keeps raw old and new values, only for fields that changed", () => {
    const before = { title: "A", priority: 2, labels: ["x"], due: "2026-11-20T17:00:00.000Z", client: null }
    const after = { title: "A", priority: 3, labels: ["x", "y"], due: "2026-11-21T17:00:00.000Z", client: null }
    expect(diffFields(before, after)).toEqual([
      { field: "priority", from: 2, to: 3 },
      { field: "labels", from: ["x"], to: ["x", "y"] },
      { field: "due", from: "2026-11-20T17:00:00.000Z", to: "2026-11-21T17:00:00.000Z" },
    ])
    expect(diffFields(before, before)).toEqual([])
  })
  it("formatChange shows dates in tenant time, people by current name, ids of erased people as Former member", () => {
    expect(formatChange({ field: "due", from: "2026-11-20T17:00:00.000Z", to: "2026-11-21T17:00:00.000Z" }, ctx)).toEqual({ field: "Due", from: "20 Nov 17:00", to: "21 Nov 17:00" })
    // BST (UTC+1) ends at 01:00Z on 25 Oct 2026, so 00:30Z is still 01:30 in Dublin
    expect(formatChange({ field: "start", from: null, to: "2026-10-25T00:30:00.000Z" }, ctx)).toEqual({ field: "Start", from: "", to: "25 Oct 01:30" })
    expect(formatChange({ field: "assignees", from: ["u1"], to: ["u1", "u9"] }, ctx)).toEqual({ field: "Assignees", from: "Ann Byrne", to: "Ann Byrne, Former member" })
    expect(formatChange({ field: "status", from: "in_progress", to: "completed" }, ctx)).toEqual({ field: "Status", from: "In Progress", to: "Completed" })
    expect(formatChange({ field: "priority", from: 2, to: 3 }, ctx)).toEqual({ field: "Priority", from: "Medium", to: "High" })
    expect(formatChange({ field: "teamId", from: "t1", to: null }, ctx)).toEqual({ field: "Department", from: "Cleaning", to: "" })
  })
})
