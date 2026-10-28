import type { ReactNode } from "react"

import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk } from "@/components/sk"
import { INVOICES_PAGE_SIZE } from "../constants"
import type { Invoice } from "../types"

// Mirrors BillingView's four cards (plan, usage, plans grid, invoices) with the same classes. Rendered inside the settings skeleton's .set-body.
const dateText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "")
const moneyText = (amount: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount)

const CardHead = ({ title, sub, actions }: { title: number; sub: number; actions?: ReactNode }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={18} lh={28} />
      <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />
    </div>
    {actions && <div className="bill-actions">{actions}</div>}
  </div>
)

export function BillingSkeleton({
  plans = 3,
  invoices = 0,
  invoiceRows = [],
  canManage = true,
  currentIndex = 0,
  pastDue = false,
  fullUsage = [],
}: {
  plans?: number
  invoices?: number
  canManage?: boolean
  /** The tenant's invoices: first-page rows render as ghost text so they wrap like the loaded ones (phones). */
  invoiceRows?: Invoice[]
  /** Index of the tenant's plan in the plans list: that card shows the Current pill and no Switch button. */
  currentIndex?: number
  /** Renders the payment-failed notice. */
  pastDue?: boolean
  /** Usage row indexes that are at their limit (they show the "Limit reached" line). */
  fullUsage?: number[]
}) {
  return (
    <>
      <section className="card set-card bill-head">
        <CardHead
          title={130}
          sub={140}
          actions={canManage && (<><span className="btn btn-primary sk-ghost-btn">Change plan</span><span className="btn btn-outline sk-ghost-btn">Manage billing</span></>)}
        />
        {pastDue && <Sk h={43} r={12} style={{ marginBottom: 14 }} />}
        <dl className="bill-summary">
          {/* browser-measured: label line 16.7 + 6px, the plan is a 29.4px pill, the other values 21.8px lines */}
          {[90, 110, 120, 130].map((w, i) => (
            <div key={i}>
              <Sk w={70} h={10} lh={16.7} style={{ marginBottom: 6 }} />
              {i === 0 ? <Sk w={w} h={29.4} r={8} /> : <Sk w={w} h={14} lh={21.8} />}
            </div>
          ))}
        </dl>
      </section>
      <section className="card set-card">
        <CardHead title={70} sub={290} />
        <ul className="bill-usage">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <div className="bill-usage-row"><Sk w={100} h={12} lh={20} /><Sk w={110} h={12} lh={19} /></div>
              <Sk h={8} r="pill" style={{ marginTop: 8 }} />
              {fullUsage.includes(i) && <Sk w={200} h={12} lh={17} style={{ marginTop: 6 }} />}
            </li>
          ))}
        </ul>
      </section>
      <section className="card set-card">
        <CardHead title={70} sub={210} />
        <ul className="bill-plans">
          {Array.from({ length: plans }, (_, i) => (
            <li key={i} className="bill-plan-card">
              <div className="bill-plan-top">
                <Sk w={90} h={16} lh={26.1} />
                {i === currentIndex && <Sk w={109} h={29.4} r={8} />}
              </div>
              <Sk w={130} h={26} lh={40.6} />
              <ul className="bill-limits">{[110, 100, 90, 150, 70].map((w, j) => <li key={j}><Sk w={w} h={11} lh={18.8} /></li>)}</ul>
              {canManage && i !== currentIndex && <Sk h={48.3} r={14} />}
            </li>
          ))}
        </ul>
      </section>
      <section className="card set-card">
        <CardHead title={90} sub={70} />
        {invoices > 0 && (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead><tr>{[50, 36, 50, 40, 60].map((w, i) => <th key={i}><Sk w={w} h={10} lh={16} /></th>)}</tr></thead>
              <tbody>
                {Array.from({ length: pageRows(invoices, INVOICES_PAGE_SIZE) }, (_, i) => {
                  const inv = invoiceRows[i]
                  return (
                    <tr key={i}>
                      <td data-label="Number">
                        {inv ? <><span className="tt num sk-ghost">{inv.number}</span><div className="tm sk-ghost">{inv.description}</div></> : <><Sk w={130} h={12} lh={19} /><Sk w={120} h={10} lh={16} /></>}
                      </td>
                      <td data-label="Date" className="num">{inv ? <time className="od-when sk-ghost">{dateText(inv.date)}</time> : <Sk w={80} h={12} />}</td>
                      <td data-label="Amount" className="num">{inv ? <span className="sk-ghost">{moneyText(inv.amount, inv.currency)}</span> : <Sk w={64} h={12} />}</td>
                      <td data-label="Status"><Sk w={64} h={29.4} r={8} /></td>
                      <td data-label="Download"><Sk w={100} h={36.8} r={12} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {invoices === 0 && (
          <div className="od-empty">
            <Sk w={56} h={56} r="circle" style={{ marginBottom: 6 }} />
            <Sk w={133} h={18} lh={26} />
            <Sk w={290} h={14} lh={21} />
          </div>
        )}
        {needsPager(invoices, INVOICES_PAGE_SIZE) && <PagerSkeleton rows={invoices} size={INVOICES_PAGE_SIZE} />}
      </section>
    </>
  )
}
