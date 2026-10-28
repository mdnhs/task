import { describe, expect, it } from "vitest"

import { isLateSubmission, reportProgress, reportTransitions, sectionProgress, validateReport } from "./lifecycle"
import type { Report, TemplateSection } from "./types"

const template: TemplateSection[] = [
  { id: "a", n: 1, title: "A", fields: [
    { id: "x", label: "X", required: true, entry: "text" },
    { id: "y", label: "Y", required: true, entry: "text" },
    { id: "z", label: "Z", required: false, entry: "text" },
  ] },
  { id: "b", n: 2, title: "B", fields: [{ id: "w", label: "W", required: true, entry: "count" }] },
]
const report = (over: Partial<Report> = {}): Report => ({
  id: "RPT-1", date: "2026-10-20", dept: "Security", owner: "p", status: "draft", createdAt: "2026-10-20T08:00:00",
  updatedAt: "2026-10-20T08:00:00", nil: false, fields: {}, comments: [], versions: [], ...over,
})
const states = (s: "no_issues" | "na" | "details") => ({
  "a.x": { state: s, entries: [] }, "a.y": { state: s, entries: [] }, "b.w": { state: s, entries: [] },
})

describe("reportTransitions (SRS 4.2)", () => {
  it("lets the owner save or submit a draft", () => expect(reportTransitions("draft", "owner")).toEqual(["draft", "submitted"]))
  it("lets a reviewer review or return a submitted report", () => {
    expect(reportTransitions("submitted", "reviewer")).toEqual(["reviewed", "returned"])
    expect(reportTransitions("submitted", "owner")).toEqual([])
  })
  it("lets the owner fix and resubmit a returned report", () => {
    expect(reportTransitions("returned", "owner")).toContain("resubmitted")
    expect(reportTransitions("returned", "owner")).toContain("draft")
  })
  it("gives a reviewer the same choices on resubmitted", () => expect(reportTransitions("resubmitted", "reviewer")).toEqual(["reviewed", "returned"]))
  it("only lets an overdue report be submitted late, by the owner", () => {
    expect(reportTransitions("overdue", "owner")).toEqual(["submitted"])
    expect(reportTransitions("overdue", "reviewer")).toEqual([])
  })
  it("keeps reviewed reports reviewed", () => expect(reportTransitions("reviewed", "reviewer")).toEqual(["reviewed"]))
})

describe("validateReport", () => {
  it("returns one error per required field on an empty non-nil report", () => {
    const errs = validateReport(report(), template)
    expect(errs.map((e) => e.key)).toEqual(["a.x", "a.y", "b.w"])
    expect(errs[0]).toEqual({ key: "a.x", section: "a", message: "Add at least one entry or mark No issues" })
  })
  it("accepts a nil report with every state no_issues", () => {
    expect(validateReport(report({ nil: true, fields: states("no_issues") }), template)).toEqual([])
    expect(validateReport(report({ nil: true, fields: states("na") }), template)).toEqual([])
  })
  it("rejects a nil report with a details state", () => {
    const errs = validateReport(report({ nil: true, fields: { ...states("no_issues"), "a.x": { state: "details", entries: [] } } }), template)
    expect(errs.length).toBeGreaterThanOrEqual(1)
    expect(errs[0].message).toBe("Confirm each section has no issues, or add details")
  })
  it("needs an entry behind details / action_required", () => {
    expect(validateReport(report({ fields: states("details") }), template)).toHaveLength(3)
    const ok = { ...states("no_issues"), "a.x": { state: "details" as const, entries: [{ id: "e", text: "t" }] } }
    expect(validateReport(report({ fields: ok }), template)).toEqual([])
  })
  it("skips restricted sections the role cannot read", () => {
    const errs = validateReport(report(), template, ["a"])
    expect(errs.map((e) => e.key)).toEqual(["b.w"])
    expect(validateReport(report({ nil: true }), template, ["a", "b"])).toEqual([])
  })
})

describe("reportProgress", () => {
  it("counts fields that have a state", () => {
    expect(reportProgress(report(), template)).toEqual({ done: 0, total: 4 })
    expect(reportProgress(report({ fields: { "a.x": { state: "na", entries: [] }, "b.w": { entries: [] } } }), template)).toEqual({ done: 1, total: 4 })
  })
})

describe("isLateSubmission (BR-02)", () => {
  it("is late after the deadline on the report date", () => {
    expect(isLateSubmission(report({ submittedAt: "2026-10-20T17:31:00" }), "17:30")).toBe(true)
    expect(isLateSubmission(report({ submittedAt: "2026-10-20T17:30:00" }), "17:30")).toBe(false)
    expect(isLateSubmission(report({ submittedAt: "2026-10-20T16:52:00" }), "17:30")).toBe(false)
  })
  it("is late when submitted on a later day, and false when never submitted", () => {
    expect(isLateSubmission(report({ submittedAt: "2026-10-21T08:00:00" }), "17:30")).toBe(true)
    expect(isLateSubmission(report(), "17:30")).toBe(false)
  })
})

describe("sectionProgress", () => {
  it("counts sections whose required fields all have a state", () => {
    const r = report({ fields: { "a.x": { state: "na", entries: [] }, "a.y": { state: "na", entries: [] } } })
    expect(sectionProgress(r, template)).toEqual({ done: 1, total: 2 })
  })
})
