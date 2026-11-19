// @vitest-environment jsdom
// B8 Task 24: the console's tenants table (MRR, health, usage), the data-request Resolve dialog and the platform bell, on the B8 T17 API.
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), refresh: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push() {} }), usePathname: () => "/platform/tenants", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children) }
})
vi.mock("sonner", () => ({ toast: m.toast }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: { get: m.get, post: m.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))

import { toDataRequests, toTenantList } from "./adapters"
import { LiveDataRequests } from "./components/live-data-requests"
import { LiveTenantsSkeleton } from "./components/live-skeletons"
import { LiveTenants } from "./components/live-tenants"
import { NotificationsPanel } from "@/features/shell/components/notifications-panel"
import { toPlatformBell } from "@/lib/platform-bell"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  Element.prototype.scrollIntoView ??= () => {}
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" })
})
let root: Root | null = null
beforeEach(() => { for (const f of [m.get, m.post, m.refresh, m.toast.success, m.toast.error]) f.mockReset() })
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
})
async function mount(el: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) })
const click = async (el: Element) => { await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await flush() }
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")

const at = "2026-11-01T09:00:00.000Z"
const tenant = (over: Record<string, unknown>) => ({
  id: "t1", slug: "coppers", name: "Coppers", status: "active", createdAt: at, planId: "business", subscriptionStatus: "active", seats: 25, mrrCents: 14900, currency: "EUR", health: "green",
  usage: { seats: 12, activeUsers30d: 9, storageBytes: 48_211_234 }, ...over,
})
const list = toTenantList({
  items: [
    tenant({}),
    // a trial already over while still trialing (AH3): the API says amber; MRR 0 for a trial
    tenant({ id: "t2", slug: "harbour", name: "Harbourline", planId: "starter", subscriptionStatus: "trialing", mrrCents: 0, health: "amber", usage: { seats: 3, activeUsers30d: 0, storageBytes: 0 } }),
    // suspended (AH3): red; a USD plan formats with its own currency
    tenant({ id: "t3", slug: "dock", name: "Dockside", status: "suspended", mrrCents: 990050, currency: "USD", health: "red", usage: { seats: 26, activeUsers30d: 20, storageBytes: 1_395_864_371 } }),
  ],
  page: 1, pageSize: 100, total: 3,
} as never)

describe("B8 Task 24: console tenants table", () => {
  test("console tenants table shows MRR (formatted with the plan currency), health pill, usage numbers; the skeleton row matches", async () => {
    await mount(createElement(LiveTenants, { data: list, view: "all", q: "", can: { suspend: true, support: true, revenue: true } }))
    const t = text()
    for (const s of ["€149", "$9,900.50", "Healthy", "Watch", "At risk", "12 / 25", "26 / 25", "46 MB", "1.3 GB", "0 B"]) expect(t, s).toContain(s)
    const row = (name: string) => [...document.querySelectorAll("tbody tr")].find((r) => r.textContent?.includes(name))!
    expect(row("Harbourline").querySelector('[data-label="MRR"]')!.textContent).toBe("—") // 0 for a trial
    expect(row("Harbourline").querySelector('[data-label="Health"] .st')?.className).toMatch(/warn/)
    expect(row("Dockside").querySelector('[data-label="Health"] .st')?.className).toMatch(/bad/)
    expect(row("Dockside").querySelector(".pf-seat")?.getAttribute("data-state")).toBe("over")
    expect(row("Coppers").querySelector('[data-label="Active 30d"]')!.textContent).toBe("9")
    const realHead = [...document.querySelectorAll("thead th")].map((th) => th.textContent)
    const realCells = [...row("Coppers").querySelectorAll("td")].map((td) => td.getAttribute("data-label"))
    await act(async () => root!.unmount())
    document.body.innerHTML = ""
    // the loading state is the same table, masked: same columns and the same cells per row
    await mount(createElement(LiveTenantsSkeleton))
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(realHead)
    expect([...document.querySelectorAll("tbody tr")[0]!.querySelectorAll("td")].map((td) => td.getAttribute("data-label"))).toEqual(realCells)
  })

  test("without billing.read there is no MRR column", async () => {
    await mount(createElement(LiveTenants, { data: list, view: "all", q: "", can: { suspend: false, support: false } }))
    expect(text()).not.toContain("MRR")
    expect(text()).not.toContain("€149")
    expect(text()).toContain("Healthy")
  })
})

