import { describe, expect, it } from "vitest"

import { inTab, matchesQuery, orderStats, sortFor } from "./filters"
import { approve, markOrdered, nextRef, receive, reject } from "./mutations"
import type { Order } from "./types"

const base: Order = {
  ref: "ORD-1", item: "Supplies order", qty: 10, supplier: "Bunzl", requester: "Tomasz Wójcik", dept: "Cleaning",
  approval: "pending", delivery: "not_ordered", expected: "2026-10-26", amount: 640, received: 0, requested: "2026-10-19T16:20:00", history: [],
}
const AT = "2026-10-20T09:00:00"

describe("orders mutations", () => {
  it("approves a pending order and logs it", () => {
    const o = approve(base, "Lilianna Novak", AT)
    expect(o.approval).toBe("approved")
    expect(o.history.at(-1)).toMatchObject({ action: "Approved", by: "Lilianna Novak" })
  })
  it("rejects only with a reason (FR-STOCK-03)", () => {
    expect(reject(base, "L", AT, "   ")).toBe(base)
    const o = reject(base, "L", AT, " Over budget ")
    expect(o).toMatchObject({ approval: "rejected", rejectReason: "Over budget" })
  })
  it("does not decide twice", () => {
    const a = approve(base, "L", AT)
    expect(reject(a, "L", AT, "x")).toBe(a)
  })
  it("partial then full delivery", () => {
    const ordered = markOrdered(approve(base, "L", AT), "T", AT)
    const part = receive(ordered, "T", AT, 4)
    expect(part).toMatchObject({ delivery: "partial", received: 4 })
    expect(receive(part, "T", AT, 7)).toBe(part) // more than outstanding
    expect(receive(part, "T", AT, 6)).toMatchObject({ delivery: "delivered", received: 10 })
  })
  it("cannot receive before ordering", () => {
    expect(receive(approve(base, "L", AT), "T", AT, 1).delivery).toBe("not_ordered")
  })
  it("tabs and refs", () => {
    expect(inTab(base, "waiting")).toBe(true)
    expect(inTab(approve(base, "L", AT), "deliveries")).toBe(false)
    expect(nextRef([base, { ...base, ref: "ORD-2041" }])).toBe("ORD-2042")
  })
})

describe("orders filters", () => {
  const approved: Order = { ...base, ref: "ORD-2", approval: "approved", delivery: "ordered" }
  it("splits orders into tabs", () => {
    expect(inTab(base, "waiting")).toBe(true)
    expect(inTab(base, "orders")).toBe(false)
    expect(inTab(approved, "orders")).toBe(true)
    expect(inTab(approved, "deliveries")).toBe(true)
    expect(inTab({ ...approved, delivery: "not_ordered" }, "deliveries")).toBe(false)
  })
  it("matches a query on item, ref, supplier and requester", () => {
    expect(matchesQuery(base, "  bunzl ")).toBe(true)
    expect(matchesQuery(base, "ord-1")).toBe(true)
    expect(matchesQuery(base, "tomasz")).toBe(true)
    expect(matchesQuery(base, "nope")).toBe(false)
    expect(matchesQuery(base, "")).toBe(true)
  })
  it("counts stats", () => {
    expect(orderStats([base, approved, { ...approved, ref: "ORD-3", delivery: "delivered" }])).toEqual({ waiting: 1, waitingValue: 640, inTransit: 1, delivered: 1 })
  })
  it("sorts waiting oldest first and orders newest first", () => {
    const later = { ...base, ref: "ORD-9", requested: "2026-10-21T10:00:00" }
    expect([later, base].sort(sortFor("waiting"))[0]).toBe(base)
    expect([base, later].sort(sortFor("orders"))[0]).toBe(later)
  })
})
