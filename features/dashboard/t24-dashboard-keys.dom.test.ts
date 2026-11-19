// @vitest-environment jsdom
// The e2e walk spec failed on "Each child in a list should have a unique key prop ... top-level render call using <DashboardBody>" in about 7 of 12 runs. Cause: the page's `middle` row
// is a server element that reaches this client component as a streamed chunk (a lazy node) when it has not arrived yet at render time. A lazy child is not an element when React marks the
// static children of DashboardBody as keyed, and the element it later resolves to has no key, so the reconciler warns. A keyed wrapper around the slot makes the warning impossible.
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children) }
})
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: { get: vi.fn() } }))

import { DeptContext } from "@/hooks/use-dept"
import { TZ, dashboardDto } from "@/test/support/report-dto"
import { toDashboard } from "./adapters"
import { DashboardBody } from "./components/dashboard-body"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IO
})
let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
})

const NOW_AT = "2026-10-25T08:00:00.000Z"
const clock = { tz: TZ, today: "2026-10-25T08:00:00", nowAt: NOW_AT, tzLabel: "Irish time", dueAfterMinutes: 60 }

describe("DashboardBody keys", () => {
  test("a streamed (lazy) middle row raises no missing-key warning", async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")) })
    // what Flight hands a client component for a chunk it has already revived from the stream: a lazy node resolving to a keyless element
    const lazy = { $$typeof: Symbol.for("react.lazy"), _payload: createElement("section", { id: "mid" }, "row"), _init: (p: unknown) => p }
    const home = toDashboard(dashboardDto(), { tz: TZ, nowAt: NOW_AT, tzLabel: "Irish time", dueAfterMinutes: 60 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(DeptContext.Provider, { value: "all" }, createElement(DashboardBody, { data: home, teamTasks: null, departments: [], clock, canRemind: false, middle: lazy as never }))))
    spy.mockRestore()
    expect(document.querySelector("#mid")).not.toBeNull()
    expect(errors.filter((e) => /unique "key" prop/.test(e))).toEqual([])
  })
})
