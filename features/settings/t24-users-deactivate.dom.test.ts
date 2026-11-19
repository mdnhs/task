// @vitest-environment jsdom
// B8 Task 24: Settings -> Users deactivates and reactivates through the API (POST /v1/members/{id}/deactivate|reactivate) and shows the API's last active (null = "Never").
// The L3 mock-flag gate is gone: no demo columns, no mock seed.
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push() {} }), usePathname: () => "/settings/users", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children) }
})
vi.mock("sonner", () => ({ toast: m.toast }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: { post: m.post, get: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } }))

import { ApiError } from "@/lib/api/problem"
import { toUsers } from "./adapters"
import { UsersPanel } from "./components/users-panel"
import type { SettingsUser } from "./types"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
})
let root: Root | null = null
beforeEach(() => { m.post.mockReset(); m.refresh.mockReset(); m.toast.error.mockReset(); m.toast.success.mockReset() })
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
})
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) })
const click = async (el: Element) => { await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await flush() }
const btn = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const users: SettingsUser[] = [
  { id: "u-own", name: "Olive Owner", email: "olive@x.test", role: "owner", dept: "", active: true, lastActiveAt: "2026-11-18T09:00:00" },
  { id: "u-ann", name: "Ann Byrne", email: "ann@x.test", role: "employee", dept: "Cleaning", active: true, lastActiveAt: null },
  { id: "u-bob", name: "Bob Lee", email: "bob@x.test", role: "employee", dept: "Cleaning", active: false, lastActiveAt: "2026-11-01T08:00:00" },
  { id: "u-me", name: "Me Admin", email: "me@x.test", role: "admin", dept: "", active: true, lastActiveAt: "2026-11-19T08:00:00" },
]
const roles = [{ id: "owner", uuid: "r1", label: "Tenant Owner", access: {} as never, locked: true }, { id: "employee", uuid: "r2", label: "Employee", access: {} as never, locked: false }, { id: "admin", uuid: "r3", label: "Admin", access: {} as never, locked: false }]
async function mount(over: Partial<Parameters<typeof UsersPanel>[0]> = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(UsersPanel, { users, invites: [], roles, today: "2026-11-19T10:00:00", tzLabel: "GMT", seatLimit: 10, seatsUsed: 3, planName: "Business", canWrite: true, meId: "u-me", ...over })))
}

describe("B8 Task 24: users panel deactivate and last active", () => {
  test("users panel: Deactivate asks to confirm, the last owner's control is disabled with the API's 422 mapped, last active shows \"Never\" for null", async () => {
    await mount()
    const text = document.body.textContent ?? ""
    expect(text).toContain("Never") // Ann has never been seen
    expect(text).toContain("Deactivated") // Bob
    // the last active owner and myself cannot be deactivated
    expect(btn("Deactivate Olive Owner")!.disabled).toBe(true)
    expect(btn("Deactivate Olive Owner")!.title).toMatch(/last owner/i)
    expect(btn("Deactivate Me Admin")!.disabled).toBe(true)
    // Deactivate asks first; Cancel sends nothing
    await click(btn("Deactivate Ann Byrne")!)
    expect(document.body.textContent).toContain("Deactivate Ann Byrne?")
    expect(m.post).not.toHaveBeenCalled()
    m.post.mockResolvedValueOnce({ userId: "u-ann", status: "deactivated", deactivatedAt: "2026-11-19T10:00:00.000Z" })
    await click(document.querySelector(".od-confirm-btn")!)
    expect(m.post).toHaveBeenCalledWith("/v1/members/{userId}/deactivate", { path: { userId: "u-ann" } })
    expect(m.toast.success).toHaveBeenCalled()
    expect(btn("Reactivate Ann Byrne")).not.toBeNull() // the row shows the API's answer at once
    // Reactivate is one call (no confirm: nothing is lost)
    m.post.mockResolvedValueOnce({ userId: "u-bob", status: "active", deactivatedAt: null })
    await click(btn("Reactivate Bob Lee")!)
    expect(m.post).toHaveBeenLastCalledWith("/v1/members/{userId}/reactivate", { path: { userId: "u-bob" } })
  })

  test("a refusal maps to the app's copy (409 last_owner raced in another session, 422 self_deactivation), never the server's text, and the row stays active", async () => {
    await mount({ users: [users[0]!, { ...users[0]!, id: "u-own2", name: "Oscar Owner", email: "o2@x.test" }, users[3]!] })
    expect(btn("Deactivate Oscar Owner")!.disabled).toBe(false) // two active owners: either may go
    await click(btn("Deactivate Oscar Owner")!)
    m.post.mockRejectedValueOnce(new ApiError(409, "last_owner", "req-1"))
    await click(document.querySelector(".od-confirm-btn")!)
    expect(m.toast.error).toHaveBeenCalledWith("The last owner can't be removed.", expect.anything())
    expect(btn("Deactivate Oscar Owner")).not.toBeNull()
    await click(btn("Deactivate Olive Owner")!)
    m.post.mockRejectedValueOnce(new ApiError(422, "self_deactivation", "req-2"))
    await click(document.querySelector(".od-confirm-btn")!)
    expect(m.toast.error).toHaveBeenLastCalledWith("You can't deactivate yourself.", expect.anything())
  })

  test("read-only (no settings write): status and last active show, no actions", async () => {
    await mount({ canWrite: false })
    expect(document.body.textContent).toContain("Last active")
    expect(btn("Deactivate Ann Byrne")).toBeNull()
  })

  test("toUsers carries the API's status and last active (tenant wall time; null stays null); the mock seed and flag are gone", () => {
    const u = toUsers([{ userId: "u1", name: "Ada", email: "a@x.test", roleKey: "admin", status: "deactivated", lastActiveAt: "2026-11-18T09:00:00.000Z" }, { userId: "u2", name: "Ben", email: "b@x.test", roleKey: "employee", status: "active", lastActiveAt: null }], () => "", "Pacific/Auckland")
    expect(u.map((x) => [x.active, x.lastActiveAt])).toEqual([[false, "2026-11-18T22:00:00"], [true, null]])
    const root = path.resolve(__dirname, "../..")
    expect(readFileSync(path.join(root, "features/settings/components/users-panel.tsx"), "utf8")).not.toMatch(/mockActivity|Demo only/)
    expect(readFileSync(path.join(root, "app/(app)/settings/[tab]/page.tsx"), "utf8")).not.toMatch(/getMockUserActivity/)
  })
})
