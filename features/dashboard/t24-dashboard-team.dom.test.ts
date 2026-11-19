// @vitest-environment jsdom
// B8 Task 24: the topbar department narrows the manager dashboard on the SERVER: GET /v1/dashboard and /v1/dashboard/team-tasks with `teamId` (filed under the team or assigned to its
// members, ruling S8). The summary, progress, closed chart, deadline rows and the team table are that answer; nothing is re-cut on the client.
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({ get: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children) }
})
vi.mock("sonner", () => ({ toast: m.toast }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: { get: m.get } }))

import { DeptContext } from "@/hooks/use-dept"
import { ME, TASK, TEAM, TZ, dashboardDto } from "@/test/support/report-dto"
import { toDashboard, toTeamTasks } from "./adapters"
import { DashboardView } from "./components/dashboard-view"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IO
})
let root: Root | null = null
beforeEach(() => m.get.mockReset())
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
})
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) })

const NOW_AT = "2026-10-25T08:00:00.000Z"
const clock = { tz: TZ, today: "2026-10-25T08:00:00", nowAt: NOW_AT, tzLabel: "Irish time", dueAfterMinutes: 60 }
const departments = [{ id: TEAM, name: "Security" }, { id: "team-cle", name: "Cleaning" }]
const row = (n: number, dept: string) => ({ id: `${TASK.slice(0, -2)}${String(n).padStart(2, "0")}`, ref: `TSK-${n}`, title: `Task ${n}`, assigneeId: ME, assignee: "Ann Byrne", dept, priority: 2, dueAt: "2026-10-25T09:00:00.000Z", due: "x", late: false, status: "in_progress" })
const allTeam = { items: [row(1, "Security"), row(2, "Cleaning"), row(3, "Cleaning"), row(4, "Security")], nextCursor: null }
// the Security answer: 3 open tasks (one filed under Cleaning but assigned to a Security member, S8), and its table holds exactly those 3
const secDash = dashboardDto({
  summary: { open: 3, overdue: 1, dueToday: 1, completedToday: 2, trend: [1, 0, 2, 1, 0, 1, 2], awaitingReview: 1, evidencePending: 0 },
  progress: { total: 5, percent: 40, mix: { not_started: 1, in_progress: 2, blocked: 0, submitted: 0, changes_requested: 0, completed: 2, cancelled: 0 } },
  teams: [{ teamId: TEAM, team: "Security", open: 3, overdue: 1, people: 2 }],
})
const secTeam = { items: [row(1, "Security"), row(3, "Cleaning"), row(4, "Security")], nextCursor: null }

async function mount(dept: string) {
  const home = toDashboard(dashboardDto(), { tz: TZ, nowAt: NOW_AT, tzLabel: "Irish time", dueAfterMinutes: 60 })
  const el = (d: string) =>
    createElement(DeptContext.Provider, { value: d }, createElement(DashboardView, {
      header: { title: "Dashboard", subtitle: "x" }, data: home, teamTasks: toTeamTasks(allTeam, { people: [], tz: TZ, today: clock.today }), attention: null, deadline: home.deadline,
      perms: { tasks: true, reports: true, attention: true }, clock, departments,
    }))
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el(dept)))
  await flush()
  return async (d: string) => {
    await act(async () => root!.render(el(d)))
    await flush()
  }
}
const stat = (title: string) => [...document.querySelectorAll(".stat")].find((s) => s.querySelector("h3")?.textContent === title)?.querySelector(".value")?.getAttribute("aria-label") ?? [...document.querySelectorAll(".stat")].find((s) => s.querySelector("h3")?.textContent === title)?.querySelector(".value")?.textContent
const tableRefs = () => [...document.querySelectorAll("table tbody tr")].map((r) => r.querySelector(".tm.num")?.textContent)

describe("B8 Task 24: dashboard department filter", () => {
  test("dashboard department filter sends teamId and totals reconcile", async () => {
    m.get.mockImplementation(async (p: string) => (p === "/v1/dashboard" ? secDash : secTeam))
    const set = await mount("Security")
    expect(m.get).toHaveBeenCalledWith("/v1/dashboard", { query: { teamId: TEAM } })
    expect(m.get).toHaveBeenCalledWith("/v1/dashboard/team-tasks", { query: { limit: 25, teamId: TEAM } })
    // the open figure and the team table are the same server cut: 3 and 3 (TSK-3, filed under Cleaning, is assigned to a Security member)
    expect(String(stat("Open Tasks"))).toContain("3")
    expect(tableRefs().sort()).toEqual(["TSK-1", "TSK-3", "TSK-4"])
    expect(tableRefs()).toHaveLength(secDash.summary.open)
    // back to all departments: the server's first answer again, no call
    m.get.mockClear()
    await set("all")
    expect(m.get).not.toHaveBeenCalled()
    expect(String(stat("Open Tasks"))).toContain("42")
    expect(tableRefs()).toHaveLength(4)
  })

  test("the table's next page keeps the teamId; the client-side department cuts are deleted", async () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, "components", f), "utf8")
    expect(src("team-tasks-table.tsx")).not.toMatch(/t\.dept === dep/)
    expect(src("section-cards.tsx")).not.toMatch(/byDept/)
    expect(src("report-deadline-card.tsx")).not.toMatch(/r\.key === dep/)
    expect(src("team-tasks-table.tsx")).toMatch(/teamId/)
  })
})
