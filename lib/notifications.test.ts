import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { fakeApi } from "@/test/support/fake-api"
import { markAllRead, markRead, startPolling, toNotification, loadNotifications } from "./notifications"

const DTO = { id: "0b6d1f3e-2a47-4a55-9c1e-7d6a9f0c5e11", kind: "task", title: "A task was assigned to you", body: "Fix the boiler", link: "/tasks/TSK-1042", createdAt: "2026-11-18T22:00:00.000Z", readAt: null }

describe("T6.4 the bell reads the API's notifications", () => {
  test("toNotification: kind is the type, createdAt becomes the tenant's wall time, unread follows readAt, the link is kept", () => {
    expect(toNotification(DTO, "Pacific/Auckland")).toEqual({ id: DTO.id, type: "task", title: "A task was assigned to you", at: "2026-11-19T11:00:00", read: false, href: "/tasks/TSK-1042" })
    expect(toNotification({ ...DTO, readAt: "2026-11-18T23:00:00.000Z" }, "UTC").read).toBe(true)
  })

  test("the body text is not shown or carried (compact bell, nothing sensitive in the list)", () => {
    expect(JSON.stringify(toNotification(DTO, "UTC"))).not.toContain("boiler")
  })

  test("a missing or unsafe link falls back to the kind's own page (never an external or script URL)", () => {
    expect(toNotification({ ...DTO, link: null, kind: "billing" }, "UTC").href).toBe("/settings/billing")
    expect(toNotification({ ...DTO, link: null, kind: "task" }, "UTC").href).toBe("/tasks")
    for (const bad of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/\\evil.example"]) expect(toNotification({ ...DTO, link: bad }, "UTC").href, bad).toBe("/tasks")
  })

  test("an unknown kind is a system notice, never a crash or an undefined type", () => {
    expect(toNotification({ ...DTO, kind: "from-the-future" as never, link: null }, "UTC")).toMatchObject({ type: "system", href: "/" })
  })

  test("loadNotifications lists /v1/notifications and returns the items with the server's unread count", async () => {
    const { client, calls } = fakeApi({ "GET /v1/notifications": { items: [DTO, { ...DTO, id: "2", readAt: "2026-11-18T23:00:00.000Z" }], unread: 1 } })
    const r = await loadNotifications(client, "UTC")
    expect(calls[0]).toMatchObject({ method: "get", path: "/v1/notifications" })
    expect(r.unread).toBe(1)
    expect(r.items.map((n) => [n.id, n.read])).toEqual([[DTO.id, false], ["2", true]])
  })

  test("markRead posts to /v1/notifications/{id}/read and markAllRead to /read-all", async () => {
    const { client, calls } = fakeApi({ [`POST /v1/notifications/{id}/read`]: { ...DTO, readAt: "2026-11-18T23:00:00.000Z" }, "POST /v1/notifications/read-all": { updated: 3 } })
    const n = await markRead(client, DTO.id, "UTC")
    expect(n.read).toBe(true)
    expect(calls[0]).toMatchObject({ method: "post", path: "/v1/notifications/{id}/read" })
    expect(await markAllRead(client)).toBe(3)
    expect(calls[1]).toMatchObject({ method: "post", path: "/v1/notifications/read-all" })
  })
})

describe("T6.4 polling: every 60 s, only while the tab is visible", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const fakeDoc = (state: "visible" | "hidden" = "visible") => {
    const listeners = new Set<() => void>()
    return {
      visibilityState: state,
      addEventListener: (_t: string, l: () => void) => void listeners.add(l),
      removeEventListener: (_t: string, l: () => void) => void listeners.delete(l),
      set(s: "visible" | "hidden") {
        this.visibilityState = s
        listeners.forEach((l) => l())
      },
      count: () => listeners.size,
    }
  }

  test("loads once on start, then every 60 seconds while visible", async () => {
    const load = vi.fn(async () => undefined)
    const stop = startPolling({ load, doc: fakeDoc() })
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(load).toHaveBeenCalledTimes(4)
    stop()
  })

  test("a hidden tab makes no calls; becoming visible refreshes at once and resumes the 60 s beat", async () => {
    const load = vi.fn(async () => undefined)
    const doc = fakeDoc("hidden")
    const stop = startPolling({ load, doc })
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(load).not.toHaveBeenCalled()
    doc.set("visible")
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    doc.set("hidden")
    await vi.advanceTimersByTimeAsync(180_000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })

  test("stop() clears the timer and the visibility listener", async () => {
    const load = vi.fn(async () => undefined)
    const doc = fakeDoc()
    const stop = startPolling({ load, doc })
    stop()
    expect(doc.count()).toBe(0)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test("a failing poll is swallowed (the next beat tries again) and never overlaps itself", async () => {
    let calls = 0
    let release: () => void = () => undefined
    const load = vi.fn(() => {
      calls++
      return calls === 1 ? Promise.reject(new Error("offline")) : new Promise<void>((r) => (release = r))
    })
    const stop = startPolling({ load, doc: fakeDoc() })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(120_000) // second call still pending: no overlap
    expect(load).toHaveBeenCalledTimes(2)
    release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(3)
    stop()
  })
})
