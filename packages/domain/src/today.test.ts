import { describe, expect, it } from "vitest"
import { dayOrder, daySummary, handledToday, taskSpeech, teamOverdue, todayCounts, todayHasNews, todayMode, todayUpdate, workingDay, dismissedValue, TODAY_SOURCE } from "./today"
import type { TodayTask } from "./today"
import type { ShiftAssignment, ShiftPattern } from "./shifts"

const NOW = "2026-10-20T09:00:00"
const t = (ref: string, over: Partial<TodayTask> = {}): TodayTask => ({ ref, title: `Task ${ref}`, priority: 2, due: "2026-10-20T17:00:00", status: "in_progress", evidenceRequired: false, project: "Canary Wharf", ...over })

const tasks: TodayTask[] = [
  t("A", { due: "2026-10-19T12:00:00", priority: 1 }), // overdue, low
  t("B", { due: "2026-10-18T12:00:00", priority: 3 }), // overdue, high
  t("C", { due: "2026-10-20T08:00:00", status: "blocked" }), // overdue today, blocked
  t("D", { priority: 3, due: "2026-10-20T15:00:00" }), // high today
  t("E", { due: "2026-10-20T11:00:00", evidenceRequired: true }), // today
  t("F", { due: "2026-10-20T10:00:00" }), // today, earlier
  t("G", { due: "2026-10-21T10:00:00" }), // tomorrow
  t("H", { status: "completed", due: "2026-10-19T10:00:00" }),
  t("I", { status: "submitted", due: "2026-10-19T10:00:00" }),
]

describe("todayCounts", () => {
  it("counts open tasks only", () => {
    expect(todayCounts(tasks, NOW, { evidence: 2, reports: 1 })).toEqual({ overdue: 4, dueToday: 4, high: 2, review: 2, reports: 1, blocked: 1 })
  })
  it("defaults review to 0", () => expect(todayCounts([], NOW).review).toBe(0))
})

describe("dayOrder", () => {
  it("reads overdue first (priority, then due), then high today, then the rest by time", () => {
    expect(dayOrder(tasks, NOW).map((i) => i.task.ref)).toEqual(["B", "C", "A", "D", "F", "E"])
  })
  it("groups the items", () => {
    expect(dayOrder(tasks, NOW).map((i) => i.group)).toEqual(["overdue", "overdue", "overdue", "high-today", "today", "today"])
  })
  it("drops the plain today group for high-and-overdue", () => {
    expect(dayOrder(tasks, NOW, "high-and-overdue").map((i) => i.task.ref)).toEqual(["B", "C", "A", "D"])
  })
  it("skips tasks waiting on a reviewer", () => expect(dayOrder(tasks, NOW).some((i) => i.task.ref === "I")).toBe(false))
  it("gives a reason for each", () => {
    const o = dayOrder(tasks, NOW)
    expect(o[0].reason).toBe("overdue by 2 days; high priority")
    expect(o[1].reason).toContain("blocked")
    expect(o[5].reason).toContain("evidence needed")
  })
})

describe("daySummary", () => {
  it("states the headline and one line per task", () => {
    const s = daySummary(tasks, NOW)
    expect(s.headline).toBe("3 overdue, 1 high priority due today and 2 more due today")
    expect(s.lines.filter((l) => l.ref)).toHaveLength(6)
    expect(s.spoken).toContain("1 task is blocked")
  })
  it("handles an empty day", () => {
    expect(daySummary([], NOW).lines[0].text).toMatch(/clear day/)
    expect(daySummary([t("G", { due: "2026-10-21T10:00:00" })], NOW, "high-and-overdue").headline).toBe("Nothing needs you first")
  })
})

describe("taskSpeech", () => {
  it("includes title, priority, due, project and evidence", () => {
    const item = dayOrder(tasks, NOW).find((i) => i.task.ref === "E")!
    const s = taskSpeech(item, 6, 6, NOW)
    expect(s).toContain("Task E")
    expect(s).toContain("medium priority")
    expect(s).toContain("today at 11:00 AM")
    expect(s).toContain("Project: Canary Wharf")
    expect(s).toContain("Evidence needed.")
  })
})

