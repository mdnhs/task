import { describe, expect, it } from "vitest"

import { addEvidence, addNote, changeDeadline, changeStatus, nowIso, reviewEvidence, setOverdue } from "./mutations"
import { tasksStore } from "./store"
import type { Task } from "./types"

const task = (over: Partial<Task> = {}): Task => ({
  ref: "TSK-1", title: "t", description: "", dept: "Security", assignee: "p", creator: "c", priority: 2,
  start: "2026-10-18T09:00:00", due: "2026-10-20T17:00:00", status: "in_progress", evidenceRequired: true, tags: [],
  notes: [], evidence: [], timeline: [], ...over,
})
const NOW = "2026-10-20T09:00:00"

describe("nowIso", () => {
  it("derives the org clock without Date.now", () => expect(nowIso("2026-10-20T09:00:00")).toBe(NOW))
})

describe("changeStatus", () => {
  it("appends a timeline entry and stamps submittedAt", () => {
    const t = changeStatus(task(), "submitted", "Dan", NOW)
    expect(t.status).toBe("submitted")
    expect(t.submittedAt).toBe(NOW)
    expect(t.timeline.at(-1)).toEqual({ at: NOW, by: "Dan", text: "Status changed In Progress → Submitted for Review" })
  })
  it("keeps the submission time on completion and stamps completedAt", () => {
    const t = changeStatus(task({ status: "submitted", submittedAt: "2026-10-19T10:00:00" }), "completed", "Lil", NOW)
    expect(t.submittedAt).toBe("2026-10-19T10:00:00")
    expect(t.completedAt).toBe(NOW)
  })
  it("clears submittedAt when work resumes, and never mutates the input", () => {
    const before = task({ status: "submitted", submittedAt: "2026-10-19T10:00:00" })
    const t = changeStatus(before, "changes_requested", "Lil", NOW)
    expect(t.submittedAt).toBeUndefined()
    expect(before.status).toBe("submitted")
    expect(before.timeline).toHaveLength(0)
  })
})

describe("evidence", () => {
  it("adds pending evidence with a fresh id", () => {
    const a = addEvidence(task(), { kind: "link", name: "https://x.test" }, "Dan", NOW)
    const b = addEvidence(a, { kind: "image", name: "p.jpg" }, "Dan", NOW)
    expect(b.evidence.map((e) => [e.id, e.review])).toEqual([["TSK-1-E1", "pending"], ["TSK-1-E2", "pending"]])
    expect(b.timeline).toHaveLength(2)
  })
  it("reviews one item with a reason and logs it", () => {
    const a = addEvidence(task(), { kind: "image", name: "p.jpg" }, "Dan", NOW)
    const r = reviewEvidence(a, "TSK-1-E1", "rejected", "Blurry", "Lil", NOW)
    expect(r.evidence[0]).toMatchObject({ review: "rejected", reason: "Blurry" })
    expect(r.timeline.at(-1)?.text).toBe("Evidence p.jpg rejected by Lil: Blurry")
    expect(a.evidence[0].review).toBe("pending")
  })
})

describe("notes, overdue, deadline", () => {
  it("adds a note and a timeline entry", () => {
    const t = addNote(task(), "On site", "Dan", NOW)
    expect(t.notes).toEqual([{ at: NOW, by: "Dan", text: "On site" }])
    expect(t.timeline).toHaveLength(1)
  })
  it("logs a revised due date only when it changes", () => {
    const o = { reason: "r", nextAction: "n", owner: "Dan", revisedDue: "2026-10-21T17:00:00" }
    const a = setOverdue(task(), o, "Dan", NOW)
    expect(a.timeline.map((e) => e.text)).toEqual(["Overdue update recorded", "Revised due date set to Wed 21 Oct"])
    expect(setOverdue(a, o, "Dan", NOW).timeline).toHaveLength(3)
  })
  it("logs a deadline change and ignores a no-op", () => {
    const t = changeDeadline(task(), "2026-10-22T12:00:00", "Lil", NOW)
    expect(t.due).toBe("2026-10-22T12:00:00")
    expect(t.timeline.at(-1)?.text).toBe("Deadline changed Tue 20 Oct → Thu 22 Oct")
    const same = task()
    expect(changeDeadline(same, same.due, "Lil", NOW)).toBe(same)
  })
})

describe("tasksStore", () => {
  it("applies an edit to one task immutably and keeps the seed scope", () => {
    tasksStore.reset()
    const a = task({ ref: "TSK-1" })
    const b = task({ ref: "TSK-2" })
    tasksStore.seed([a, b], "t1:all")
    tasksStore.set((prev) => prev.map((t) => (t.ref === "TSK-2" ? changeStatus(t, "blocked", "Dan", NOW) : t)))
    const now = tasksStore.get()!
    expect(now[0]).toBe(a)
    expect(now[1].status).toBe("blocked")
    tasksStore.seed([a, b], "t1:all") // same scope: edits survive
    expect(tasksStore.get()![1].status).toBe("blocked")
    tasksStore.reset()
  })
})
