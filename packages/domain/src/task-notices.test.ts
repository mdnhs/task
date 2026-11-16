import { beforeEach, describe, expect, it } from "vitest"

import { GENERIC_NOTICE, noticeFeedItems, noticeTitle, taskNotices } from "./task-notices"

describe("task notices", () => {
  beforeEach(() => taskNotices.reset())
  it("words the change with old and new values", () => {
    expect(noticeTitle("Lil", "TSK-1", "rescheduled", [{ field: "Due", from: "28 Oct", to: "30 Oct" }])).toBe("Lil rescheduled TSK-1: Due 28 Oct → 30 Oct")
    expect(noticeTitle("Lil", "TSK-1", "archived")).toBe("Lil archived TSK-1")
  })
  it("keeps notices per tenant and person, once per id", () => {
    const n = { id: "a", tenantId: "t1", to: "p1", title: "x", href: "/tasks/TSK-1", at: "2026-10-20T09:00:00" }
    taskNotices.push(n)
    taskNotices.push(n)
    taskNotices.push({ ...n, id: "b", to: "p2" })
    expect(taskNotices.forPerson("t1", "p1")).toHaveLength(1)
    expect(taskNotices.forPerson("t2", "p1")).toHaveLength(0)
  })
  it("tells subscribers about new notices only", () => {
    let calls = 0
    const off = taskNotices.subscribe(() => calls++)
    const n = { id: "a", tenantId: "t1", to: "p1", title: "x", href: "/tasks/TSK-1", at: "2026-10-20T09:00:00" }
    taskNotices.push(n)
    taskNotices.push(n)
    off()
    taskNotices.push({ ...n, id: "b" })
    expect(calls).toBe(1)
  })
  it("turns notices into feed items once, generic when sensitive details are hidden", () => {
    const n = { id: "a", tenantId: "t1", to: "p1", title: "Lil rescheduled TSK-1", href: "/tasks/TSK-1", at: "2026-10-20T09:00:00" }
    const items = noticeFeedItems([n], new Set(), false)
    expect(items).toEqual([{ id: "task-notice:a", type: "manager-action", title: "Lil rescheduled TSK-1", at: n.at, read: false, href: "/tasks/TSK-1" }])
    expect(noticeFeedItems([n], new Set(["task-notice:a"]), false)).toEqual([])
    expect(noticeFeedItems([n], new Set(), true)[0].title).toBe(GENERIC_NOTICE)
  })
})
