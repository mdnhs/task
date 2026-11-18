import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { ApiError, userMessage } from "@/lib/api/problem"
import { MGR, ME, RID, TASK, TEAM, TZ, dashboardDto, memberDeadlineDto, staffDto, todayDto } from "@/test/support/report-dto"
import { toAttention, toDashboard, toDeadlineCard, toStaff, toTeamTasks, toToday } from "./adapters"
import { makeTodayClient } from "./client"

const people = [{ id: ME, name: "Ann Byrne", role: "Supervisor", initials: "AB", avatar: "av1" as const, dept: "Security" }]

describe("toDashboard: the figures are the DTO's, never recounted", () => {
  test("summary cards equal the DTO and the reports card shows the team numbers", () => {
    const d = toDashboard(dashboardDto(), { tz: TZ })
    const by = Object.fromEntries(d.summary.stats.map((s) => [s.title, s]))
    expect(by["Open Tasks"]!.value).toBe("42")
    expect(by["Open Tasks"]!.trend).toEqual([4, 6, 3, 7, 5, 2, 5])
    expect(by["Overdue Tasks"]!.value).toBe("3")
    expect(by["Awaiting Review"]!.value).toBe("2")
    expect(by["Shift Reports"]!.value).toBe("2")
    expect(by["Shift Reports"]!.note).toMatchObject({ tone: "down", highlight: "1 missing" })
    expect(d.attentionCount).toBe(9)
  })
  test("a payload without the team report numbers has no Shift Reports card (permission-hidden cards stay out)", () => {
    const d = toDashboard(dashboardDto({ reportDeadline: { member: null, team: null } }), { tz: TZ })
    expect(d.summary.stats.map((s) => s.title)).toEqual(["Open Tasks", "Overdue Tasks", "Awaiting Review"])
    expect(d.deadline).toBeUndefined()
  })
  test("the awaiting-reports figure is the DTO's (which already leaves out the caller's own submitted reports)", () => {
    const d = toDashboard(dashboardDto({ reportDeadline: { member: null, team: { open: 0, missing: 0, awaitingReview: 7, nextDueAt: null, teams: [] } } }), { tz: TZ })
    expect(d.summary.stats.find((s) => s.title === "Shift Reports")!.value).toBe("7")
  })
  test("tasks closed: counts, late, top closer, on-time share and the weekday from the DTO's dates", () => {
    const d = toDashboard(dashboardDto(), { tz: TZ })
    expect(d.tasksClosed.days).toHaveLength(2)
    expect(d.tasksClosed.days[0]).toMatchObject({ d: "S", n: 5, late: 1, on: 80, topCloser: { name: "Ann Byrne", count: 2 }, date: "24 Oct, 2026" })
    expect(d.tasksClosed.days[1]).toMatchObject({ n: 0, on: 100, topCloser: null, t: "today" })
  })
  test("progress: the DTO's percent and mix, grouped into the three arcs", () => {
    const d = toDashboard(dashboardDto(), { tz: TZ })
    expect(d.progress.percent).toBe(40)
    expect(d.progress.legend).toEqual([
      { key: "solid", label: "Completed", count: 30 },
      { key: "deep", label: "In progress", count: 15 },
      { key: "striped", label: "Blocked", count: 2 },
    ])
    expect(d.progress.layers.map((l) => l.to)).toEqual([1, 0.75, 0.5])
  })
  test("a missing field throws", () => {
    const x = dashboardDto() as Record<string, unknown>
    delete x.summary
    expect(() => toDashboard(x, { tz: TZ })).toThrow()
  })
})

