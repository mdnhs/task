import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { minorOf, seatProblem } from "@/features/billing/adapters"
import { ApiError, userMessage } from "@/lib/api/problem"
import { bannerOf } from "@/lib/billing-state"
import { errorView } from "@/lib/error-view"
import { markAllGuarded, markGuarded } from "@/lib/notifications"

const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

describe("T6.4 carry-in 2: a failed bell mark is not silent", () => {
  const row = { id: "n1", kind: "billing", title: "t", link: null, createdAt: "2026-11-17T09:00:00.000Z", readAt: "2026-11-17T09:01:00.000Z" }
  test("markGuarded: success returns ok, failure returns the mapped copy once and never throws", async () => {
    const ok = fakeApi({ "POST /v1/notifications/{id}/read": row })
    expect(await markGuarded(ok.client, "n1", "UTC")).toEqual({ ok: true })
    const bad = fakeApi({ "POST /v1/notifications/{id}/read": problem(500, "boom") })
    const r = await markGuarded(bad.client, "n1", "UTC")
    expect(r).toEqual({ ok: false, text: "Something went wrong. Try again.", ref: "req-1" })
  })
  test("markAllGuarded: same contract", async () => {
    const ok = fakeApi({ "POST /v1/notifications/read-all": { updated: 2 } })
    expect(await markAllGuarded(ok.client)).toEqual({ ok: true })
    const bad = fakeApi({ "POST /v1/notifications/read-all": problem(402, "billing_required") })
    expect(await markAllGuarded(bad.client)).toMatchObject({ ok: false, text: "Billing needs attention. Read-only for now." })
  })
  test("the hook reverts its optimistic state and toasts on a failed mark", () => {
    const src = read("hooks/use-notifications.ts")
    expect(src).toMatch(/markGuarded/)
    expect(src).toMatch(/markAllGuarded/)
    expect(src).toMatch(/toast\.error/)
    expect(src).not.toMatch(/\.catch\(\(\) => undefined\)\.then/) // the old silent swallow
  })
})

describe("T6.4 carry-in 3: app/error.tsx and app/global-error.tsx", () => {
  test("errorView never shows a server message or a stack; it shows the mapped copy plus a ref", () => {
    expect(errorView(new ApiError(503, "upstream_unavailable", "req-9"))).toEqual({ text: "Something went wrong. Try again.", ref: "req-9" })
    expect(errorView(new ApiError(502, "x", ""))).toEqual({ text: "Something went wrong. Try again.", ref: null })
    expect(errorView(new TypeError("fetch failed: ECONNREFUSED 10.0.0.5:4000"))).toEqual({ text: "No connection. Try again.", ref: null })
    const server = Object.assign(new Error("password authentication failed for user app_user at db.internal:5432"), { digest: "d1g3st" })
    expect(errorView(server)).toEqual({ text: "Something went wrong. Try again.", ref: "d1g3st" })
    expect(errorView("a string")).toEqual({ text: "Something went wrong. Try again.", ref: null })
    expect(errorView(null).text).toBe("Something went wrong. Try again.")
    // a session problem on the way in is still the generic copy for the page, but keeps its own words
    expect(errorView(new ApiError(401, "session_expired", "r")).text).toBe("Session expired. Sign in again.")
  })

  test("app/error.tsx renders static themed markup with a Retry button, the ref and no stack", async () => {
    const mod = await import("@/app/error")
    const err = Object.assign(new Error("SELECT * FROM secrets /srv/api/db.ts:42"), { digest: "ref-123" })
    const html = renderToStaticMarkup(createElement(mod.default, { error: err, retry: vi.fn(), reset: vi.fn() }))
    expect(html).toContain("Something went wrong")
    expect(html).toContain("Try again")
    expect(html).toContain("ref-123")
    expect(html).not.toContain("SELECT")
    expect(html).not.toContain("/srv/api")
    expect(html).not.toMatch(/class="[^"]*\bsk\b/) // skeleton-free
    expect(html).toContain('type="button"')
  })

  test("the Retry button calls retry() (re-fetches the server render), and reset() when retry is absent", () => {
    const src = read("app/error.tsx")
    expect(src.startsWith('"use client"')).toBe(true)
    expect(src).toMatch(/retry/)
    expect(src).toMatch(/reset/)
    expect(src).not.toMatch(/error\.(message|stack)/)
  })

  test("global-error.tsx has its own html and body, inline theme, a Retry button and no message or stack", async () => {
    const src = read("app/global-error.tsx")
    expect(src.startsWith('"use client"')).toBe(true)
    expect(src).not.toMatch(/error\.(message|stack)/)
    const mod = await import("@/app/global-error")
    const html = renderToStaticMarkup(createElement(mod.default, { error: Object.assign(new Error("boom /srv/x"), { digest: "dg-1" }), retry: vi.fn(), reset: vi.fn() }))
    expect(html).toMatch(/^<html/)
    expect(html).toContain("<body")
    expect(html).toContain("Try again")
    expect(html).toContain("dg-1")
    expect(html).not.toContain("boom")
    expect(html).toContain("prefers-color-scheme") // follows the OS scheme: the app theme does not reach this document
  })

  test("a layout-level API failure (getSession or getOrg rejecting) reaches an error boundary: the (app) layout does not swallow it", () => {
    const layout = read("app/(app)/layout.tsx")
    expect(layout).not.toMatch(/catch\s*\(/) // it throws; app/error.tsx catches it
    expect(existsSync(path.join(root, "app/error.tsx"))).toBe(true)
  })
})

