import { describe, expect, it } from "vitest"

import {
  acceptReport, buildDraft, canEditReport, canReviewReport, currentReport, extraSections, inScope, isLate, itemProgress, itemStatusOf, matchesReport,
  mergeStored, minutesText, needsAction, occurrenceOf, parseReportFilters, reportRows, reportState, reportingShifts, returnReport, scopeReports,
  sectionOn, submitReport, taskInShift, taskStatusFor, taskUpdatesFor, tasksForShift, teamOf, templateFor, totalMinutes, validateReport, windowLabel,
  EMPTY_REPORT_FILTERS, missingRecipients, draftPhase,
  type ShiftReport, type ShiftTask, type StoredReport, type TemplateSection,
} from "./shift-report"
import { shiftWindow, type ShiftState } from "./shifts"

// The seed org zone (public/data/shell/org.json).
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
    { personId: "p-c", patternId: "clean", from: "2026-09-01" },
    { personId: "p-d", patternId: "day", from: "2026-09-01" },
    { personId: "p-e", patternId: "clean", from: "2026-09-01" },
  ],
  members: [
    { personId: "p-boss", teams: ["Security", "Cleaning"], managerId: null },
    { personId: "p-a", teams: ["Security"], managerId: "p-boss" },
    { personId: "p-b", teams: ["Security"], managerId: "p-a" },
    { personId: "p-c", teams: ["Cleaning"], managerId: "p-lead" },
    { personId: "p-lead", teams: ["Cleaning"], managerId: "p-boss" },
    { personId: "p-d", teams: ["Security"], managerId: "p-a" },
    { personId: "p-e", teams: ["Cleaning"], managerId: "p-lead" },
  ],
  reporting: { dueAfterMinutes: 60, teamDefaults: { Security: true, Cleaning: false }, overrides: { "p-d": false, "p-e": true } },
}

const task = (ref: string, over: Partial<ShiftTask> = {}): ShiftTask => ({
  ref, title: ref, assignee: "p-a", status: "in_progress", start: "2026-10-18T09:00:00", due: "2026-10-21T12:00:00", ...over,
})
// Mon 19 Oct 2026, day patrol 07:00–15:00
const w = shiftWindow(state.patterns[0], "2026-10-19", TZ)
const occ = { personId: "p-a", pattern: state.patterns[0], window: w }

describe("tasks in a shift (FR-M1-23, AC-M1-02)", () => {
  it("takes the person's open tasks that started before the shift ended", () => {
    expect(taskInShift(task("T1"), "p-a", w)).toBe(true)
    expect(taskInShift(task("T1", { assignee: "p-b" }), "p-a", w)).toBe(false)
    expect(taskInShift(task("T1", { status: "cancelled" }), "p-a", w)).toBe(false)
    // any assignee counts; archived tasks are out
    expect(taskInShift(task("T1", { assignee: "p-b", assignees: ["p-a"] }), "p-a", w)).toBe(true)
    expect(taskInShift(task("T1", { archivedAt: "2026-10-18T10:00:00" }), "p-a", w)).toBe(false)
  })
  it("a task starting at or after the shift end is not in it; one starting during it is", () => {
    expect(taskInShift(task("T1", { start: "2026-10-19T15:00:00" }), "p-a", w)).toBe(false)
    expect(taskInShift(task("T1", { start: "2026-10-19T14:59:00" }), "p-a", w)).toBe(true)
  })
  it("a task due in the window is in; an overdue open task is still in", () => {
    expect(taskInShift(task("T1", { due: "2026-10-19T10:00:00" }), "p-a", w)).toBe(true)
    expect(taskInShift(task("T1", { due: "2026-10-16T10:00:00", status: "blocked" }), "p-a", w)).toBe(true)
  })
  it("a task finished before the shift started is out; finished during the shift is in", () => {
    expect(taskInShift(task("T1", { status: "completed", completedAt: "2026-10-18T16:00:00" }), "p-a", w)).toBe(false)
    expect(taskInShift(task("T1", { status: "completed", completedAt: "2026-10-19T08:30:00" }), "p-a", w)).toBe(true)
    expect(taskInShift(task("T1", { status: "submitted", submittedAt: "2026-10-19T06:59:00" }), "p-a", w)).toBe(false)
    // finished with no time: its due time decides
    expect(taskInShift(task("T1", { status: "completed", due: "2026-10-19T12:00:00" }), "p-a", w)).toBe(true)
    expect(taskInShift(task("T1", { status: "completed", due: "2026-10-18T12:00:00" }), "p-a", w)).toBe(false)
  })
  it("works for a night shift across midnight", () => {
    const nw = shiftWindow(state.patterns[1], "2026-10-19", TZ) // 22:00 → 07:00 Tue
    expect(taskInShift(task("T1", { assignee: "p-b", start: "2026-10-20T02:00:00" }), "p-b", nw)).toBe(true)
    expect(taskInShift(task("T1", { assignee: "p-b", start: "2026-10-20T07:00:00" }), "p-b", nw)).toBe(false)
  })
  it("sorts by due then ref", () => {
    const list = tasksForShift("p-a", w, [task("T2", { due: "2026-10-20T10:00:00" }), task("T1", { due: "2026-10-20T10:00:00" }), task("T0", { due: "2026-10-19T09:00:00" })])
    expect(list.map((t) => t.ref)).toEqual(["T0", "T1", "T2"])
  })
  it("maps task status to the row's starting status", () => {
    expect(["completed", "submitted", "in_progress", "changes_requested", "blocked", "not_started"].map(itemStatusOf)).toEqual(["done", "done", "in_progress", "in_progress", "blocked", "not_started"])
  })
})

