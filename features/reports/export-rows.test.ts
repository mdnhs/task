import { describe, expect, it } from "vitest"

import type { ShiftReport } from "@/lib/shift-report"
import { buildRangeDoc, buildReportDoc, toCsv } from "./export-rows"

// The seed org zone (public/data/shell/org.json).
const TZ = "Europe/Dublin"
const r = (over: Partial<ShiftReport> = {}): ShiftReport => ({
  id: "p-a:day:2026-10-19", personId: "p-a", patternId: "day", shiftName: "Day patrol", team: "Security", date: "2026-10-19",
  start: "2026-10-19T07:00", end: "2026-10-19T15:00", due: "2026-10-19T16:00", status: "submitted",
  items: [{ taskRef: "TSK-1", title: "Gate check", due: "2026-10-19T12:00:00", status: "done", minutes: 45, note: "All fine, \"gate 2\" stiff" }],
  summary: "Quiet", blockers: "", unplanned: [{ id: "u", text: "Reception cover", minutes: 30 }], attachments: [], extra: { "handover.next": "Check gate 2" },
  createdAt: "2026-10-19T14:00", updatedAt: "2026-10-19T16:20", submittedAt: "2026-10-19T16:20", comments: [], versions: [], ...over,
})

describe("shift report export (FR-M1-31)", () => {
  it("one report: details, task rows, unplanned and notes", () => {
    const d = buildReportDoc({ report: r(), owner: "Ann Lee", state: "late", tz: TZ, tzLabel: "Irish time", extraLabels: { "handover.next": "Notes for the next shift" } })
    expect(d.title).toBe("Shift report: Ann Lee")
    expect(d.meta).toContainEqual(["Status", "Late"])
    expect(d.meta).toContainEqual(["Submitted", "Mon 19 Oct 4:20 PM (late)"])
    expect(d.meta).toContainEqual(["Time reported", "1h 15m"])
    expect(d.tables[0].rows).toEqual([["TSK-1", "Gate check", "Done", "45m", "All fine, \"gate 2\" stiff"]])
    expect(d.tables[1].rows).toEqual([["Reception cover", "30m"]])
    expect(d.tables[2].rows).toContainEqual(["Notes for the next shift", "Check gate 2"])
    expect(d.fileBase).toBe("shift-report-ann-lee-2026-10-19")
  })
  it("a date range: one summary row per report and every task row", () => {
    const people = new Map([["p-a", { name: "Ann Lee" }], ["p-b", { name: "Bob" }]])
    const rows = [r(), r({ id: "p-b:day:2026-10-18", personId: "p-b", date: "2026-10-18", start: "2026-10-18T07:00", items: [], submittedAt: undefined, status: "draft" })]
    const d = buildRangeDoc({ rows, people, states: new Map([["p-a:day:2026-10-19", "late"], ["p-b:day:2026-10-18", "missing"]]), from: "2026-10-18", to: "2026-10-19", tz: TZ })
    expect(d.tables[0].rows.map((x) => [x[0], x[3], x[4], x[6]])).toEqual([["2026-10-18", "Bob", "Missing", "Not submitted"], ["2026-10-19", "Ann Lee", "Late", "Mon 19 Oct 4:20 PM (late)"]])
    expect(d.tables[1].rows).toEqual([["2026-10-19", "Ann Lee", "TSK-1", "Gate check", "Done", "45", "All fine, \"gate 2\" stiff"]])
    expect(d.subtitle).toBe("Sun 18 Oct to Mon 19 Oct · 2 reports")
    expect(d.fileBase).toBe("shift-reports-2026-10-18-to-2026-10-19")
  })
  it("CSV quotes commas, quotes and newlines and defuses formulas", () => {
    const csv = toCsv({ title: "", subtitle: "", meta: [], fileBase: "x", tables: [{ title: "A", head: ["a", "b"], rows: [["x, y", "say \"hi\""], ["=SUM(1)", "line\nbreak"]] }, { title: "B", head: ["c"], rows: [["1"]] }] })
    expect(csv).toBe('A\r\na,b\r\n"x, y","say ""hi"""\r\n\'=SUM(1),"line\nbreak"\r\n\r\nB\r\nc\r\n1\r\n')
  })
})