describe("the report deadline card counts down against the instants", () => {
  test("a manager: one row per team, the next due instant, the missing count", () => {
    const c = toDeadlineCard(dashboardDto().reportDeadline, { tz: TZ, nowAt: "2026-10-25T05:00:00.000Z", tzLabel: "Irish time", dueAfterMinutes: 60 })!
    expect(c).toMatchObject({ kind: "team", title: "Shift report deadline", missing: 1, seconds: 7200, note: "Irish time · shift end + 60 min" })
    expect(c.rows).toEqual([{ key: "Security", label: "Security", detail: "3 open", status: { tone: "bad", label: "1 missing" }, href: "/daily-reports?team=Security&status=missing" }])
    expect(c.dueLabel).toMatch(/Due today, 7:00 AM/)
  })
  test("the 24 Oct night over the DST fold: due 07:00 GMT is 07:00Z, two hours after 05:00Z (never an hour early)", () => {
    const m = toDeadlineCard({ member: memberDeadlineDto(), team: null }, { tz: TZ, nowAt: "2026-10-25T05:00:00.000Z", tzLabel: "Irish time", dueAfterMinutes: 60 })!
    expect(m.kind).toBe("member")
    expect(m.seconds).toBe(7200)
    expect(m.dueLabel).toMatch(/7:00 AM/)
    expect(m.rows[0]).toMatchObject({ label: "Night", href: `/daily-reports/${encodeURIComponent(`${ME}:${"7c1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"}:2026-10-24`)}` })
  })
  test("across the fold the countdown is REAL elapsed time: 00:15Z (01:15 IST) to 07:00Z (07:00 GMT) is 6 h 45 min, not the 5 h 45 min the wall clocks differ by", () => {
    const m = toDeadlineCard({ member: memberDeadlineDto(), team: null }, { tz: TZ, nowAt: "2026-10-25T00:15:00.000Z", tzLabel: "Irish time", dueAfterMinutes: 60 })!
    expect(m.seconds).toBe(6 * 3600 + 45 * 60)
    const t = toDeadlineCard(dashboardDto().reportDeadline, { tz: TZ, nowAt: "2026-10-25T00:15:00.000Z", tzLabel: "Irish time", dueAfterMinutes: 60 })!
    expect(t.seconds).toBe(6 * 3600 + 45 * 60)
  })
  test("the 27 Mar 2027 night: due 07:00 BST is 06:00Z", () => {
    const m = toDeadlineCard({ member: memberDeadlineDto({ shiftDate: "2027-03-27", startAt: "2027-03-27T22:00:00.000Z", endAt: "2027-03-28T05:00:00.000Z", dueAt: "2027-03-28T06:00:00.000Z" }), team: null }, { tz: TZ, nowAt: "2027-03-28T05:00:00.000Z", tzLabel: "Irish time", dueAfterMinutes: 60 })!
    expect(m.seconds).toBe(3600)
    expect(m.dueLabel).toMatch(/7:00 AM/)
  })
  test("a Pacific/Auckland tenant sees its own wall time", () => {
    const m = toDeadlineCard({ member: memberDeadlineDto(), team: null }, { tz: "Pacific/Auckland", nowAt: "2026-10-25T05:00:00.000Z", tzLabel: "New Zealand Time", dueAfterMinutes: 60 })!
    expect(m.dueLabel).toMatch(/8:00 PM/)
  })
  test("a draft past its due instant is Missing; with an opened report the row links to its uuid", () => {
    const m = toDeadlineCard({ member: memberDeadlineDto({ reportId: RID }), team: null }, { tz: TZ, nowAt: "2026-10-25T08:00:00.000Z", tzLabel: "Irish time", dueAfterMinutes: 60 })!
    expect(m.rows[0]).toMatchObject({ status: { tone: "bad", label: "Missing" }, href: `/daily-reports/${RID}` })
    expect(m.seconds).toBe(0)
  })
  test("no report and no due time gives no card", () => {
    expect(toDeadlineCard({ member: null, team: null }, { tz: TZ, nowAt: "2026-10-25T05:00:00.000Z", tzLabel: "x", dueAfterMinutes: 60 })).toBeUndefined()
  })
})

