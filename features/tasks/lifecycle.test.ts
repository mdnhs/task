import { describe, expect, it } from "vitest"

import { canComplete, isLate, nextStatuses } from "./lifecycle"
import type { Evidence, Task } from "./types"

const ev = (review: Evidence["review"]): Evidence => ({ id: "e", kind: "image", name: "a.jpg", by: "x", at: "2026-10-19T10:00:00", review })
const task = (over: Partial<Task> = {}): Task => ({
  ref: "TSK-1", title: "t", description: "", dept: "Security", assignee: "p", creator: "c", priority: 2,
  start: "2026-10-18T09:00:00", due: "2026-10-20T17:00:00", status: "in_progress", evidenceRequired: false, tags: [],
  notes: [], evidence: [], timeline: [], ...over,
})

describe("nextStatuses", () => {
  it("lets an assignee submit from in_progress only when evidence is not required or exists", () => {
    expect(nextStatuses(task(), "assignee")).toEqual(["blocked", "submitted"])
    expect(nextStatuses(task({ evidenceRequired: true }), "assignee")).toEqual(["blocked"])
    expect(nextStatuses(task({ evidenceRequired: true, evidence: [ev("pending")] }), "assignee")).toEqual(["blocked", "submitted"])
  })
  it("follows the assignee transitions", () => {
    expect(nextStatuses(task({ status: "not_started" }), "assignee")).toEqual(["in_progress", "blocked"])
    expect(nextStatuses(task({ status: "blocked" }), "assignee")).toEqual(["in_progress"])
    expect(nextStatuses(task({ status: "changes_requested" }), "assignee")).toEqual(["in_progress", "submitted"])
    expect(nextStatuses(task({ status: "submitted" }), "assignee")).toEqual([])
  })
  it("gives a reviewer complete / changes / cancel on submitted", () => {
    expect(nextStatuses(task({ status: "submitted" }), "reviewer")).toEqual(["completed", "changes_requested", "cancelled"])
  })
  it("lets a reviewer cancel any open task and nothing on closed ones", () => {
    expect(nextStatuses(task({ status: "blocked" }), "reviewer")).toEqual(["cancelled"])
    expect(nextStatuses(task({ status: "completed" }), "reviewer")).toEqual([])
    expect(nextStatuses(task({ status: "cancelled" }), "reviewer")).toEqual([])
  })
})

describe("canComplete (BR-05)", () => {
  it("is true without required evidence", () => expect(canComplete(task())).toBe(true))
  it("needs at least one accepted evidence when required", () => {
    expect(canComplete(task({ evidenceRequired: true }))).toBe(false)
    expect(canComplete(task({ evidenceRequired: true, evidence: [ev("accepted")] }))).toBe(true)
  })
  it("is false with any rejected or pending evidence", () => {
    expect(canComplete(task({ evidenceRequired: true, evidence: [ev("accepted"), ev("rejected")] }))).toBe(false)
    expect(canComplete(task({ evidenceRequired: true, evidence: [ev("accepted"), ev("pending")] }))).toBe(false)
  })
})

describe("isLate (FR-TASK-08)", () => {
  const now = "2026-10-20T09:00:00"
  it("compares submittedAt with due", () => {
    expect(isLate(task({ submittedAt: "2026-10-20T18:00:00" }), now)).toBe(true)
    expect(isLate(task({ submittedAt: "2026-10-20T16:00:00" }), now)).toBe(false)
  })
  it("falls back to completedAt then now", () => {
    expect(isLate(task({ completedAt: "2026-10-21T08:00:00" }), now)).toBe(true)
    expect(isLate(task({ due: "2026-10-19T17:00:00" }), now)).toBe(true)
    expect(isLate(task(), now)).toBe(false)
  })
  it("is never late when cancelled", () => expect(isLate(task({ status: "cancelled", due: "2026-10-01T09:00:00" }), now)).toBe(false))
})