const requests = toDataRequests({
  items: [
    { id: "d1", tenantId: "t1", tenantName: "Coppers", kind: "erase", status: "running", createdAt: at, dueAt: at, overdue: false },
    { id: "d2", tenantId: "t2", tenantName: "Harbourline", kind: "export", status: "failed", createdAt: at, dueAt: at, overdue: true },
    { id: "d3", tenantId: "t3", tenantName: "Dockside", kind: "export", status: "pending", createdAt: at, dueAt: at, overdue: false },
  ],
  page: 1, pageSize: 100, total: 3,
} as never)

describe("B8 Task 24: data request Resolve", () => {
  test("data request Resolve dialog requires an outcome and a note and updates the row", async () => {
    await mount(createElement(LiveDataRequests, { data: requests, canResolve: true }))
    // running and failed can be resolved; pending is picked up by its job
    expect(document.querySelector('[aria-label="Resolve Erase request of Coppers"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Resolve Export request of Harbourline"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Resolve Export request of Dockside"]')).toBeNull()
    await click(document.querySelector('[aria-label="Resolve Erase request of Coppers"]')!)
    const confirm = () => document.querySelector<HTMLButtonElement>(".od-confirm-btn")!
    expect(confirm().disabled).toBe(true) // nothing chosen
    await click([...document.querySelectorAll("button")].find((b) => b.textContent === "Completed")!)
    expect(confirm().disabled).toBe(true) // the note is required too
    const note = document.getElementById("pf-dsr-note") as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "   ")
      note.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(confirm().disabled).toBe(true) // blank is not a note
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, " Erased by hand with the controller ")
      note.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(confirm().disabled).toBe(false)
    m.post.mockResolvedValueOnce({ id: "d1", tenantId: "t1", kind: "erase", status: "completed", completedAt: at })
    await click(confirm())
    expect(m.post).toHaveBeenCalledWith("/v1/platform/data-requests/{id}/resolve", { path: { id: "d1" }, body: { outcome: "completed", note: "Erased by hand with the controller" } })
    const row = [...document.querySelectorAll("tbody tr")].find((r) => r.textContent?.includes("Coppers"))!
    expect(row.querySelector(".st")!.textContent).toContain("Completed")
    expect(row.querySelector('[aria-label^="Resolve"]')).toBeNull()
  })

  test("a viewer (no resolve) sees no Resolve control", async () => {
    await mount(createElement(LiveDataRequests, { data: requests }))
    expect(document.querySelector('[aria-label^="Resolve"]')).toBeNull()
  })
})

const feed = {
  items: [
    { kind: "data_request", tenantId: "t1", tenantName: "Coppers", refId: "d1", at: "2026-11-19T09:00:00.000Z", until: "2026-12-01T00:00:00.000Z" },
    { kind: "failed_payment", tenantId: "t3", tenantName: "Dockside", refId: null, at: "2026-11-18T09:00:00.000Z", until: null },
    { kind: "trial_ending", tenantId: "t2", tenantName: "Harbourline", refId: null, at: "2026-11-10T09:00:00.000Z", until: "2026-11-17T09:00:00.000Z" },
  ],
  unread: 2,
}

