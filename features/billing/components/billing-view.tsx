"use client"

import { useState } from "react"
import { toast } from "sonner"

import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { paginate } from "@/lib/paginate"
import type { Status } from "@/lib/types"
import { INVOICES_PAGE_SIZE } from "../constants"
import { getBillingProvider } from "../providers"
import { USAGE_ROWS } from "../types"
import type { Invoice, InvoiceStatus, Plan, Usage } from "../types"

const TENANT_STATUS: Record<string, Status> = {
  trial: { tone: "info", label: "Trial" },
  active: { tone: "ok", label: "Active" },
  past_due: { tone: "bad", label: "Payment failed" },
  suspended: { tone: "bad", label: "Suspended" },
}
const INVOICE_STATUS: Record<InvoiceStatus, Status> = {
  paid: { tone: "ok", label: "Paid" },
  failed: { tone: "bad", label: "Payment failed" },
  open: { tone: "warn", label: "Open" },
}

export const money = (amount: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount)
const level = (used: number, limit: number) => (used >= limit ? "full" : used / limit >= 0.8 ? "high" : "ok")

// Billing tab (FR-SAAS-06/07/07a): plan and status, renewal, usage against limits, plans, invoices.
// The provider name (Stripe) comes from the data so another payment method can replace it later.
export function BillingView({
  plans,
  tenantId,
  planId,
  status,
  graceEndsOn,
  trialEndsOn,
  renewsOn,
  cardLast4,
  provider: providerKey,
  usage,
  invoices,
  today,
  tzLabel,
  canManage,
}: {
  plans: Plan[]
  tenantId: string
  planId: string
  /** Tenant status from the session. */
  status: string
  graceEndsOn?: string
  trialEndsOn?: string
  renewsOn: string
  cardLast4: string | null
  /** Provider key from the billing data; resolved to a BillingProvider here. */
  provider: string
  usage: Usage
  invoices: Invoice[]
  today: string
  tzLabel: string
  canManage: boolean
}) {
  const [page, setPage] = useState(1)
  const plan = plans.find((p) => p.id === planId) ?? plans[0]
  const paged = paginate(invoices, page, INVOICES_PAGE_SIZE)
  const pastDue = status === "past_due"
  const billing = getBillingProvider(providerKey)
  const provider = billing.label
  const checkout = (target: string) => void billing.createCheckoutSession({ tenantId, planId: target }).then(() => toast(`Opening ${provider} checkout…`))
  const portal = () => void billing.openCustomerPortal({ tenantId }).then(() => toast(`Opening ${provider} billing portal…`))

  return (
    <>
      <section className="card set-card bill-head" aria-labelledby="bill-plan-h">
        <div className="card-head">
          <div>
            <h2 id="bill-plan-h">Current plan</h2>
            <div className="sub">Billed through {provider}</div>
          </div>
          {canManage && (
            <div className="bill-actions">
              <button type="button" className="btn btn-primary" onClick={() => checkout(plan.id)}>Change plan</button>
              <button type="button" className="btn btn-outline" onClick={portal}>Manage billing</button>
            </div>
          )}
        </div>
        {pastDue && (
          <p className="set-notice set-notice-bad" role="alert">
            <Icon name="flag" />
            <span>
              Payment failed. Update your payment method in {provider} to keep access
              {graceEndsOn && <> before <When iso={graceEndsOn} today={today} tzLabel={tzLabel} mode="date" /></>}.
            </span>
          </p>
        )}
        <dl className="bill-summary">
          <div>
            <dt>Plan</dt>
            <dd className="bill-plan">{plan.name}<StatusPill status={TENANT_STATUS[status] ?? TENANT_STATUS.active} /></dd>
          </div>
          <div>
            <dt>{status === "trial" ? "Trial ends" : pastDue ? "Payment was due" : "Renews on"}</dt>
            <dd className="num"><When iso={status === "trial" ? (trialEndsOn ?? renewsOn) : renewsOn} today={today} tzLabel={tzLabel} mode="date" /></dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="num">{money(plan.priceMonthly, plan.currency)} / month</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd className="num">{cardLast4 ? `Card ending ${cardLast4}` : "None added"}</dd>
          </div>
        </dl>
      </section>

      <section className="card set-card" aria-labelledby="bill-usage-h">
        <div className="card-head">
          <div>
            <h2 id="bill-usage-h">Usage</h2>
            <div className="sub">This billing period against the {plan.name} plan limits</div>
          </div>
        </div>
        <ul className="bill-usage">
          {USAGE_ROWS.map((r) => {
            const used = usage[r.key]
            const limit = plan.limits[r.key]
            const pct = Math.min(100, Math.round((used / limit) * 100))
            return (
              <li key={r.key}>
                <div className="bill-usage-row">
                  <span className="tt">{r.label}</span>
                  <span className="num">{used.toLocaleString("en-GB")}{r.unit} of {limit.toLocaleString("en-GB")}{r.unit}</span>
                </div>
                <div suppressHydrationWarning className="progress bill-bar" data-level={level(used, limit)} role="progressbar" aria-label={`${r.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                {level(used, limit) === "full" && <p className="bill-limit">Limit reached. Change plan to add more.</p>}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card set-card" aria-labelledby="bill-plans-h">
        <div className="card-head">
          <div>
            <h2 id="bill-plans-h">Plans</h2>
            <div className="sub">Every plan starts with a {plan.trialDays} day trial</div>
          </div>
        </div>
        <ul className="bill-plans">
          {plans.map((p) => {
            const current = p.id === plan.id
            return (
              <li key={p.id} className="bill-plan-card" data-current={current ? "" : undefined}>
                <div className="bill-plan-top">
                  <h3>{p.name}</h3>
                  {current && <StatusPill status={{ tone: "ok", label: "Current plan" }} />}
                </div>
                <p className="bill-price num">{money(p.priceMonthly, p.currency)}<small> / month</small></p>
                <ul className="bill-limits num">
                  <li>{p.limits.activeUsers.toLocaleString("en-GB")} active users</li>
                  <li>{p.limits.storageGb.toLocaleString("en-GB")} GB storage</li>
                  <li>{p.limits.messages.toLocaleString("en-GB")} messages</li>
                  <li>{p.limits.transcriptionMinutes.toLocaleString("en-GB")} transcription minutes</li>
                  <li>{p.modules.length} modules</li>
                </ul>
                {canManage && !current && (
                  <button type="button" className="btn btn-outline" onClick={() => checkout(p.id)}>Switch to {p.name}</button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card set-card" aria-labelledby="bill-inv-h">
        <div className="card-head">
          <div>
            <h2 id="bill-inv-h">Invoices</h2>
            <div className="sub">{invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}</div>
          </div>
        </div>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Number</th><th>Date</th><th>Amount</th><th>Status</th><th>Download</th></tr>
              </thead>
              <tbody>
                {paged.rows.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Number"><span className="tt num">{i.number}</span><div className="tm">{i.description}</div></td>
                    <td data-label="Date" className="num"><When iso={i.date} today={today} tzLabel={tzLabel} mode="date" /></td>
                    <td data-label="Amount" className="num">{money(i.amount, i.currency)}</td>
                    <td data-label="Status"><StatusPill status={INVOICE_STATUS[i.status]} /></td>
                    <td data-label="Download">
                      <button type="button" className="btn btn-outline set-sm" aria-label={`Download invoice ${i.number}`} onClick={() => toast.success("Downloading invoice", { description: i.number })}>Download</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="wallet" title="No invoices yet" text="Your first invoice appears after the trial ends." />
        )}
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Invoices pages" onPageChange={setPage} />
      </section>
    </>
  )
}
