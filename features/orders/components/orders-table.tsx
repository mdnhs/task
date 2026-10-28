"use client"


import { PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import type { Money } from "@/lib/money"
import { APPROVAL, DELIVERY } from "../types"
import type { Order } from "../types"

// `page` (optional): pass the current page so a page change slides the rows in from the paging side.
export function OrdersTable({ orders, page = 1, today, tzLabel, money, onOpen }: { orders: Order[]; page?: number; today: string; tzLabel: string; money: Money; onOpen(ref: string): void }) {
  return (
    <div className="table-wrap">
      <table className="rtable ord-table">
        <thead>
          <tr><th>Item</th><th>Supplier</th><th>Requested by</th><th>Amount</th><th>Approval</th><th>Delivery</th><th>Expected</th></tr>
        </thead>
        <PagedBody page={page}>
            {orders.map((o) => (
              <tr key={o.ref}>
                <td data-label="Item">
                  <button type="button" className="tt ord-link" onClick={() => onOpen(o.ref)}>{o.item}</button>
                  <div className="tm num">{o.ref} · Qty {o.qty}</div>
                </td>
                <td data-label="Supplier">{o.supplier}</td>
                <td data-label="Requested by">
                  <div>
                    <div className="tt">{o.requester}</div>
                    <div className="tm">{o.dept}</div>
                  </div>
                </td>
                <td data-label="Amount" className="num">{money.format(o.amount)}</td>
                <td data-label="Approval"><StatusPill status={APPROVAL[o.approval]} /></td>
                <td data-label="Delivery">
                  <div className="ord-deliv">
                    <StatusPill status={DELIVERY[o.delivery]} />
                    {o.delivery === "partial" && <span className="tm num">{o.received} of {o.qty}</span>}
                  </div>
                </td>
                <td data-label="Expected" className="num">
                  {o.approval === "rejected" ? "-" : <When iso={o.expected} today={today} tzLabel={tzLabel} mode="date" />}
                </td>
              </tr>
            ))}
        </PagedBody>
      </table>
    </div>
  )
}
