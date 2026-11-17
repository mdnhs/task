"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { Input } from "@/components/ui/input"
import { When } from "@/components/when"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { paginate } from "@/lib/paginate"
import type { Status } from "@/lib/types"
import { wallInTz } from "@/lib/tz"
import { formatMinor } from "../adapters"
import { makeBillingClient } from "../client"
import { INVOICES_PAGE_SIZE } from "../constants"
import type { Invoice, InvoiceStatus, PlanCard, Subscription, SubscriptionStatus } from "../types"

const SUB_STATUS: Record<SubscriptionStatus, Status> = {
  trialing: { tone: "info", label: "Trial" },
  active: { tone: "ok", label: "Active" },
  past_due: { tone: "bad", label: "Payment failed" },
  canceled: { tone: "bad", label: "Canceled" },
  incomplete: { tone: "bad", label: "Suspended" },
  unpaid: { tone: "bad", label: "Suspended" },
  paused: { tone: "bad", label: "Paused" },
}
const INVOICE_STATUS: Record<InvoiceStatus, Status> = {
  paid: { tone: "ok", label: "Paid" },
  failed: { tone: "bad", label: "Payment failed" },
  open: { tone: "warn", label: "Open" },
}

const level = (used: number, limit: number) => (used >= limit ? "full" : used / limit >= 0.8 ? "high" : "ok")