describe("buildDraft and reportRows", () => {
  it("builds one row per task in the shift with the due time 60 min after the end", () => {
    const r = buildDraft(occ, [task("T1"), task("T2", { status: "blocked" }), task("X", { assignee: "p-b" })], 60, "2026-10-19T09:00")
    expect(r.id).toBe("p-a:day:2026-10-19")
    expect(r.items.map((i) => [i.taskRef, i.status, i.minutes, i.note])).toEqual([["T1", "in_progress", 0, ""], ["T2", "blocked", 0, ""]])
    expect([r.start, r.end, r.due, r.team, r.shiftName, r.status]).toEqual(["2026-10-19T07:00", "2026-10-19T15:00", "2026-10-19T16:00", "Security", "Day patrol", "draft"])
  })
  it("only reporting members get a report (AC-M1-01) and only shifts that have started", () => {
    const occs = reportingShifts(state, "2026-10-19", "2026-10-20", "2026-10-20T09:00", TZ)
    // p-a (team on), p-b (team on), p-e (override on); p-c (team off) and p-d (override off) never appear
    expect(occs.map((o) => `${o.personId}:${o.window.date}`).sort()).toEqual(["p-a:2026-10-19", "p-a:2026-10-20", "p-b:2026-10-19", "p-e:2026-10-19", "p-e:2026-10-20"])
  })
  it("merges stored reports and keeps stored ones whose shift no longer reports", () => {
    const stored: StoredReport[] = [
      { id: "p-a:day:2026-10-19", personId: "p-a", patternId: "day", date: "2026-10-19", status: "submitted", summary: "ok", items: [{ taskRef: "T1", minutes: 45, status: "done" }, { taskRef: "OLD", title: "Old task", minutes: 10 }], createdAt: "2026-10-19T14:00", updatedAt: "2026-10-19T15:10", submittedAt: "2026-10-19T15:10", comments: [], versions: [{ v: 1, at: "2026-10-19T15:10", by: "A", note: "Submitted" }] },
      { id: "p-c:clean:2026-10-19", personId: "p-c", patternId: "clean", date: "2026-10-19", status: "accepted", summary: "x", createdAt: "2026-10-19T13:00", updatedAt: "2026-10-19T13:00", comments: [], versions: [] },
    ]
    const rows = reportRows(state, [task("T1")], stored, { from: "2026-10-19", to: "2026-10-19" }, "2026-10-20T09:00", TZ)
    const a = rows.find((r) => r.id === "p-a:day:2026-10-19")!
    expect(a.items.map((i) => [i.taskRef, i.title, i.status, i.minutes])).toEqual([["T1", "T1", "done", 45], ["OLD", "Old task", "not_started", 10]])
    expect(a.end).toBe("2026-10-19T15:00")
    expect(rows.some((r) => r.id === "p-c:clean:2026-10-19")).toBe(true)
    expect(rows.map((r) => r.start)).toEqual([...rows.map((r) => r.start)].sort().reverse())
  })
  it("mergeStored always takes shift fields from the shift", () => {
    const d = buildDraft(occ, [], 60, "2026-10-19T09:00")
    const m = mergeStored(d, { id: "x", personId: "p-z", patternId: "y", date: "2000-01-01", status: "draft", summary: "", createdAt: "", updatedAt: "", comments: [], versions: [] })
    expect([m.id, m.personId, m.date, m.due]).toEqual([d.id, "p-a", "2026-10-19", "2026-10-19T16:00"])
  })
  it("occurrenceOf reads a report id back", () => {
    expect(occurrenceOf("p-b:night:2026-10-19", state, TZ)?.window.end).toBe("2026-10-20T07:00")
    expect(occurrenceOf("p-b:gone:2026-10-19", state, TZ)).toBeNull()
  })
})

