import type { Status } from "@/lib/types"

export type Approval = "pending" | "approved" | "rejected"
export type Delivery = "not_ordered" | "ordered" | "partial" | "delivered"
export type OrdersTab = "waiting" | "orders" | "deliveries"

export type OrderEvent = { at: string; by: string; action: string; note?: string }

export type Order = {
  ref: string
  item: string
  qty: number
  supplier: string
  /** Name of the person who asked for it. */
  requester: string
  dept: string
  approval: Approval
  delivery: Delivery
  /** Expected delivery date, ISO. */
  expected: string
  /** In the tenant currency (org settings), whole units or with cents. */
  amount: number
  /** Quantity received so far. */
  received: number
  /** Required when approval is "rejected" (FR-STOCK-03). */
  rejectReason?: string
  requested: string
  history: OrderEvent[]
}

export const APPROVAL: Record<Approval, Status> = {
  pending: { tone: "warn", label: "Waiting approval" },
  approved: { tone: "ok", label: "Approved" },
  rejected: { tone: "bad", label: "Rejected" },
}
export const DELIVERY: Record<Delivery, Status> = {
  not_ordered: { tone: "mute", label: "Not ordered" },
  ordered: { tone: "info", label: "Ordered" },
  partial: { tone: "warn", label: "Partly delivered" },
  delivered: { tone: "ok", label: "Delivered" },
}

export const TABS: { value: OrdersTab; label: string }[] = [
  { value: "waiting", label: "Waiting approval" },
  { value: "orders", label: "Orders" },
  { value: "deliveries", label: "Deliveries" },
]