describe("B8 Task 24: the platform bell", () => {
  test("toPlatformBell: the newest `unread` items are unread; links go to the console pages; names and dates only", () => {
    const b = toPlatformBell(feed as never)
    expect(b.items.map((i) => [i.read, i.href])).toEqual([[false, "/platform/data-requests"], [false, "/platform/tenants/t3"], [true, "/platform/tenants/t2"]])
    expect(b.items[0]!.title).toBe("Data request waiting · Coppers")
  })

  test("platform bell shows unread, opens the feed and Mark seen clears it; non-staff never renders it", async () => {
    m.get.mockResolvedValue(feed)
    await mount(createElement(NotificationsPanel, { items: [], today: "2026-11-19T10:00:00", tzLabel: "UTC", scope: "platform:s1", platform: true }))
    await flush()
    expect(m.get).toHaveBeenCalledWith("/v1/platform/notifications")
    const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]')!
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 2 unread")
    await click(bell)
    expect(text()).toContain("Data request waiting · Coppers")
    expect(text()).toContain("Payment failed · Dockside")
    m.post.mockResolvedValueOnce({ seenAt: "2026-11-19T10:00:00.000Z", unread: 0 })
    m.get.mockResolvedValue({ ...feed, unread: 0 })
    await click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Mark seen")!)
    expect(m.post).toHaveBeenCalledWith("/v1/platform/notifications/seen")
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) }) // the dots clear in a short cascade
    expect(document.querySelector('button[aria-label^="Notifications"]')!.getAttribute("aria-label")).toBe("Notifications")
  })

  test("a poll already in flight when Mark seen is clicked never brings the old unread count back", async () => {
    m.get.mockResolvedValueOnce(feed)
    await mount(createElement(NotificationsPanel, { items: [], today: "2026-11-19T10:00:00", tzLabel: "UTC", scope: "platform:s1", platform: true }))
    await flush()
    const badge = () => document.querySelector('button[aria-label^="Notifications"]')!.getAttribute("aria-label")
    expect(badge()).toBe("Notifications, 2 unread")
    // the next poll starts (the tab comes back into view) and its answer, read before "seen", is still on the wire
    let answer!: (v: unknown) => void
    m.get.mockImplementationOnce(() => new Promise((r) => { answer = r }))
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    expect(m.get).toHaveBeenCalledTimes(2)
    await click(document.querySelector('button[aria-label^="Notifications"]')!)
    m.post.mockResolvedValueOnce({ seenAt: "2026-11-19T10:00:00.000Z", unread: 0 })
    m.get.mockResolvedValue({ ...feed, unread: 0 })
    await click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Mark seen")!)
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(badge()).toBe("Notifications")
    // the stale answer lands last: it is dropped
    await act(async () => answer(feed))
    await flush()
    expect(badge()).toBe("Notifications")
  })

  test("a refused Mark seen puts the badge back with the app's copy", async () => {
    m.get.mockResolvedValue(feed)
    await mount(createElement(NotificationsPanel, { items: [], today: "2026-11-19T10:00:00", tzLabel: "UTC", scope: "platform:s1", platform: true }))
    await flush()
    await click(document.querySelector('button[aria-label^="Notifications"]')!)
    const { ApiError } = await import("@/lib/api/problem")
    m.post.mockRejectedValueOnce(new ApiError(401, "mfa_challenge", "r1"))
    await click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Mark seen")!)
    expect(m.toast.error).toHaveBeenCalled()
    expect(document.querySelector('button[aria-label^="Notifications"]')!.getAttribute("aria-label")).toBe("Notifications, 2 unread")
  })

  test("the console layout gives the API bell to active staff past their second factor only, and no bell at all to anyone else", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync(`${process.cwd()}/app/(platform)/layout.tsx`, "utf8")
    expect(src).toMatch(/bell=\{op && mfaOk \? "platform" : "none"\}/)
    const shell = readFileSync(`${process.cwd()}/features/shell/components/app-shell.tsx`, "utf8")
    expect(shell).toMatch(/bell !== "none" && <NotificationsPanel/)
  })
})