const base = (over: Partial<ShiftReport> = {}): ShiftReport => ({ ...buildDraft(occ, [task("T1"), task("T2")], 60, "2026-10-19T09:00"), ...over })

describe("status (FR-M1-28, FR-M1-30)", () => {
  it("draft before the due time, missing after it", () => {
    expect(reportState(base(), "2026-10-19T16:00", TZ)).toBe("draft")
    expect(reportState(base(), "2026-10-19T16:01", TZ)).toBe("missing")
  })
  it("submitted on time vs late uses the first submission", () => {
    expect(reportState(base({ status: "submitted", submittedAt: "2026-10-19T16:00" }), "2026-10-20T09:00", TZ)).toBe("submitted")
    expect(reportState(base({ status: "submitted", submittedAt: "2026-10-19T16:05" }), "2026-10-20T09:00", TZ)).toBe("late")
    expect(isLate(base({ submittedAt: "2026-10-19T16:05" }), TZ)).toBe(true)
  })
  it("accepted and returned are kept as is", () => {
    expect(reportState(base({ status: "accepted", submittedAt: "2026-10-19T18:00" }), "2026-10-20T09:00", TZ)).toBe("accepted")
    expect(reportState(base({ status: "returned" }), "2026-10-20T09:00", TZ)).toBe("returned")
  })
  it("draft phase says in shift or open", () => {
    expect(draftPhase(base(), "2026-10-19T14:59", TZ)).toBe("in_shift")
    expect(draftPhase(base(), "2026-10-19T15:00", TZ)).toBe("open")
  })
  it("needsAction lists returned, missing and ended drafts; currentReport prefers the running shift", () => {
    const rows = [
      base({ id: "a", start: "2026-10-20T07:00", end: "2026-10-20T15:00", due: "2026-10-20T16:00" }),
      base({ id: "b" }),
      base({ id: "c", start: "2026-10-16T07:00", end: "2026-10-16T15:00", due: "2026-10-16T16:00", status: "returned" }),
      base({ id: "d", start: "2026-10-15T07:00", end: "2026-10-15T15:00", due: "2026-10-15T16:00", status: "accepted" }),
    ]
    expect(needsAction(rows, "p-a", "2026-10-20T09:00", TZ).map((r) => r.id)).toEqual(["c", "b"])
    expect(currentReport(rows, "p-a", "2026-10-20T09:00", TZ)?.id).toBe("a")
    expect(currentReport(rows, "p-a", "2026-10-20T06:00", TZ)?.id).toBe("b")
    expect(currentReport(rows, "p-x", "2026-10-20T09:00", TZ)).toBeUndefined()
  })
})