describe("teamOverdue", () => {
  it("lists other people's overdue tasks, worst first", () => {
    const rows = [...tasks.map((x) => ({ ...x, assignee: "p-a" })), { ...t("Z", { due: "2026-10-01T10:00:00" }), assignee: "p-me" }]
    const r = teamOverdue(rows, "p-me", NOW, (id) => id.toUpperCase(), 2)
    expect(r.count).toBe(4)
    expect(r.items.map((i) => i.ref)).toEqual(["B", "I"])
    expect(r.items[0].who).toBe("P-A")
  })
})

const patterns: ShiftPattern[] = [
  { id: "day", name: "Day", team: "Sec", start: "07:00", end: "15:00", days: [0, 1, 2, 3, 4, 5, 6] },
  { id: "night", name: "Night", team: "Sec", start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] },
]
const assign = (personId: string, patternId: string): ShiftAssignment[] => [{ personId, patternId, from: "2026-09-01" }]

describe("workingDay", () => {
  it("starts at the shift start when the person has a shift", () => {
    const d = workingDay("p1", NOW, patterns, assign("p1", "day"), "Europe/Dublin")
    expect(d).toMatchObject({ key: "2026-10-20", startsAt: "2026-10-20T07:00", hasShift: true })
  })
  it("a night shift belongs to its start date", () => {
    const d = workingDay("p1", "2026-10-21T02:00:00", patterns, assign("p1", "night"), "Europe/Dublin")
    expect(d.key).toBe("2026-10-20")
    expect(d.startsAt).toBe("2026-10-20T22:00")
  })
  it("falls back to 04:00 without a shift", () => {
    expect(workingDay("p2", NOW, patterns, [], "Europe/Dublin")).toEqual({ key: "2026-10-20", startsAt: "2026-10-20T04:00:00", hasShift: false })
    expect(workingDay("p2", "2026-10-20T03:00:00", patterns, [], "Europe/Dublin").key).toBe("2026-10-19")
  })
})

describe("todayMode", () => {
  it("is closed by default; when switched on, shows the card until dismissed for this user and day", () => {
    expect(todayMode(undefined, undefined, "p1", "2026-10-20")).toBe("chip")
    expect(todayMode("1", undefined, "p1", "2026-10-20")).toBe("card")
    expect(todayMode("1", dismissedValue("p1", "2026-10-20"), "p1", "2026-10-20")).toBe("chip")
    expect(todayMode("1", dismissedValue("p1", "2026-10-19"), "p1", "2026-10-20")).toBe("card")
    expect(todayMode("1", dismissedValue("p2", "2026-10-20"), "p1", "2026-10-20")).toBe("card")
  })
})

describe("todayHasNews", () => {
  const zero = { overdue: 0, dueToday: 0, high: 0, review: 0, reports: 0, blocked: 0 }
  it("is true when any count or team line has something", () => {
    expect(todayHasNews(zero)).toBe(false)
    expect(todayHasNews({ ...zero, review: 9 })).toBe(true)
    expect(todayHasNews(zero, { overdue: { count: 0 }, missing: [] })).toBe(false)
    expect(todayHasNews(zero, { overdue: { count: 0 }, missing: [{}] })).toBe(true)
  })
})

describe("player actions through the tasks hand-off (FR-M1-74)", () => {
  it("builds one update per task, action and day", () => {
    const done = todayUpdate("done", "TSK-1", "t1", "2026-10-20", "Daniel Okafor", NOW)
    expect(done).toEqual({ id: "today:2026-10-20:TSK-1:done", tenantId: "t1", ref: "TSK-1", itemStatus: "done", minutes: 0, note: "", at: "2026-10-20T09:00", by: "Daniel Okafor", source: TODAY_SOURCE })
    expect(todayUpdate("snooze", "TSK-1", "t1", "2026-10-20", "D", NOW)).toMatchObject({ id: "today:2026-10-20:TSK-1:snooze", snooze: true })
  })
  it("reads back what was handled on this working day only", () => {
    const ups = [
      todayUpdate("done", "A", "t1", "2026-10-20", "D", NOW),
      todayUpdate("snooze", "B", "t1", "2026-10-20", "D", NOW),
      todayUpdate("snooze", "C", "t1", "2026-10-19", "D", NOW),
      { ...todayUpdate("done", "D", "t1", "2026-10-20", "D", NOW), source: "shift report" },
    ]
    const h = handledToday(ups, "2026-10-20")
    expect([...h.done]).toEqual(["A"])
    expect([...h.snoozed]).toEqual(["B"])
  })
})
