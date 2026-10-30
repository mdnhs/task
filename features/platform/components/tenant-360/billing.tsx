"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { StatusPill } from "@/components/status-pill"
import { money } from "../../money"
import { canCancelAtPeriodEnd, dateY, setCancelAtPeriodEnd } from "../../logic"
import { tenantPath, type BillingTab, type T360Head } from "../../tenant-360"
import { INVOICE_STATUS } from "../../types"
import { InvoiceSheet } from "../invoice-sheet"
import { SlugConfirmDialog } from "../slug-confirm-dialog"
import { CreditDialog } from "./dialogs"
import { invoiceActions } from "../invoice-actions"
import { commitTenant, useLiveInvoices, useLiveTenant, type T360Ctx } from "./live"
import { SubscriptionFacts } from "./overview"

// Billing tab (route gated on billing.read): the subscription with its write actions (billing.write), the tenant's
// invoices with the shared InvoiceSheet (Task 6), and the credit balance.
export function BillingTabView({ head, data, ctx }: { head: T360Head; data: BillingTab; ctx: T360Ctx }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const invoices = useLiveInvoices(data.invoices)
  const plan = head.plans.find((p) => p.id === t.plan)
  const currency = plan?.currency ?? invoices[0]?.currency ?? ""
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dialog, setDialog] = useState<"credit" | "cancel" | null>(null)
  const current = invoices.find((i) => i.id === openId) ?? null
  const write = head.can.billing

  const { onRetry, onMarkPaid, onRefund, onVoid } = invoiceActions({ ...ctx, provider: head.provider }, invoices)
  function toggleCancel(reason: string) {
    const on = !t.cancelAtPeriodEnd
    const after = setCancelAtPeriodEnd(t, on, reason)
    commitTenant(ctx, t, after, { action: on ? "subscription.cancel_scheduled" : "subscription.cancel_withdrawn", detail: `${on ? "Cancels at period end" : "Renews again"}: ${reason}`, reason })
    toast.success(on ? "Subscription cancels at period end" : "Subscription renews again")
  }

  return (
    <div className="pf-col">
      <section className="card" aria-labelledby="pf-bsub-h">
        <div className="card-head">
          <div>
            <h2 id="pf-bsub-h">Subscription</h2>
            <div className="sub">{t.cancelAtPeriodEnd ? "Cancels at the end of the current period" : "Billed monthly through the payment provider"}</div>
          </div>
          {write && (
            <div className="pf-card-acts">
              {t.status !== "suspended" && <Link href={tenantPath(t.id, "change-plan")} className="btn btn-outline pf-act">Change plan</Link>}
              <button type="button" className="btn btn-outline pf-act" onClick={() => setDialog("credit")}>Apply credit</button>
              {(t.cancelAtPeriodEnd || canCancelAtPeriodEnd(t)) && (
                <button type="button" className="btn btn-outline pf-act" onClick={() => setDialog("cancel")}>{t.cancelAtPeriodEnd ? "Keep renewing" : "Cancel at period end"}</button>
              )}
            </div>
          )}
        </div>
        <SubscriptionFacts t={t} plan={plan} amounts tzLabel={ctx.tzLabel} />
        <dl className="pf-meta pf-meta-b">
          <div><dt>Payment method</dt><dd>{t.billing.paymentMethod || "None on file"}{t.billing.paymentMethod ? <span className="pf-inv-via"> · {head.provider.name}</span> : null}</dd></div>
          <div><dt>Credit balance</dt><dd className="num">{money(t.creditBalance ?? 0, currency)}</dd></div>
        </dl>
      </section>

      <section className="card pf-card" aria-labelledby="pf-binv-h">
        <div className="card-head">
          <div>
            <h2 id="pf-binv-h">Invoices</h2>
            <div className="sub">{invoices.length ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}, newest first` : "Nothing billed yet"}</div>
          </div>
        </div>
        {invoices.length ? (
          <div className="table-wrap">
            <table className="rtable pf-ledger pf-tinv">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th className="pf-r">Amount</th>
                  <th>Status</th>
                  <th className="pf-r">Attempts</th>
                  <th>Next retry</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Invoice">
                      <button type="button" className="pf-inv-open num" onClick={() => { setOpenId(i.id); setSheetOpen(true) }}>{i.number}</button>
                    </td>
                    <td data-label="Issued" className="num"><time dateTime={i.issuedAt}>{dateY(i.issuedAt)}</time></td>
                    <td data-label="Amount" className="num pf-r">{money(i.amount, i.currency)}</td>
                    <td data-label="Status"><StatusPill status={INVOICE_STATUS[i.status]} /></td>
                    <td data-label="Attempts" className="num pf-r">{i.attempts}</td>
                    <td data-label="Next retry" className="num">
                      {i.nextRetryAt ? dateY(i.nextRetryAt) : i.status === "failed" ? <span className="pf-dun-out">Retries exhausted</span> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="receipt" title="No invoices yet" text={t.status === "trial" ? "The first invoice is issued when the trial converts to a paid plan." : "Invoices appear here once the subscription bills."} />
        )}
      </section>

      <InvoiceSheet
        invoice={current}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canWrite={write}
        provider={head.provider.name}
        tzLabel={ctx.tzLabel}
        onRetry={onRetry}
        onMarkPaid={onMarkPaid}
        onRefund={onRefund}
        onVoid={onVoid}
      />
      {write && <CreditDialog tenant={t} ctx={ctx} currency={currency} open={dialog === "credit"} onOpenChange={(o) => setDialog(o ? "credit" : null)} />}
      {write && (
        <SlugConfirmDialog
          open={dialog === "cancel"}
          onOpenChange={(o) => setDialog(o ? "cancel" : null)}
          title={t.cancelAtPeriodEnd ? `Keep ${t.name} renewing?` : `Cancel ${t.name} at period end?`}
          text={
            t.cancelAtPeriodEnd
              ? "The subscription renews as normal again. The reason is recorded in the platform audit trail."
              : `The workspace stays as it is until ${t.billing.renewsOn ? dateY(t.billing.renewsOn) : "the period ends"}, then the subscription stops instead of renewing. The reason is recorded in the platform audit trail.`
          }
          reason
          // D7: cancelling is destructive, so it also needs the slug typed; withdrawing it only needs the reason.
          slug={t.cancelAtPeriodEnd ? undefined : t.slug}
          confirmLabel={t.cancelAtPeriodEnd ? "Keep renewing" : "Cancel at period end"}
          destructive={!t.cancelAtPeriodEnd}
          onConfirm={toggleCancel}
        />
      )}
    </div>
  )
}