// Billing tab (FR-SAAS-06/07/07a): plan and status, renewal, seats against the cap, included modules, plans, invoices.
// Everything is the API's (subscription, invoices) plus the static plan table. The server is the truth: every action ends with a router refresh.
export function BillingView({
  subscription: sub,
  plans,
  modules,
  invoices,
  invoicesMore,
  today,
  timezone,
  tzLabel,
  locale,
  canManage,
}: {
  subscription: Subscription
  plans: PlanCard[]
  modules: { id: string; label: string; description: string; included: boolean }[]
  invoices: Invoice[]
  /** More invoices exist than the one page the tab loads. */
  invoicesMore: boolean
  today: string
  timezone: string
  tzLabel: string
  locale: string
  /** Billing is the owner's: false shows everything read-only. A blocked (read-only) company's owner still has it (they must be able to pay). */
  canManage: boolean
}) {
  const [page, setPage] = useState(1)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [seatText, setSeatText] = useState(String(sub.seats))
  const run = useApiAction()
  const billing = makeBillingClient(apiBrowser, { go: (u) => window.location.assign(u) })

  const plan = plans.find((p) => p.current) ?? plans[0]
  const money = (minor: number, currency: string) => formatMinor(minor, currency, locale)
  const num = (n: number) => n.toLocaleString(locale)
  const wall = (iso: string) => wallInTz(iso, timezone)
  const paged = paginate(invoices, page, INVOICES_PAGE_SIZE)
  const pastDue = sub.status === "past_due"
  const trial = sub.status === "trialing"
  const dateLabel = trial ? "Trial ends" : pastDue ? "Payment was due" : sub.cancelAtPeriodEnd ? "Ends on" : "Renews on"
  const dateIso = trial ? sub.trialEndsAt : sub.currentPeriodEnd
  const seatLimit = plan?.limits.activeUsers ?? sub.seats

  const checkout = (planId: string) => run(`checkout:${planId}`, () => (toast(`Opening checkout…`), billing.checkout(planId)))
  const portal = () => run("portal", () => (toast(`Opening billing portal…`), billing.portal()))
  // A company that already has a provider subscription changes plan in the provider's portal; a new one starts a checkout.
  const choose = (planId: string) => (sub.hasProviderSubscription ? portal() : checkout(planId))

  const seatN = Number(seatText)
  const seatErr = !/^\d+$/.test(seatText.trim()) ? "Enter a whole number." : seatN < sub.seatsUsed ? "Seats can't be fewer than your active members." : seatN > seatLimit ? "That is more seats than your plan allows." : undefined
  const saveSeats = () =>
    void run("seats", () => billing.setSeats(seatN)).then((r) => r.ok && toast.success("Seats updated"))

  return (
    <>
      <section className="card set-card bill-head" aria-labelledby="bill-plan-h">
        <div className="card-head">
          <div>
            <h2 id="bill-plan-h">Current plan</h2>
            <div className="sub">Billed monthly</div>
          </div>
          {canManage && (
            <div className="bill-actions">
              <button type="button" className="btn btn-primary" onClick={() => void choose(plan.id)}>Change plan</button>
              <button type="button" className="btn btn-outline" onClick={() => void portal()}>Manage billing</button>
              {sub.hasProviderSubscription && (sub.cancelAtPeriodEnd
                ? <button type="button" className="btn btn-outline" onClick={() => void run("resume", () => billing.resume()).then((r) => r.ok && toast.success("Plan resumed"))}>Resume plan</button>
                : <button type="button" className="btn btn-outline" onClick={() => setConfirmCancel(true)}>Cancel plan</button>)}
            </div>
          )}
        </div>
        {pastDue && (
          <p className="set-notice set-notice-bad" role="alert">
            <Icon name="flag" />
            <span>Payment failed. Update your payment method to keep access.</span>
          </p>
        )}
        {sub.cancelAtPeriodEnd && sub.currentPeriodEnd && (
          <p className="set-notice" role="status">
            <Icon name="flag" />
            <span>Cancels on <When iso={wall(sub.currentPeriodEnd)} today={today} tzLabel={tzLabel} mode="date" />. Resume to keep your plan.</span>
          </p>
        )}
        <dl className="bill-summary">
          <div>
            <dt>Plan</dt>
            <dd className="bill-plan">{sub.planName}<StatusPill status={SUB_STATUS[sub.status]} /></dd>
          </div>
          <div>
            <dt>{dateLabel}</dt>
            <dd className="num">{dateIso ? <When iso={wall(dateIso)} today={today} tzLabel={tzLabel} mode="date" /> : "None"}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="num">{money(sub.priceMinor, sub.currency)} / month</dd>
          </div>
          <div>
            <dt>Seats</dt>
            <dd className="num">{num(sub.seatsUsed)} of {num(sub.seats)}</dd>
          </div>
        </dl>
      </section>

      <section className="card set-card" aria-labelledby="bill-seats-h">
        <div className="card-head">
          <div>
            <h2 id="bill-seats-h">Seats</h2>
            <div className="sub">Active members against your seat cap</div>
          </div>
        </div>
        <ul className="bill-usage bill-seats">
          <li>
            <div className="bill-usage-row">
              <span className="tt">Active seats</span>
              <span className="num">{num(sub.seatsUsed)} of {num(sub.seats)}</span>
            </div>
            <div suppressHydrationWarning className="progress bill-bar" data-level={level(sub.seatsUsed, sub.seats)} role="progressbar" aria-label="Seats used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((sub.seatsUsed / sub.seats) * 100))}>
              <i style={{ width: `${Math.min(100, Math.round((sub.seatsUsed / sub.seats) * 100))}%` }} />
            </div>
            {level(sub.seatsUsed, sub.seats) === "full" && <p className="bill-limit">Seat cap reached. Raise it to add more people.</p>}
          </li>
        </ul>
        {canManage && (
          <form className="bill-seat-form" onSubmit={(e) => { e.preventDefault(); if (!seatErr) saveSeats() }}>
            <Field label="Seat cap" htmlFor="bill-seat-cap" error={seatText !== String(sub.seats) ? seatErr : undefined} hint={`Between ${num(sub.seatsUsed)} and ${num(seatLimit)} on the ${plan?.name ?? sub.planName} plan.`}>
              <Input id="bill-seat-cap" inputMode="numeric" value={seatText} onChange={(e) => setSeatText(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={!!seatErr || seatN === sub.seats}>Save seats</button>
          </form>
        )}
      </section>

      <section className="card set-card" aria-labelledby="bill-mods-h">
        <div className="card-head">
          <div>
            <h2 id="bill-mods-h">Included modules</h2>
            <div className="sub">What the {sub.planName} plan includes. Other modules are hidden from your workspace.</div>
          </div>
        </div>
        <ul className="bill-mods">
          {modules.map((m) => (
            <li key={m.id} data-included={m.included ? "" : undefined}>
              <div>
                <span className="tt">{m.label}</span>
                <div className="tm">{m.description}</div>
              </div>
              <StatusPill status={m.included ? { tone: "ok", label: "Included" } : { tone: "mute", label: "Not in plan" }} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card set-card" aria-labelledby="bill-plans-h">
        <div className="card-head">
          <div>
            <h2 id="bill-plans-h">Plans</h2>
            <div className="sub">Every plan starts with a {plan?.trialDays ?? 14} day trial</div>
          </div>
        </div>
        <ul className="bill-plans">
          {plans.map((p) => (
            <li key={p.id} className="bill-plan-card" data-current={p.current ? "" : undefined}>
              <div className="bill-plan-top">
                <h3>{p.name}</h3>
                {p.current && <StatusPill status={{ tone: "ok", label: "Current plan" }} />}
              </div>
              <p className="bill-price num">{money(p.priceMinor, p.currency)}<small> / month</small></p>
              <ul className="bill-limits num">
                <li>{num(p.limits.activeUsers)} active users</li>
                <li>{num(p.limits.storageGb)} GB storage</li>
                <li>{num(p.limits.messages)} messages</li>
                <li>{num(p.limits.transcriptionMinutes)} transcription minutes</li>
                <li>{p.modules} modules</li>
              </ul>
              {canManage && !p.current && (
                <button type="button" className="btn btn-outline" onClick={() => void choose(p.id)}>Switch to {p.name}</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card set-card" aria-labelledby="bill-inv-h">
        <div className="card-head">
          <div>
            <h2 id="bill-inv-h">Invoices</h2>
            <div className="sub">{invoices.length}{invoicesMore ? "+" : ""} {invoices.length === 1 ? "invoice" : "invoices"}</div>
          </div>
        </div>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Number</th><th>Date</th><th>Amount</th><th>Status</th><th>Invoice</th></tr>
              </thead>
              <tbody>
                {paged.rows.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Number"><span className="tt num">{i.number}</span></td>
                    <td data-label="Date" className="num"><When iso={wall(i.createdAt)} today={today} tzLabel={tzLabel} mode="date" /></td>
                    <td data-label="Amount" className="num">{formatMinor(i.amountMinor, i.currency, locale)}</td>
                    <td data-label="Status"><StatusPill status={INVOICE_STATUS[i.status]} /></td>
                    <td data-label="Invoice">
                      {i.hostedUrl
                        ? <a className="btn btn-outline set-sm" href={i.hostedUrl} target="_blank" rel="noopener noreferrer" aria-label={`View invoice ${i.number}`}>View</a>
                        : <span className="tm">None</span>}
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

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel your plan?"
        text="Your plan stays active until the end of the billing period, then the workspace becomes read-only. You can resume before then."
        confirmLabel="Cancel plan"
        destructive
        onConfirm={() => void run("cancel", () => billing.cancel()).then((r) => r.ok && toast("Plan will cancel at the period end"))}
      />
    </>
  )
}
