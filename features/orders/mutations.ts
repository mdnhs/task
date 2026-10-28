import type { Order, OrderEvent } from "./types"

const add = (o: Order, e: OrderEvent): Order => ({ ...o, history: [...o.history, e] })

export function approve(o: Order, by: string, at: string): Order {
  if (o.approval !== "pending") return o
  return add({ ...o, approval: "approved" }, { at, by, action: "Approved" })
}

// FR-STOCK-03: a rejection always carries a reason.
export function reject(o: Order, by: string, at: string, reason: string): Order {
  const note = reason.trim()
  if (o.approval !== "pending" || !note) return o
  return add({ ...o, approval: "rejected", rejectReason: note }, { at, by, action: "Rejected", note })
}

export function markOrdered(o: Order, by: string, at: string): Order {
  if (o.approval !== "approved" || o.delivery !== "not_ordered") return o
  return add({ ...o, delivery: "ordered" }, { at, by, action: "Marked ordered" })
}

export const remaining = (o: Order) => Math.max(0, o.qty - o.received)

/** Books a delivery of `qty` units. Delivered when everything is in, partial otherwise. Over-receipts are ignored. */
export function receive(o: Order, by: string, at: string, qty: number): Order {
  if (o.approval !== "approved" || (o.delivery !== "ordered" && o.delivery !== "partial")) return o
  if (!Number.isInteger(qty) || qty < 1 || qty > remaining(o)) return o
  const received = o.received + qty
  return add({ ...o, received, delivery: received >= o.qty ? "delivered" : "partial" }, { at, by, action: "Delivery received", note: `${received} of ${o.qty} received` })
}

export function nextRef(orders: Order[]): string {
  const max = orders.reduce((m, o) => Math.max(m, parseInt(o.ref.replace(/\D/g, ""), 10) || 0), 0)
  return `ORD-${max + 1}`
}
