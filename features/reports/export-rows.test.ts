import { describe, expect, it } from "vitest"
import { buildBoardDoc, buildHistoryDoc, buildReportDoc, exportFileBase } from "./export-rows"
import type { Report, TemplateSection } from "./types"

const template: TemplateSection[] = [
  { id: "staff", n: 1, title: "Staff", fields: [{ id: "call-outs", label: "Call-outs", required: true, entry: "structured", columns: ["Staff", "Shift"] }, { id: "cover", label: "Cover", required: true, entry: "text" }] },
  { id: "payroll", n: 2, title: "Payroll", restricted: true, fields: [{ id: "x", label: "X", required: true, entry: "text" }] },
]
const report: Report = {
  id: "R1", date: "2026-10-20", dept: "Security", owner: "p1", status: "submitted", createdAt: "2026-10-20T08:00:00", updatedAt: "2026-10-20T18:00:00",
  submittedAt: "2026-10-20T18:00:00", nil: false, comments: [], versions: [],
  fields: {
    "staff.call-outs": { state: "details", entries: [{ id: "1", text: "A, 9", cells: { Staff: "A", Shift: "9" } }] },
    "staff.cover": { state: "no_issues", entries: [] },
  },
}
const people = new Map([["p1", { id: "p1", name: "Daniel", role: "", initials: "D", avatar: "av1" as const, dept: "Security" }]])

describe("export rows", () => {
  it("names files from department and date", () => {
    expect(exportFileBase("Orders / Stock", "2026-10-20T09:00:00")).toBe("daily-report-orders-stock-2026-10-20")
  })

  it("builds a report doc with answers, entries and a late flag", () => {
    const d = buildReportDoc({ report, template, owner: "Daniel", deadline: "17:30", tzLabel: "UK time" })
    expect(d.fileBase).toBe("daily-report-security-2026-10-20")
    expect(d.meta).toContainEqual(["Submitted", "6:00 PM (late)"])
    expect(d.tables[0].rows[0]).toEqual(["Call-outs", "Details provided", "Staff: A; Shift: 9"])
    expect(d.tables[0].rows[1]).toEqual(["Cover", "No issues", ""])
    expect(d.tables[1].rows[0][1]).toBe("Not answered")
  })

  it("leaves out sections the role may not read", () => {
    const d = buildReportDoc({ report, template, owner: "Daniel", skip: ["payroll"], deadline: "17:30", tzLabel: "UK time" })
    expect(d.tables.map((t) => t.title)).toEqual(["1. Staff"])
  })

  it("builds the board with one row per department", () => {
    const d = buildBoardDoc({ reports: [report], people, template, departments: ["Security", "Cleaning"], today: "2026-10-20T09:00:00", tzLabel: "UK time", deadline: "17:30" })
    expect(d.tables[0].rows[0]).toEqual(["Security", "Daniel", "Submitted", "6:00 PM (late)", "1 of 2"])
    expect(d.tables[0].rows[1]).toEqual(["Cleaning", "Unassigned", "Not started", "Not started", "0 of 2"])
  })

  it("builds history with or without the owner column", () => {
    const base = { reports: [report], people, today: "2026-10-20T09:00:00", deadline: "17:30" }
    expect(buildHistoryDoc({ ...base, showOwner: true }).tables[0].head).toContain("Owner")
    expect(buildHistoryDoc({ ...base, showOwner: false }).tables[0].rows[0]).toHaveLength(5)
  })
})