const template: TemplateSection[] = [
  { id: "tasks", title: "Tasks", enabled: true, fields: [{ id: "time", label: "Time", required: true }, { id: "note", label: "Note", required: true }] },
  { id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Summary", required: true }] },
  { id: "blockers", title: "Blockers", enabled: true, fields: [{ id: "blockers", label: "Blockers", required: false }] },
  { id: "unplanned", title: "Unplanned", enabled: true, fields: [{ id: "unplanned", label: "Unplanned", required: false }] },
  { id: "attachments", title: "Attachments", enabled: false, fields: [{ id: "attachments", label: "Files", required: true }] },
  { id: "handover", title: "Handover", enabled: true, fields: [{ id: "next", label: "Notes for the next shift", required: true }, { id: "keys", label: "Keys", required: false }] },
  { id: "off", title: "Off", enabled: false, fields: [{ id: "x", label: "X", required: true }] },
]

describe("template and validation (FR-M1-25)", () => {
  it("picks the team template, falling back to the first", () => {
    const data = { departments: [{ dept: "Security", sections: template }, { dept: "Cleaning", sections: [] }] }
    expect(templateFor("Cleaning", data)).toEqual([])
    expect(templateFor("Nope", data)).toBe(template)
    expect(templateFor("x", { departments: [] })).toEqual([])
  })
  it("knows which sections are on and which are extra", () => {
    expect(sectionOn(template, "attachments")).toBe(false)
    expect(sectionOn([], "summary")).toBe(true)
    expect(sectionOn([], "custom")).toBe(false)
    expect(extraSections(template).map((s) => s.id)).toEqual(["handover"])
  })
  it("requires time on done/in-progress rows, a note on blocked rows, summary and required extra fields", () => {
    const r = base({ items: [
      { taskRef: "T1", title: "", due: "", status: "done", minutes: 0, note: "" },
      { taskRef: "T2", title: "", due: "", status: "blocked", minutes: 0, note: " " },
      { taskRef: "T3", title: "", due: "", status: "not_started", minutes: 0, note: "" },
    ] })
    expect(validateReport(r, template).map((e) => e.key)).toEqual(["item:T1:minutes", "item:T2:note", "summary", "extra:handover.next"])
    const ok = { ...r, summary: "Quiet shift", extra: { "handover.next": "Gate 2 light out" }, items: r.items.map((i) => ({ ...i, minutes: 30, note: "Waiting for parts" })) }
    expect(validateReport(ok, template)).toEqual([])
  })
  it("an off section is not validated; a required optional section is", () => {
    const t = template.map((s) => (s.id === "unplanned" ? { ...s, fields: [{ ...s.fields[0], required: true }] } : s.id === "tasks" ? { ...s, enabled: false } : s))
    const errs = validateReport(base({ summary: "x", extra: { "handover.next": "y" }, unplanned: [{ id: "u", text: " ", minutes: 0 }] }), t)
    expect(errs.map((e) => e.key)).toEqual(["unplanned"])
  })
})

describe("lifecycle (FR-M1-27, FR-M1-29)", () => {
  it("submitting locks the report, keeps the first time and adds versions", () => {
    const s1 = submitReport(base({ unplanned: [{ id: "u1", text: "Helped at reception", minutes: 20 }, { id: "u2", text: "", minutes: 0 }] }), "2026-10-19T15:30", "A")
    expect(s1.status).toBe("submitted")
    expect(s1.unplanned.map((u) => u.id)).toEqual(["u1"])
    expect(canEditReport(s1, "p-a", true)).toBe(false)
    expect(canReviewReport(s1)).toBe(true)
    const ret = returnReport(s1, "2026-10-19T17:00", "Boss", "Add the time for T2")
    expect(ret.comments.at(-1)).toEqual({ at: "2026-10-19T17:00", by: "Boss", text: "Add the time for T2" })
    expect(canEditReport(ret, "p-a", true)).toBe(true)
    expect(canEditReport(ret, "p-b", true)).toBe(false)
    expect(canEditReport(ret, "p-a", false)).toBe(false)
    const s2 = submitReport(ret, "2026-10-20T08:00", "A")
    expect(s2.submittedAt).toBe("2026-10-19T15:30")
    expect(s2.versions.map((v) => v.note)).toEqual(["Submitted", "Resubmitted"])
    const acc = acceptReport(s2, "2026-10-20T09:00", "Boss")
    expect([acc.status, acc.reviewedBy, acc.reviewedAt]).toEqual(["accepted", "Boss", "2026-10-20T09:00"])
    expect(canReviewReport(acc)).toBe(false)
  })
})

describe("task updates on submit (FR-M1-26)", () => {
  it("maps row status without moving a task backwards", () => {
    expect(taskStatusFor("done", "in_progress", false)).toBe("completed")
    expect(taskStatusFor("done", "in_progress", true)).toBe("submitted")
    expect(taskStatusFor("blocked", "not_started", false)).toBe("blocked")
    expect(taskStatusFor("in_progress", "changes_requested", false)).toBe("in_progress")
    expect(taskStatusFor("not_started", "in_progress", false)).toBe("in_progress")
    expect(taskStatusFor("in_progress", "completed", false)).toBe("completed")
    expect(taskStatusFor("done", "cancelled", false)).toBe("cancelled")
  })
  it("one update per row with an id per version", () => {
    const r = submitReport(base({ items: [{ taskRef: "T1", title: "", due: "", status: "done", minutes: 44.6, note: " ok " }] }), "2026-10-19T15:30", "A")
    expect(taskUpdatesFor(r, "t1", "Ann", "2026-10-19T15:30")).toEqual([
      { id: "p-a:day:2026-10-19:v1:T1", tenantId: "t1", ref: "T1", itemStatus: "done", minutes: 45, note: "ok", at: "2026-10-19T15:30", by: "Ann", source: "shift report Day patrol, 2026-10-19" },
    ])
  })
})

describe("scope", () => {
  it("team = everyone below the manager, own = self, all = everyone", () => {
    expect([...teamOf("p-a", state.members)].sort()).toEqual(["p-b", "p-d"])
    expect([...teamOf("p-boss", state.members)].sort()).toEqual(["p-a", "p-b", "p-c", "p-d", "p-e", "p-lead"])
    expect(inScope("p-c", { kind: "team", managerId: "p-lead" }, state.members)).toBe(true)
    expect(inScope("p-a", { kind: "team", managerId: "p-lead" }, state.members)).toBe(false)
    expect(inScope("p-a", { kind: "own", personId: "p-a" }, state.members)).toBe(true)
    expect(scopeReports([{ personId: "p-a" }, { personId: "p-b" }], { kind: "own", personId: "p-b" }, state.members)).toEqual([{ personId: "p-b" }])
    expect(scopeReports([{ personId: "p-a" }], { kind: "all" }, state.members)).toHaveLength(1)
  })
  it("alerts go to the member and their primary manager", () => {
    expect(missingRecipients({ personId: "p-b" }, state.members)).toEqual({ member: "p-b", manager: "p-a" })
    expect(missingRecipients({ personId: "p-boss" }, state.members)).toEqual({ member: "p-boss", manager: null })
  })
})

describe("filters and labels", () => {
  it("parses known values only", () => {
    expect(parseReportFilters({ from: "2026-10-14", to: "bad", team: "Security", person: ["p-a"], status: "late" }, { teams: ["Security"], people: ["p-a"] }))
      .toEqual({ from: "2026-10-14", to: "", team: "Security", person: "p-a", status: "late" })
    expect(parseReportFilters({ team: "X", person: "p-z", status: "overdue" }, { teams: [], people: [] })).toEqual(EMPTY_REPORT_FILTERS)
  })
  it("matches date range, team, person and status", () => {
    const r = base()
    expect(matchesReport(r, "missing", { ...EMPTY_REPORT_FILTERS, from: "2026-10-19", to: "2026-10-19", team: "Security", person: "p-a", status: "missing" })).toBe(true)
    expect(matchesReport(r, "missing", { ...EMPTY_REPORT_FILTERS, from: "2026-10-20" })).toBe(false)
    expect(matchesReport(r, "missing", { ...EMPTY_REPORT_FILTERS, to: "2026-10-18" })).toBe(false)
    expect(matchesReport(r, "missing", { ...EMPTY_REPORT_FILTERS, team: "Cleaning" })).toBe(false)
    expect(matchesReport(r, "missing", { ...EMPTY_REPORT_FILTERS, status: "late" })).toBe(false)
  })
  it("labels windows, totals and progress", () => {
    expect(windowLabel({ start: "2026-10-19T22:00", end: "2026-10-20T07:00" })).toBe("22:00–07:00 +1")
    expect(windowLabel(base())).toBe("07:00–15:00")
    const r = base({ items: [{ taskRef: "a", title: "", due: "", status: "done", minutes: 90, note: "" }, { taskRef: "b", title: "", due: "", status: "blocked", minutes: 0, note: "x" }, { taskRef: "c", title: "", due: "", status: "not_started", minutes: 0, note: "" }], unplanned: [{ id: "u", text: "x", minutes: 15 }] })
    expect(totalMinutes(r)).toBe(105)
    expect([minutesText(0), minutesText(45), minutesText(105)]).toEqual(["0m", "45m", "1h 45m"])
    expect(itemProgress(r)).toEqual({ done: 2, total: 3 })
  })
})
