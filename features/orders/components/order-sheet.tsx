"use client"

import { ActionButton } from "@/components/action-button"
import { DetailSheet } from "@/components/detail-sheet"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { remaining } from "../mutations"
import type { Money } from "@/lib/money"
import { APPROVAL, DELIVERY } from "../types"
import type { Order } from "../types"

export type OrderAction = "approve" | "reject" | "ordered" | "deliver"

// Detail panel. Decision and delivery buttons only render for roles with write access (`canAct`).
export function OrderSheet({
  order,
  open,
  onOpenChange,
  today,
  tzLabel,
  money,
  canAct,
  onAction,
}: {
  order: Order | undefined
  open: boolean
  onOpenChange(o: boolean): void
  today: string
  tzLabel: string
  money: Money
  canAct: boolean
  onAction(a: OrderAction): void
}) {
  const o = order
  const live = o?.approval === "approved" && (o.delivery === "ordered" || o.delivery === "partial")
  const footer =
    o && canAct ? (
      o.approval === "pending" ? (
        <>
          <ActionButton className="btn btn-primary" onDone={() => onAction("approve")}>Approve</ActionButton>
          <button type="button" className="btn btn-outline" onClick={() => onAction("reject")}>Reject</button>
        </>
      ) : o.approval === "approved" && o.delivery === "not_ordered" ? (
        <ActionButton className="btn btn-primary" onDone={() => onAction("ordered")}>Mark ordered</ActionButton>
      ) : live ? (
        <button type="button" className="btn btn-primary" onClick={() => onAction("deliver")}>Mark delivered</button>
      ) : undefined
    ) : undefined

  return (
    <DetailSheet
      open={open && !!o}
      onOpenChange={onOpenChange}
      title={o?.item ?? "Order"}
      subtitle={o && <span className="ord-pills"><StatusPill status={APPROVAL[o.approval]} /><StatusPill status={DELIVERY[o.delivery]} /></span>}
      footer={footer}
    >
      {o && (
        <>
          <dl className="ord-dl">
            <div><dt>Reference</dt><dd className="num">{o.ref}</dd></div>
            <div><dt>Quantity</dt><dd className="num">{o.qty}{o.received > 0 ? ` (${o.received} received${live ? `, ${remaining(o)} to arrive` : ""})` : ""}</dd></div>
            <div><dt>Amount</dt><dd className="num">{money.format(o.amount)}</dd></div>
            <div><dt>Supplier</dt><dd>{o.supplier}</dd></div>
            <div><dt>Requested by</dt><dd>{o.requester} · {o.dept}</dd></div>
            <div><dt>Requested</dt><dd><When iso={o.requested} today={today} tzLabel={tzLabel} /></dd></div>
            {o.approval !== "rejected" && <div><dt>Expected delivery</dt><dd><When iso={o.expected} today={today} tzLabel={tzLabel} mode="date" /></dd></div>}
            {o.rejectReason && <div><dt>Reason for rejection</dt><dd>{o.rejectReason}</dd></div>}
          </dl>
          <section aria-labelledby="ord-hist-h">
            <h3 id="ord-hist-h" className="ord-sub">History</h3>
            <ol className="ord-history">
              {o.history.map((h, n) => (
                <li key={`${h.at}-${n}`}>
                  <strong>{h.action}</strong> · {h.by}
                  <span className="ord-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
                  {h.note && <span className="ord-note">{h.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </DetailSheet>
  )
}
