import { describe, expect, it } from "vitest"

import {
  addChecklistItem, addEvidence, addNote, archiveTask, changeDeadline, changeStatus, completeTask, declineProposal, makeSubtask, nowIso, proposeDates,
  reassign, rejectTask, removeChecklistItem, removeEvidence, reschedule, restoreTask, reviewEvidence, setDependencies, setEvidenceRule, setOverdue,
  toggleChecklistItem, verifyTask,
} from "./mutations"
import { tasksStore } from "./store"
import { legacyRule } from "@/lib/task-evidence"
import type { Task } from "./types"

const task = (over: Partial<Task> = {}): Task => ({
  ref: "TSK-1", title: "t", description: "", dept: "Security", assignee: "p", creator: "c", priority: 2,
  start: "2026-10-18T09:00:00", due: "2026-10-20T17:00:00", status: "in_progress", evidenceRule: legacyRule(true), tags: [],
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
    expect(t.timeline.at(-1)).toEqual({ at: NOW, by: "Dan", text: "Status changed In Progress → Awaiting verification", changes: [{ field: "Status", from: "In Progress", to: "Awaiting verification" }] })
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
    const a = addEvidence(task(), { kind: "drive", name: "https://drive.google.com/x" }, "Dan", NOW)
    const b = addEvidence(a, { kind: "photo", name: "p.jpg" }, "Dan", NOW)
    expect(b.evidence.map((e) => [e.id, e.review])).toEqual([["TSK-1-E1", "pending"], ["TSK-1-E2", "pending"]])
    expect(b.timeline).toHaveLength(2)
  })
  it("reviews one item with a reason and logs it", () => {
    const a = addEvidence(task(), { kind: "photo", name: "p.jpg" }, "Dan", NOW)
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

describe("evidence flow (CR-05)", () => {
  const twoPdfs = { mode: "required" as const, types: ["pdf" as const], min: 2, instruction: "", review: "manager" as const }
  it("complete is blocked below the minimum, then goes to verification and locks evidence", () => {
    const base = task({ evidenceRule: twoPdfs })
    const one = addEvidence(base, { kind: "pdf", name: "a.pdf" }, "Dan", NOW)
    expect(completeTask(one, "Dan", NOW)).toBe(one)
    const two = addEvidence(one, { kind: "pdf", name: "b.pdf" }, "Dan", NOW)
    const sent = completeTask(two, "Dan", NOW)
    expect(sent.status).toBe("submitted")
    expect(sent.evidence.every((e) => e.locked)).toBe(true)
    expect(removeEvidence(sent, sent.evidence[0].id, "Dan", NOW)).toBe(sent)
    expect(verifyTask(sent, "Lil", NOW)).toMatchObject({ status: "completed" })
  })
  it("Not needed completes with one tap", () => expect(completeTask(task({ evidenceRule: legacyRule(false) }), "Dan", NOW).status).toBe("completed"))
  it("auto-accept accepts on upload", () => {
    const a = addEvidence(task({ evidenceRule: { ...twoPdfs, min: 1, review: "auto" } }), { kind: "pdf", name: "a.pdf" }, "Dan", NOW)
    expect(a.evidence[0].review).toBe("accepted")
    expect(completeTask(a, "Dan", NOW).status).toBe("completed")
  })
  it("reject reopens with the comment and keeps the item as an earlier version", () => {
    const sent = completeTask(addEvidence(task(), { kind: "pdf", name: "a.pdf" }, "Dan", NOW), "Dan", NOW)
    const r = rejectTask(sent, "Unsigned", "Lil", NOW)
    expect(r).toMatchObject({ status: "changes_requested", round: 2 })
    expect(r.evidence[0]).toMatchObject({ review: "rejected", reason: "Unsigned" })
    expect(r.notes.at(-1)?.text).toBe("Evidence rejected: Unsigned")
    const again = addEvidence(r, { kind: "pdf", name: "a2.pdf" }, "Dan", NOW)
    expect(again.evidence.at(-1)).toMatchObject({ round: 2, review: "pending" })
  })
  it("per-item reject on a submitted task reopens it; accepting the last item completes it", () => {
    const sent = completeTask(addEvidence(task(), { kind: "pdf", name: "a.pdf" }, "Dan", NOW), "Dan", NOW)
    expect(reviewEvidence(sent, sent.evidence[0].id, "rejected", "Blurry", "Lil", NOW).status).toBe("changes_requested")
    expect(reviewEvidence(sent, sent.evidence[0].id, "accepted", undefined, "Lil", NOW).status).toBe("completed")
  })
})

describe("manager changes (CR-04)", () => {
  it("reschedules with old and new values and clears a proposal", () => {
    const p = proposeDates(task(), { start: "2026-10-18T09:00:00", due: "2026-10-25T17:00:00", reason: "Parts late" }, "Dan", NOW)
    expect(p.proposal?.by).toBe("Dan")
    const r = reschedule(p, { start: p.start, due: "2026-10-25T17:00:00" }, "Lil", NOW)
    expect(r.proposal).toBeUndefined()
    expect(r.timeline.at(-1)?.changes).toEqual([{ field: "Due", from: "Tue 20 Oct 17:00", to: "Sun 25 Oct 17:00" }])
    expect(declineProposal(p, "Lil", NOW).proposal).toBeUndefined()
  })
  it("reassigns to several people", () => {
    const r = reassign(task(), ["q", "p"], "Lil", NOW, (id) => id.toUpperCase())
    expect(r).toMatchObject({ assignee: "q", assignees: ["p"] })
    expect(r.timeline.at(-1)?.changes?.[0]).toEqual({ field: "Assignees", from: "P", to: "Q, P" })
    expect(reassign(task(), ["p"], "Lil", NOW, String)).toEqual(task())
  })
  it("archives and restores", () => {
    const a = archiveTask(task(), "Lil", NOW)
    expect(a).toMatchObject({ archivedAt: NOW, archivedBy: "Lil" })
    expect(restoreTask(a, "Lil", NOW).archivedAt).toBeUndefined()
  })
  it("edits the checklist and dependencies", () => {
    const c = addChecklistItem(task(), "Lock up", "Dan", NOW)
    expect(toggleChecklistItem(c, "c1", "Dan", NOW).checklist?.[0].done).toBe(true)
    expect(removeChecklistItem(c, "c1", "Dan", NOW).checklist).toEqual([])
    expect(setDependencies(task(), ["TSK-1", "TSK-2"], "Lil", NOW).dependsOn).toEqual(["TSK-2"])
  })
  it("makes a subtask from its parent", () => {
    const s = makeSubtask(task({ projectId: "P" }), "TSK-9", " Sub ", "Lil", "p-l", NOW)
    expect(s).toMatchObject({ ref: "TSK-9", title: "Sub", parentRef: "TSK-1", projectId: "P", assignee: "p", status: "not_started" })
  })
  it("changes the evidence rule with history", () => {
    const r = setEvidenceRule(task(), legacyRule(false), "Lil", NOW)
    expect(r.timeline.at(-1)?.changes?.[0]).toMatchObject({ field: "Evidence", to: "Not needed" })
  })
})
