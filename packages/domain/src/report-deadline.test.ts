import { describe, expect, it } from "vitest"

import { dueLabel, memberDeadline, nextReportingShift, secondsUntil, teamDeadline } from "./report-deadline"
import { reportRows, type StoredReport } from "./shift-report"
import type { ShiftState } from "./shifts"

// Same zone as the seed org (shell/org.json).
const TZ = "Europe/Dublin"
const state: ShiftState = {
  patterns: [
    { id: "day", name: "Day patrol", team: "Security", start: "07:00", end: "15:00", days: [1, 2, 3, 4, 5] },
    { id: "night", name: "Night patrol", team: "Security", start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] },
    { id: "clean", name: "Day crew", team: "Cleaning", start: "06:00", end: "14:00", days: [1, 2, 3, 4, 5] },
  ],
  assignments: [
    { personId: "p-a", patternId: "day", from: "2026-09-01" },
    { personId: "p-b", patternId: "night", from: "2026-09-01" },
    { personId: "p-e", patternId: "clean", from: "2026-09-01" },
  ],
  members: [
    { personId: "p-boss", teams: ["Security", "Cleaning"], managerId: null },
    { personId: "p-a", teams: ["Security"], managerId: "p-boss" },
    { personId: "p-b", teams: ["Security"], managerId: "p-a" },
    { personId: "p-e", teams: ["Cleaning"], managerId: "p-boss" },
  ],
  reporting: { dueAfterMinutes: 60, teamDefaults: { Security: true, Cleaning: false }, overrides: { "p-e": true } },
}
const range = { from: "2026-10-19", to: "2026-10-20" }
const rowsAt = (now: string, stored: StoredReport[] = []) => reportRows(state, [], stored, range, now, TZ)
const submitted = (id: string, personId: string, at: string): StoredReport => ({
  id, personId, patternId: id.split(":")[1], date: id.split(":")[2], status: "submitted", summary: "", createdAt: at, updatedAt: at, submittedAt: at, comments: [], versions: [],
})

describe("dueLabel", () => {
  it("names today, tomorrow or the date", () => {
    expect(dueLabel("2026-10-20T16:00", "2026-10-20T09:00")).toBe("Due today, 4:00 PM")
    expect(dueLabel("2026-10-21T08:00", "2026-10-20T09:00")).toBe("Due tomorrow, 8:00 AM")
    expect(dueLabel("2026-10-23T08:00", "2026-10-20T09:00")).toMatch(/^Due Fri 23 Oct, 8:00 AM$/)
    expect(dueLabel(null, "2026-10-20T09:00")).toBe("No shift report due")
  })
})

describe("memberDeadline (FR-M1-22)", () => {
  it("in shift: the running shift's report is due an hour after it ends", () => {
    const now = "2026-10-20T09:00"
    const d = memberDeadline("p-a", rowsAt(now, [submitted("p-a:day:2026-10-19", "p-a", "2026-10-19T15:30")]), state, now, TZ)
    expect(d.dueAt).toBe("2026-10-20T16:00")
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0]).toMatchObject({ label: "Day patrol", status: { label: "Draft" } })
    expect(d.rows[0].detail).toMatch(/^In shift now · 0 tasks · due 4:00 PM$/)
    expect(d.rows[0].href).toBe("/daily-reports/p-a%3Aday%3A2026-10-20")
  })
  it("a missed report comes first and counts as missing; the next due is the open one", () => {
    const now = "2026-10-20T09:00"
    const d = memberDeadline("p-a", rowsAt(now), state, now, TZ)
    // 19 Oct day patrol had no submission: missing
    expect(d.missing).toBe(1)
    expect(d.rows[0]).toMatchObject({ label: "Day patrol", status: { label: "Missing" } })
    expect(d.dueAt).toBe("2026-10-20T16:00")
    const after = memberDeadline("p-a", rowsAt(now, [submitted("p-a:day:2026-10-19", "p-a", "2026-10-19T15:30")]), state, now, TZ)
    expect(after.missing).toBe(0)
  })
  it("between shifts: the next reporting shift's due time", () => {
    const now = "2026-10-20T17:00"
    const stored = [submitted("p-a:day:2026-10-19", "p-a", "2026-10-19T15:30"), submitted("p-a:day:2026-10-20", "p-a", "2026-10-20T15:10")]
    const d = memberDeadline("p-a", rowsAt(now, stored), state, now, TZ)
    expect(d.dueAt).toBe("2026-10-21T16:00")
    expect(d.dueLabel).toBe("Due tomorrow, 4:00 PM")
    expect(d.rows[0].status.label).toBe("Submitted")
  })
  it("nobody reporting: no due time and no rows", () => {
    const off: ShiftState = { ...state, reporting: { ...state.reporting, teamDefaults: { Security: false, Cleaning: false }, overrides: {} } }
    const d = memberDeadline("p-a", [], off, "2026-10-20T09:00", TZ)
    expect(d).toMatchObject({ dueAt: null, rows: [], missing: 0, dueLabel: "No shift report due" })
  })
})

describe("teamDeadline (managers)", () => {
  it("one row per team with in / due / missing counts and links", () => {
    const now = "2026-10-20T09:00"
    const d = teamDeadline(rowsAt(now), ["Security", "Cleaning"], state, now, TZ, () => true)
    expect(d.rows.map((r) => r.label)).toEqual(["Security", "Cleaning"])
    const sec = d.rows[0]
    // p-a: 19 missing, 20 open; p-b: night 19→20 missing (due 08:00), night 20 not started
    expect(sec.detail).toBe("0/3 in · 1 due")
    expect(sec.status).toEqual({ tone: "bad", label: "2 missing" })
    expect(sec.href).toBe("/daily-reports?team=Security&status=missing")
    expect(d.missing).toBe(3)
    expect(d.dueAt).toBe("2026-10-20T15:00")
  })
  it("all in: ok tone and the next shift's due time", () => {
    const now = "2026-10-20T15:30"
    const stored = [submitted("p-a:day:2026-10-20", "p-a", "2026-10-20T15:05")]
    const rows = rowsAt(now, stored).filter((r) => r.date === "2026-10-20" && r.team === "Security")
    const d = teamDeadline(rows, ["Security"], state, now, TZ, (p) => p === "p-a")
    expect(d.rows[0]).toMatchObject({ detail: "1/1 in", status: { tone: "ok", label: "All in" }, href: "/daily-reports?team=Security" })
    expect(d.dueAt).toBe("2026-10-21T16:00")
  })
  it("nextReportingShift respects the scope", () => {
    expect(nextReportingShift(state, "2026-10-20T09:00", TZ, (p) => p === "p-b")?.window.start).toBe("2026-10-20T22:00")
    expect(nextReportingShift(state, "2026-10-20T09:00", TZ, () => false)).toBeNull()
  })
})

describe("secondsUntil", () => {
  it("counts down to the due time and never goes negative", () => {
    expect(secondsUntil("2026-10-20T16:00", "2026-10-20T15:00", TZ)).toBe(3600)
    expect(secondsUntil("2026-10-20T14:00", "2026-10-20T15:00", TZ)).toBe(0)
    expect(secondsUntil(null, "2026-10-20T15:00", TZ)).toBe(0)
  })
})