describe("the staff dashboard", () => {
  test("counts are the DTO's (not recounted from the list), rows carry the right state, evidence and comments map", () => {
    const s = toStaff(staffDto({ myTasks: { open: 9, overdue: 4, review: 2, returned: 1, items: staffDto().myTasks.items } }), { tz: TZ })
    expect(s.myTasks.counts).toEqual({ open: 9, overdue: 4, review: 2, returned: 1 })
    expect(s.myTasks.tasks[0]).toMatchObject({ ref: "TSK-1001", state: "open", due: "2026-10-25T03:00" })
    expect(s.evidence).toMatchObject({ awaitingReview: 0, returned: [{ ref: "TSK-1002", title: "Lock up", reason: "Photo is blurry" }] })
    expect(s.comments.items[0]).toMatchObject({ ref: "TSK-1001", title: "Check fire exits", by: "Mia Doyle", at: "2026-10-24T17:00" })
    expect((s.reportDeadline.member as { shiftName: string }).shiftName).toBe("Night") // the card itself is built by the loader with the org clock (toDeadlineCard)
  })
  test("status becomes the row state (blocked, review, returned)", () => {
    const items = (st: string) => [{ ...staffDto().myTasks.items[0], status: st }]
    for (const [st, state] of [["blocked", "blocked"], ["submitted", "review"], ["changes_requested", "returned"], ["not_started", "open"]] as const)
      expect(toStaff(staffDto({ myTasks: { ...staffDto().myTasks, items: items(st) } }), { tz: TZ }).myTasks.tasks[0]!.state).toBe(state)
  })
})

describe("team tasks and attention", () => {
  test("team tasks: assignee, role from the directory, wall due from the instant, late from the DTO", () => {
    const t = toTeamTasks({ items: [{ id: TASK, ref: "TSK-1001", title: "Check", assigneeId: ME, assignee: "Ann Byrne", dept: "Security", priority: 3, dueAt: "2026-10-25T01:30:00.000Z", due: "2026-10-25T01:30:00", late: true, status: "in_progress" }], nextCursor: "c1" }, { people, tz: TZ, today: "2026-10-25T09:00:00" })
    expect(t.nextCursor).toBe("c1")
    expect(t.tasks[0]).toMatchObject({ name: "Ann Byrne", role: "Supervisor", initials: "AB", ref: "TSK-1001", dept: "Security", priority: 3, late: true, status: { tone: "warn", label: "In Progress" } })
    expect(t.tasks[0]!.due).toMatch(/1:30 AM/)
  })
  test("attention: the FR-M1-79 feed in the API's order, with links to the task or report", () => {
    const a = toAttention({
      items: [
        { kind: "overdue", ref: "TSK-1001", taskId: TASK, reportId: null, reportKey: null, title: "Check fire exits", ownerId: ME, owner: "Ann Byrne", dueAt: "2026-10-24T10:00:00.000Z", reason: "Overdue by 1 day" },
        { kind: "report_missing", ref: null, taskId: null, reportId: null, reportKey: `${ME}:p:2026-10-24`, title: "Night report", ownerId: ME, owner: "Ann Byrne", dueAt: "2026-10-25T07:00:00.000Z", reason: "Not submitted" },
        { kind: "report_returned", ref: null, taskId: null, reportId: RID, reportKey: null, title: "Night report", ownerId: ME, owner: "Ann Byrne", dueAt: "2026-10-25T07:00:00.000Z", reason: "Returned" },
      ],
      total: 9, nextCursor: null,
    })
    expect(a.total).toBe(9)
    expect(a.items.map((i) => i.href)).toEqual(["/tasks/TSK-1001", `/daily-reports/${encodeURIComponent(`${ME}:p:2026-10-24`)}`, `/daily-reports/${RID}`])
    expect(a.items.map((i) => i.status.label)).toEqual(["Overdue", "Missing report", "Returned"])
    expect(a.items[0]).toMatchObject({ by: "Ann Byrne", note: "Overdue by 1 day", icon: expect.any(String), kind: "red" })
  })
})

