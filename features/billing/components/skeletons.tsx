import type { ReactNode } from "react"

import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk } from "@/components/sk"
import { INVOICES_PAGE_SIZE } from "../constants"

// Mirrors BillingView's five cards (plan, seats, modules, plans grid, invoices) with the same classes. Rendered inside the settings skeleton's .set-body.
// Static: it never reads the API. The settings loading passes the TYPICAL case (owner, a plan with a provider subscription, a few invoices); the real page then
// replaces it. T6.9 browser-measures the seats card (new in T6.4) and the invoice row (the View link replaces the Download button).
const CardHead = ({ title, sub, actions }: { title: number; sub: number | string; actions?: ReactNode }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={18} lh={28} />
      {typeof sub === "string" ? <div className="sub"><span className="sk-ghost">{sub}</span></div> : <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />}
    </div>
    {actions && <div className="bill-actions">{actions}</div>}
  </div>
)

export function BillingSkeleton({
  plans = 3,
  invoices = 0,
  canManage = true,
  currentIndex = 0,
  pastDue = false,
  seatsFull = false,
  subscribed = true,
  modules = [],
  planName = "",
}: {
  plans?: number
  invoices?: number
  canManage?: boolean
  /** Index of the tenant's plan in the plans list: that card shows the Current pill and no Switch button. */
  currentIndex?: number
  /** Renders the payment-failed notice. */
  pastDue?: boolean
  /** The seat cap is reached (the "Seat cap reached" line shows). */
  seatsFull?: boolean
  /** The company has a provider subscription: the Cancel plan button shows beside Manage billing. */
  subscribed?: boolean
  /** Product modules of the catalogue (label + description) for the Included modules card; ghost text wraps like the real one. */
  modules?: { label: string; description: string; included?: boolean }[]
  /** The tenant's plan name, for the Included modules subtitle (it wraps on phones). */
  planName?: string
}) {
  return (
    <>
      <section className="card set-card bill-head">
        <CardHead
          title={130}
          sub="Billed monthly"
          actions={canManage && (<><span className="btn btn-primary sk-ghost-btn">Change plan</span><span className="btn btn-outline sk-ghost-btn">Manage billing</span>{subscribed && <span className="btn btn-outline sk-ghost-btn">Cancel plan</span>}</>)}
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
        <CardHead title={60} sub="Active members against your seat cap" />
        <ul className="bill-usage bill-seats">
          <li>
            <div className="bill-usage-row"><Sk w={100} h={12} lh={20} /><Sk w={110} h={12} lh={19} /></div>
            <Sk h={8} r="pill" style={{ marginTop: 8 }} />
            {seatsFull && <Sk w={230} h={12} lh={17} style={{ marginTop: 6 }} />}
          </li>
        </ul>
        {canManage && (
          <div className="bill-seat-form">
            {/* browser-measured field (settings): label line 18.1, control 48, hint line 17.4 plus the hint's 6px top margin */}
            <div className="od-field">
              <label><span className="sk-ghost">Seat cap</span></label>
              <Sk h={48} r={12} />
              <div className="od-field-msg"><p className="od-field-hint"><span className="sk-ghost">Between 0 and 0 on the Business plan.</span></p></div>
            </div>
            <span className="btn btn-primary sk-ghost-btn">Save seats</span>
          </div>
        )}
      </section>
      <section className="card set-card">
        <CardHead title={150} sub={planName ? `What the ${planName} plan includes. Other modules are hidden from your workspace.` : 330} />
        <ul className="bill-mods">
          {modules.map((m, i) => (
            <li key={i} data-included={m.included === false ? undefined : ""}>
              <div>
                <span className="tt sk-ghost">{m.label}</span>
                <div className="tm sk-ghost">{m.description}</div>
              </div>
              {m.included === undefined ? <Sk w={84} h={29.4} r={8} /> : <span className="st sk-ghost">{m.included ? "Included" : "Not in plan"}</span>}
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
              {canManage && i !== currentIndex && <Sk h={48} r={14} />}
            </li>
          ))}
        </ul>
      </section>
      <section className="card set-card">
        <CardHead title={90} sub={70} />
        {invoices > 0 && (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead><tr>{[50, 36, 50, 40, 50].map((w, i) => <th key={i}><Sk w={w} h={10} lh={16} /></th>)}</tr></thead>
              <tbody>
                {Array.from({ length: pageRows(invoices, INVOICES_PAGE_SIZE) }, (_, i) => (
                  <tr key={i}>
                    <td data-label="Number"><Sk w={130} h={12} lh={19} /></td>
                    <td data-label="Date" className="num"><Sk w={80} h={12} /></td>
                    <td data-label="Amount" className="num"><Sk w={64} h={12} /></td>
                    <td data-label="Status"><Sk w={64} h={29.4} r={8} /></td>
                    <td data-label="Invoice"><Sk w={64} h={48} r={12} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invoices === 0 && (
          <div className="od-empty">
            <Sk w={56} h={56} r="circle" style={{ marginBottom: 6 }} />
            {/* the real empty state's copy as ghost text, so it wraps exactly like the page at every width */}
            <h2><span className="sk-ghost">No invoices yet</span></h2>
            <p><span className="sk-ghost">Your first invoice appears after the trial ends.</span></p>
          </div>
        )}
        {needsPager(invoices, INVOICES_PAGE_SIZE) && <PagerSkeleton rows={invoices} size={INVOICES_PAGE_SIZE} />}
      </section>
    </>
  )
}
