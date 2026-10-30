import { describe, expect, it } from "vitest"

import { NO_EVIDENCE, legacyRule, type EvidenceRule } from "@/lib/task-evidence"
import { boardMove, canComplete, completeOutcome, isLate, nextStatuses } from "./lifecycle"
import type { Evidence, Task } from "./types"

const ev = (review: Evidence["review"]): Evidence => ({ id: "e", kind: "pdf", name: "a.pdf", by: "x", at: "2026-10-19T10:00:00", review })
const task = (over: Partial<Task> = {}): Task => ({
  ref: "TSK-1", title: "t", description: "", dept: "Security", assignee: "p", creator: "c", priority: 2,
  start: "2026-10-18T09:00:00", due: "2026-10-20T17:00:00", status: "in_progress", evidenceRule: NO_EVIDENCE, tags: [],
  notes: [], evidence: [], timeline: [], ...over,
})

const twoPdfs: EvidenceRule = { mode: "required", types: ["pdf"], min: 2, instruction: "", review: "manager" }

describe("nextStatuses", () => {
  it("offers Complete to the assignee on open work", () => {
    expect(nextStatuses(task(), "assignee")).toEqual(["blocked", "completed"])
    expect(nextStatuses(task({ status: "not_started" }), "assignee")).toEqual(["in_progress", "blocked", "completed"])
    expect(nextStatuses(task({ status: "blocked" }), "assignee")).toEqual(["in_progress"])
    expect(nextStatuses(task({ status: "changes_requested" }), "assignee")).toEqual(["in_progress", "completed"])
    expect(nextStatuses(task({ status: "submitted" }), "assignee")).toEqual([])
  })
  it("gives a reviewer verify / reject / cancel on submitted", () => {
    expect(nextStatuses(task({ status: "submitted" }), "reviewer")).toEqual(["completed", "changes_requested", "cancelled"])
    expect(nextStatuses(task({ status: "blocked" }), "reviewer")).toEqual(["cancelled"])
    expect(nextStatuses(task({ status: "completed" }), "reviewer")).toEqual([])
  })
  it("offers nothing on an archived task", () => expect(nextStatuses(task({ archivedAt: "2026-10-20T09:00:00" }), "assignee")).toEqual([]))
})

describe("complete (AC-M1-08)", () => {
  it("Not needed closes with one tap", () => expect(completeOutcome(task())).toBe("completed"))
  it("2 PDFs required: 1 is blocked, 2 go to verification", () => {
    expect(completeOutcome(task({ evidenceRule: twoPdfs, evidence: [ev("pending")] }))).toBe("blocked")
    expect(canComplete(task({ evidenceRule: twoPdfs, evidence: [ev("pending")] }))).toBe(false)
    expect(completeOutcome(task({ evidenceRule: twoPdfs, evidence: [ev("pending"), ev("pending")] }))).toBe("submitted")
  })
  it("rejected items don't count", () => expect(canComplete(task({ evidenceRule: legacyRule(true), evidence: [ev("rejected")] }))).toBe(false))
})

describe("boardMove", () => {
  it("runs Complete for the assignee and refuses when evidence is missing", () => {
    expect(boardMove(task(), "completed", "assignee")).toEqual({ ok: true, action: "complete" })
    expect(boardMove(task({ evidenceRule: twoPdfs }), "completed", "assignee")).toMatchObject({ ok: false })
    expect(boardMove(task(), "blocked", "assignee")).toEqual({ ok: true, action: "status" })
    expect(boardMove(task({ status: "submitted" }), "completed", "reviewer")).toMatchObject({ ok: false })
    expect(boardMove(task(), "cancelled", "reviewer")).toEqual({ ok: true, action: "status" })
    expect(boardMove(task(), "blocked", "reviewer")).toEqual({ ok: true, action: "status" })
    expect(boardMove(task(), "not_started", "assignee")).toMatchObject({ ok: false })
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
