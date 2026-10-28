import type { Order, OrdersTab } from "./types"

export const ORDERS_PAGE_SIZE = 10

/** Waiting approval: undecided requests. Orders: everything decided. Deliveries: approved orders already placed. */
export function inTab(o: Order, tab: OrdersTab): boolean {
  if (tab === "waiting") return o.approval === "pending"
  if (tab === "orders") return o.approval !== "pending"
  return o.approval === "approved" && o.delivery !== "not_ordered"
}

const DELIVERY_RANK = { partial: 0, ordered: 1, delivered: 2, not_ordered: 3 } as const

/** Waiting: oldest request first. Orders: newest ref first. Deliveries: open ones first, by expected date. */
export function sortFor(tab: OrdersTab) {
  return (a: Order, b: Order) => {
    if (tab === "waiting") return a.requested.localeCompare(b.requested)
    if (tab === "deliveries") return DELIVERY_RANK[a.delivery] - DELIVERY_RANK[b.delivery] || a.expected.localeCompare(b.expected)
    return b.ref.localeCompare(a.ref)
  }
}

export function matchesQuery(o: Order, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !s || [o.item, o.ref, o.supplier, o.requester].some((v) => v.toLowerCase().includes(s))
}

export function orderStats(orders: Order[]) {
  return {
    waiting: orders.filter((o) => o.approval === "pending").length,
    waitingValue: orders.filter((o) => o.approval === "pending").reduce((s, o) => s + o.amount, 0),
    inTransit: orders.filter((o) => o.approval === "approved" && (o.delivery === "ordered" || o.delivery === "partial")).length,
    delivered: orders.filter((o) => o.delivery === "delivered").length,
  }
}
