// @vitest-environment jsdom
// B8 Task 24: the calendar's department filter is the API's `teamId` (filed under the team or assigned to its members, ruling S8); the client-side department filter is gone.
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({ get: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/tasks/calendar", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children) }
})
vi.mock("sonner", () => ({ toast: m.toast }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: { get: m.get } }))

import { DeptContext } from "@/hooks/use-dept"
import { toCard } from "./adapters"
import { TaskCalendar, rangeOf } from "./components/task-calendar"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
})
let root: Root | null = null
beforeEach(() => m.get.mockReset())
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
})
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) })

const TODAY = "2026-11-19T10:00:00"
const range = rangeOf("2026-11-19", "month")
const card = (id: string, title: string, dept: string, teamId: string | null) => ({
  id, ref: `TSK-${id}`, version: 1, title, dept, teamId, assignee: "u1", assignees: ["u1"], creator: "u9", priority: 2, start: "2026-11-19T08:00:00", due: "2026-11-20T09:00:00",
  startAt: "2026-11-19T08:00:00.000Z", dueAt: "2026-11-20T09:00:00.000Z", status: "in_progress", tags: [], parentId: null,
})
// a task FILED under Cleaning but assigned to a Security member: the server counts it for Security (S8); a client filter on `dept` would have dropped it
const all = [card("1", "Mop the lobby", "Cleaning", "c"), card("2", "Patrol car park", "Security", "s"), card("3", "Cover the gate", "Cleaning", "c")]
const departments = [{ id: "team-sec", name: "Security" }, { id: "team-cle", name: "Cleaning" }]
const dayOf = (cards: unknown[]) => ({ days: [{ date: "2026-11-20", tasks: cards }], truncated: false })

async function mount(dept: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  const el = (d: string) => createElement(DeptContext.Provider, { value: d }, createElement(TaskCalendar, { tasks: all.map(toCard), truncated: false, range, people: [], projects: [], today: TODAY, tzLabel: "GMT", staff: false, departments }))
  await act(async () => root!.render(el(dept)))
  await flush()
  return async (d: string) => {
    await act(async () => root!.render(el(d)))
    await flush()
  }
}
const titles = () => [...document.querySelectorAll(".cal-chip")].map((c) => c.textContent?.replace(/^\S+\s/, "").trim())

describe("B8 Task 24: calendar team filter", () => {
  test("calendar team filter sends teamId and the list shrinks server-side (the client department filter code is deleted)", async () => {
    m.get.mockResolvedValueOnce(dayOf([all[1], all[2]]))
    const set = await mount("Security")
    expect(m.get).toHaveBeenCalledWith("/v1/tasks/calendar", { query: { from: range.from, to: range.to, teamId: "team-sec" } })
    expect(titles().sort()).toEqual(["Cover the gate", "Patrol car park"]) // the server's answer, including the Cleaning-filed task assigned to Security
    expect(document.body.textContent).toContain("2 tasks by due date")
    // back to all departments: the whole window again (asked once more, without teamId)
    m.get.mockResolvedValueOnce(dayOf(all))
    await set("all")
    expect(m.get).toHaveBeenLastCalledWith("/v1/tasks/calendar", { query: { from: range.from, to: range.to } })
    expect(titles()).toHaveLength(3)
    const src = readFileSync(path.resolve(__dirname, "components/task-calendar.tsx"), "utf8")
    expect(src).not.toMatch(/t\.dept === dept|\.dept === dep\b/)
  })

  test("all departments uses the server's first answer (no extra call); a department no team has shows nothing and asks nothing", async () => {
    const set = await mount("all")
    expect(m.get).not.toHaveBeenCalled()
    expect(titles()).toHaveLength(3)
    await set("Kitchen")
    expect(m.get).not.toHaveBeenCalled()
    expect(titles()).toEqual([])
  })
})
