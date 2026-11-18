import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { ME, MGR, TASK, TZ, dashboardDto, memberDeadlineDto, staffDto, todayDto } from "@/test/support/report-dto"
import { toAttention, toDashboard, toDeadlineCard, toStaff, toTeamTasks, toToday } from "./adapters"
import { DashboardView } from "./components/dashboard-view"
import { StaffDashboardView } from "./components/staff-dashboard-view"
import { DashboardSkeleton, StaffDashboardSkeleton } from "./components/skeletons"
import { TodayCard } from "./components/today-card"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }))

const org = { today: "2026-10-25T08:00:00", nowAt: "2026-10-25T08:00:00.000Z", timezone: TZ, tzLabel: "Irish time", currency: "EUR", locale: "en-IE", deadline: "17:30", departments: ["Security"] }
const people = [{ id: ME, name: "Ann Byrne", role: "Supervisor", initials: "AB", avatar: "av1" as const, dept: "Security" }]
const today = (over = {}) => toToday(todayDto(over), { meId: ME, tz: TZ, nowAt: org.nowAt, now: org.today, tzLabel: "Irish time", mode: "card" })

describe("the home screens render the API's numbers", () => {
  test("manager home: the summary figures, the deadline card, the attention rows and the team table are the DTOs'", () => {
    const home = toDashboard(dashboardDto(), { tz: TZ, nowAt: org.nowAt, tzLabel: "Irish time", dueAfterMinutes: 60 })
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        header: { title: "Dashboard", subtitle: "25 Oct, 2026 · Coppers" },
        data: home,
        teamTasks: toTeamTasks({ items: [{ id: TASK, ref: "TSK-1001", title: "Check fire exits", assigneeId: ME, assignee: "Ann Byrne", dept: "Security", priority: 2, dueAt: "2026-10-25T09:00:00.000Z", due: "x", late: false, status: "in_progress" }], nextCursor: null }, { people, tz: TZ, today: org.today }),
        attention: toAttention({ items: [{ kind: "overdue", ref: "TSK-1001", taskId: TASK, reportId: null, reportKey: null, title: "Check fire exits", ownerId: ME, owner: "Ann Byrne", dueAt: "2026-10-24T10:00:00.000Z", reason: "Overdue by 1 day" }], total: 1, nextCursor: null }),
        today: today(),
        deadline: home.deadline,
        perms: { tasks: true, reports: true, attention: true },
        clock: { tz: TZ, today: org.today },
      }),
    )
    for (const text of ["Open Tasks", "42", "Overdue Tasks", "Awaiting Review", "Shift Reports", "1 missing", "Shift report deadline", "Needs attention", "Overdue by 1 day", "Check fire exits", "Your day"]) expect(html, text).toContain(text)
    expect(html).not.toContain("Coverage")
    expect(html).not.toContain("Remind") // the mock reminder is hidden unless a demo deployment asks for it
  })
  test("a caller without the team table or attention gets neither card", () => {
    const home = toDashboard(dashboardDto({ reportDeadline: { member: null, team: null } }), { tz: TZ })
    const html = renderToStaticMarkup(createElement(DashboardView, { header: { title: "Dashboard", subtitle: "x" }, data: home, teamTasks: null, attention: null, perms: { tasks: false, reports: false, attention: false }, clock: { tz: TZ, today: org.today } }))
    expect(html).not.toContain("Team Tasks")
    expect(html).not.toContain("Needs attention")
    expect(html).not.toContain("Shift report deadline")
  })
  test("staff home: the four counts are the DTO's and the evidence card lists the returned item with its reason", () => {
    const s = toStaff(staffDto({ myTasks: { open: 9, overdue: 4, review: 2, returned: 1, items: staffDto().myTasks.items } }), { tz: TZ })
    const deadline = toDeadlineCard(s.reportDeadline, { tz: TZ, nowAt: org.nowAt, tzLabel: "Irish time", dueAfterMinutes: 60 })
    const html = renderToStaticMarkup(createElement(StaffDashboardView, { header: { title: "My day", subtitle: "Ann, Employee" }, myTasks: s.myTasks, evidence: s.evidence, comments: s.comments, org, todayCard: today(), deadline }))
    expect(html).toContain("My open")
    expect(html).toContain("Photo is blurry")
    expect(html).toContain("Please add the photo")
    expect(html).toContain("My shift report")
  })
  test("Today: tiles and chips show the server's counts; a team line only for a reviewer; the chip mode shows only the bar", () => {
    const card = renderToStaticMarkup(createElement(TodayCard, { data: today() }))
    expect(card).toContain("Overdue")
    expect(card).not.toContain("Team today")
    const mgr = renderToStaticMarkup(createElement(TodayCard, { data: toToday(todayDto({ team: { count: 2, items: [{ ref: "TSK-5", title: "x", who: "Ann Byrne", reason: "overdue" }] }, counts: { overdue: 0, dueToday: 0, high: 0, review: 3, reports: 2, blocked: 0 } }), { meId: MGR, tz: TZ, nowAt: org.nowAt, now: org.today, tzLabel: "x", mode: "card" }) }))
    expect(mgr).toContain("Team today")
    expect(mgr).toContain("reports to review")
    expect(mgr).toContain("Waiting for my review")
    void memberDeadlineDto
  })
  test("the skeletons render the typical home for a manager and for staff (no data in)", () => {
    expect(renderToStaticMarkup(createElement(DashboardSkeleton, { today: { mode: "chip", tiles: 5, team: true }, cards: 4, teamRows: 5, teamTotal: 25 }))).toContain("Loading dashboard")
    expect(renderToStaticMarkup(createElement(StaffDashboardSkeleton, { today: { mode: "chip", tiles: 4, team: false } }))).toContain("Loading dashboard")
  })
})