describe("T6.4 carry-in 4: seat_limit copy", () => {
  test("409 seat_limit has its own short message", () => {
    expect(userMessage(new ApiError(409, "seat_limit", "r1"))).toEqual({ text: "No seats left. Raise the plan's seats first.", ref: "r1" })
  })
})

describe("T6.4 carry-ins 5-7: seats, minorOf, empty plans", () => {
  test("seatProblem: whole number, at least the active members; the plan maximum is the API's call (422 seat_limit_exceeds_plan)", () => {
    expect(seatProblem("abc", 12)).toBe("Enter a whole number.")
    expect(seatProblem("", 12)).toBe("Enter a whole number.")
    expect(seatProblem("11", 12)).toBe("Seats can't be fewer than your active members.")
    expect(seatProblem("12", 12)).toBeUndefined()
    expect(seatProblem(" 400 ", 12)).toBeUndefined()
  })
  test("BillingView takes no seat limit from the static plans.json", () => {
    const src = read("features/billing/components/billing-view.tsx")
    expect(src).not.toMatch(/limits\.activeUsers\s*\?\?/)
    expect(src).not.toMatch(/seatN > seatLimit/)
  })
  test("minorOf rounds (49.99 -> 4999) and keeps whole amounts exact", () => {
    expect(minorOf(49.99, "EUR")).toBe(4999)
    expect(minorOf(19.9, "EUR")).toBe(1990)
    expect(minorOf(0.29, "EUR")).toBe(29)
    expect(minorOf(1.005, "JPY")).toBe(1)
    expect(minorOf(149, "EUR")).toBe(14900)
  })
  test("BillingView renders with an empty plan list (no crash, no Change plan button)", async () => {
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
    const { BillingView } = await import("@/features/billing/components/billing-view")
    const sub = { planId: "business", planName: "Business", priceMinor: 14900, currency: "EUR", status: "active" as const, seats: 40, seatsUsed: 12, trialEndsAt: null, currentPeriodEnd: "2026-12-17T00:00:00.000Z", cancelAtPeriodEnd: false, billingState: "ok" as const, graceEndsAt: null, hasProviderSubscription: false, hasCustomer: true }
    const html = renderToStaticMarkup(createElement(BillingView, { subscription: sub, plans: [], modules: [], invoices: [], invoicesMore: false, today: "2026-11-18T09:00:00", timezone: "Europe/Dublin", tzLabel: "Ireland Time", locale: "en-IE", canManage: true }))
    expect(html).toContain("Current plan")
    expect(html).not.toContain("Change plan")
    vi.doUnmock("next/navigation")
  })
})

describe("T6.4 carry-in 8: banner link and suspended copy", () => {
  const base = { status: "active" as const, billingState: "ok" as const, trialEndsAt: null, graceEndsAt: null, timezone: "Europe/Dublin", tzLabel: "Ireland Time" }
  test("a billing banner keeps its link for a billing user and drops it for anyone else", () => {
    expect(bannerOf({ ...base, billingState: "blocked", status: "suspended", canBilling: true })!.action).toEqual({ href: "/settings/billing", label: "Reactivate" })
    const b = bannerOf({ ...base, billingState: "blocked", status: "suspended", canBilling: false })!
    expect(b.action).toBeNull()
    expect(b.text).toMatch(/Read-only/)
    expect(bannerOf({ ...base, billingState: "grace", status: "trial", canBilling: false })!.action).toBeNull()
    expect(bannerOf({ ...base, status: "past_due", canBilling: false })!.action).toBeNull()
    expect(bannerOf({ ...base, status: "trial", trialEndsAt: "2026-11-25T09:00:00.000Z", canBilling: false })!.action).toBeNull()
  })
  test("a suspension that is not billing shows a neutral message, never the billing copy or link", () => {
    const b = bannerOf({ ...base, status: "suspended", billingState: "ok", canBilling: true })!
    expect(b.text).toBe("This workspace is suspended. Contact support.")
    expect(b.action).toBeNull()
    expect(b.text).not.toMatch(/subscription|billing|Reactivate/i)
  })
  test("a healthy company has no banner", () => expect(bannerOf({ ...base, canBilling: true })).toBeNull())
  test("the layout passes who may open billing", () => {
    expect(read("app/(app)/layout.tsx")).toMatch(/canBilling=/)
  })
})

describe("T6.4 carry-in 9: stale docs", () => {
  test("tasks.md and SRS.md no longer point at the deleted outbox modules (the historical SRS-v1.2-built.md is left alone)", () => {
    for (const f of [".claude/docs/features/tasks.md", ".claude/docs/requirements/SRS.md"]) {
      const s = read(f)
      expect(s, f).not.toMatch(/lib\/audit-outbox/)
      expect(s, f).not.toMatch(/lib\/task-notices/)
    }
  })
})