describe("Today", () => {
  test("toToday: the working-day key is the DTO's, counts and order are the server's", () => {
    const t = toToday(todayDto(), { meId: ME, tz: TZ, nowAt: "2026-10-25T05:00:00.000Z", now: "2026-10-25T05:00:00", tzLabel: "Irish time", mode: "card" })
    expect(t.day).toEqual({ key: "2026-10-24", startsAt: "2026-10-24T22:00", hasShift: true })
    expect(t.counts).toEqual({ overdue: 1, dueToday: 2, high: 1, review: 0, reports: 1, blocked: 0 })
    expect(t.order[0]).toMatchObject({ group: "overdue", reason: "overdue by 1 day; high priority", task: { id: TASK, ref: "TSK-1001", priority: 3, due: "2026-10-25T03:00", evidenceRequired: false, project: "Security" } })
    expect(t.summary.spoken).toBe("Today you have 1 overdue.")
    expect(t.team).toBeUndefined()
    expect(t.mode).toBe("card")
  })
  test("the manager's team line maps", () => {
    const t = toToday(todayDto({ team: { count: 2, items: [{ ref: "TSK-5", title: "x", who: "Ann Byrne", reason: "overdue" }] }, counts: { overdue: 0, dueToday: 0, high: 0, review: 3, reports: 2, blocked: 0 } }), { meId: MGR, tz: TZ, nowAt: "2026-10-25T05:00:00.000Z", now: "2026-10-25T05:00:00", tzLabel: "x", mode: "chip" })
    expect(t.team).toEqual({ count: 2, items: [{ ref: "TSK-5", title: "x", who: "Ann Byrne", reason: "overdue" }] })
  })
  test("Mark done sends ONE update with dayKey = workingDay.key; a double tap is one request", async () => {
    let release: (v: unknown) => void = () => {}
    const posts: unknown[] = []
    const api = { get: async () => ({}), put: async () => ({}), patch: async () => ({}), delete: async () => ({}), post: (_p: string, o: unknown) => new Promise((res) => (posts.push(o), (release = res))) }
    const c = makeTodayClient(api as never)
    const a = c.update(TASK, "done", "2026-10-24")
    const b = c.update(TASK, "done", "2026-10-24")
    expect(posts).toEqual([{ body: { taskId: TASK, action: "done", dayKey: "2026-10-24" } }])
    release({ result: "applied", status: "completed", evidenceStillNeeded: false })
    expect(await a).toMatchObject({ kind: "done" })
    expect(await b).toMatchObject({ kind: "done" })
  })
  test("an 'evidence still needed' answer shows the proof prompt and is NOT a completed task", async () => {
    const api = fakeApi({ "POST /v1/today/updates": { result: "applied", status: "in_progress", evidenceStillNeeded: true } })
    expect(await makeTodayClient(api.client).update(TASK, "done", "2026-10-24")).toEqual({ kind: "needs_evidence" })
  })
  test("422 invalid_day_key asks for a refetch; a duplicate and an archived task are reported, not thrown", async () => {
    const stale = fakeApi({ "POST /v1/today/updates": problem(422, "invalid_day_key") })
    expect(await makeTodayClient(stale.client).update(TASK, "done", "2026-10-23")).toEqual({ kind: "stale_day" })
    const dup = fakeApi({ "POST /v1/today/updates": { result: "duplicate", status: "completed", evidenceStillNeeded: false } })
    expect(await makeTodayClient(dup.client).update(TASK, "done", "2026-10-24")).toEqual({ kind: "duplicate" })
    const arch = fakeApi({ "POST /v1/today/updates": { result: "skipped_archived", status: "completed", evidenceStillNeeded: false } })
    expect(await makeTodayClient(arch.client).update(TASK, "snooze", "2026-10-24")).toEqual({ kind: "archived" })
  })
  test("snooze sends the snooze action and nothing else changes", async () => {
    const api = fakeApi({ "POST /v1/today/updates": { result: "applied", status: "in_progress", evidenceStillNeeded: false } })
    expect(await makeTodayClient(api.client).update(TASK, "snooze", "2026-10-24")).toEqual({ kind: "snoozed" })
    expect(api.calls[0]!.body).toEqual({ taskId: TASK, action: "snooze", dayKey: "2026-10-24" })
  })
  test("any other refusal is thrown for userMessage; a support session's 403 is the restricted state", async () => {
    const api = fakeApi({ "POST /v1/today/updates": problem(403, "human_required") })
    const e = await makeTodayClient(api.client).update(TASK, "done", "2026-10-24").catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(userMessage(e).text).toMatch(/person/i)
    void vi
  })
  test("a Today refetch for the other mode asks for that mode", async () => {
    const api = fakeApi({ "GET /v1/today": todayDto() })
    await makeTodayClient(api.client).load("high-and-overdue")
    expect(api.calls[0]!.query).toEqual({ mode: "high-and-overdue" })
    void TEAM
  })
})
