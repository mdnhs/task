"use client"

import { useState } from "react"
import Link from "next/link"

import { CopyId } from "@/components/copy-id"
import { DetailSheet } from "@/components/detail-sheet"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { formatTime } from "@/lib/dates"
import { DUNNING_MAX, canMarkPaid, canRefund, canRetry, canVoid, dunning, invoiceHistory, type InvoiceRow } from "../billing"
import { money } from "../money"
import { dateY } from "../logic"
import { INVOICE_STATUS } from "../types"
import type { InvoiceEvent } from "../types"
import { tenantPath } from "../tenant-360"
import { SlugConfirmDialog } from "./slug-confirm-dialog"

// Invoice detail sheet (Task 6): lines, dunning schedule, history and the billing.write actions. Independent of the
// ledger (props in, callbacks out), so the tenant 360 billing tab (Task 5) reuses it. The reason dialogs live here;
// the caller applies the change (billing.ts) and writes the audit entry.

const EVENT: Record<InvoiceEvent["kind"], string> = {
  issued: "Invoice issued",
  charged: "Payment succeeded",
  charge_failed: "Payment failed",
  marked_paid: "Marked paid",
  refunded: "Refunded",
  voided: "Voided",
}
const STEP: Record<"failed" | "next" | "planned", string> = { failed: "Failed", next: "Next retry", planned: "Planned" }

type Dialog = "paid" | "refund" | "void" | null

export type InvoiceSheetProps = {
  invoice: InvoiceRow | null
  open: boolean
  onOpenChange(o: boolean): void
  /** billing.write: show the actions. */
  canWrite: boolean
  /** Payment provider name, e.g. "Stripe". */
  provider: string
  tzLabel: string
  onRetry(i: InvoiceRow): void
  onMarkPaid(i: InvoiceRow, reason: string): void
  onRefund(i: InvoiceRow, reason: string): void
  onVoid(i: InvoiceRow, reason: string): void
}

const at = (iso: string) => `${dateY(iso)}, ${formatTime(iso)}`

export function InvoiceSheet({ invoice: i, open, onOpenChange, canWrite, provider, tzLabel, onRetry, onMarkPaid, onRefund, onVoid }: InvoiceSheetProps) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const d = i ? dunning(i) : null
  const history = i ? invoiceHistory(i).slice().reverse() : []
  const actions = i && canWrite && (canRetry(i) || canRefund(i))

  return (
    <>
      <DetailSheet
        open={open && !!i}
        onOpenChange={onOpenChange}
        title={i ? `Invoice ${i.number}` : "Invoice"}
        subtitle={i && (
          <span className="pf-inv-pills">
            <StatusPill status={INVOICE_STATUS[i.status]} />
            <span className="num pf-inv-total">{money(i.amount, i.currency)}</span>
            <CopyId value={i.number} what="invoice number" />
          </span>
        )}
        footer={
          actions && i ? (
            <>
              {/* D7 fails closed: a refund needs the tenant slug for type-to-confirm, so without one it stays disabled. */}
              {canRefund(i) && (
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!i.tenantSlug}
                  aria-describedby={i.tenantSlug ? undefined : "pf-inv-norefund"}
                  onClick={() => setDialog("refund")}
                >
                  Refund
                </button>
              )}
              {canVoid(i) && <button type="button" className="btn btn-outline" disabled={!i.tenantSlug} onClick={() => setDialog("void")}>Void</button>}
              {canMarkPaid(i) && <button type="button" className="btn btn-outline" onClick={() => setDialog("paid")}>Mark paid</button>}
              {canRetry(i) && (
                <button type="button" className="btn btn-primary" onClick={() => onRetry(i)} title={i.hasPaymentMethod ? undefined : "No payment method on file: the charge will fail"}>
                  Retry payment
                </button>
              )}
            </>
          ) : undefined
        }
      >
        {i && (
          <>
            {canWrite && canRefund(i) && !i.tenantSlug && (
              <p id="pf-inv-norefund" className="pf-inv-why" role="note">Refund is unavailable: this invoice&apos;s tenant has no slug to confirm against.</p>
            )}
            <dl className="pf-inv-dl">
              <div><dt>Tenant</dt><dd><Link href={tenantPath(i.tenantId, "billing")} className="pf-link">{i.tenantName}</Link></dd></div>
              <div><dt>Issued</dt><dd className="num">{dateY(i.issuedAt)}</dd></div>
              <div><dt>Due</dt><dd className="num">{dateY(i.dueAt)}</dd></div>
              <div><dt>Payment method</dt><dd>{i.paymentMethod || "None on file"}{i.paymentMethod ? <span className="pf-inv-via"> · {provider}</span> : null}</dd></div>
              <div><dt>Charge attempts</dt><dd className="num">{i.attempts}</dd></div>
            </dl>

            <section aria-labelledby="pf-inv-lines-h">
              <h3 id="pf-inv-lines-h" className="pf-inv-sub">Lines</h3>
              <ul className="pf-inv-lines">
                {i.lines.map((l, k) => (
                  <li key={k}><span>{l.label}</span><span className="num">{money(l.amount, i.currency)}</span></li>
                ))}
                <li className="pf-inv-sum"><span>Total</span><span className="num">{money(i.amount, i.currency)}</span></li>
              </ul>
            </section>

            {d && (
              <section aria-labelledby="pf-inv-dun-h">
                <h3 id="pf-inv-dun-h" className="pf-inv-sub">Retry schedule</h3>
                <ol className="pf-dun">
                  {d.steps.map((s) => (
                    <li key={s.attempt} data-state={s.state}>
                      <i aria-hidden="true" />
                      <span className="pf-dun-t">Attempt {s.attempt} of {Math.max(DUNNING_MAX, i.attempts)}</span>
                      <span className="pf-dun-m">{STEP[s.state]}{s.at ? ` · ${at(s.at)}` : ""}</span>
                    </li>
                  ))}
                </ol>
                {d.suggestSuspend && (
                  <div className="pf-dun-hint" role="note">
                    <Icon name="lock" />
                    <div>
                      <b>All {DUNNING_MAX} attempts failed.</b> Consider suspending {i.tenantName}. Nothing happens automatically.
                      <Link href={tenantPath(i.tenantId, "settings")} className="pf-link pf-dun-go">Review in tenant settings</Link>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section aria-labelledby="pf-inv-hist-h">
              <h3 id="pf-inv-hist-h" className="pf-inv-sub">History</h3>
              <ol className="pf-inv-hist">
                {history.map((e, k) => (
                  <li key={k}>
                    <span className="pf-inv-ev">{EVENT[e.kind]}{e.attempt ? ` (attempt ${e.attempt})` : ""}</span>
                    <span className="pf-inv-when"><time dateTime={e.at}>{at(e.at)}</time> {tzLabel}{e.by ? ` · ${e.by}` : ""}</span>
                    {e.reason && <span className="pf-inv-why">{e.reason}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </DetailSheet>

      {i && canWrite && (
        <>
          <SlugConfirmDialog
            open={dialog === "paid"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Mark ${i.number} paid?`}
            text={`Use this when ${i.tenantName} paid outside ${provider}, e.g. by bank transfer. Retries stop. The reason is recorded in the platform audit trail.`}
            reason
            confirmLabel="Mark paid"
            onConfirm={(r) => onMarkPaid(i, r)}
          />
          <SlugConfirmDialog
            open={dialog === "refund" && !!i.tenantSlug}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Refund ${money(i.amount, i.currency)} to ${i.tenantName}?`}
            text={`The full amount of ${i.number} goes back through ${provider}. This can't be undone. The reason is recorded in the platform audit trail.`}
            reason
            slug={i.tenantSlug}
            confirmLabel="Refund"
            destructive
            onConfirm={(r) => onRefund(i, r)}
          />
          <SlugConfirmDialog
            open={dialog === "void" && !!i.tenantSlug}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Void ${i.number}?`}
            text={`${i.tenantName} no longer owes this invoice and retries stop. The reason is recorded in the platform audit trail.`}
            reason
            slug={i.tenantSlug}
            confirmLabel="Void invoice"
            destructive
            onConfirm={(r) => onVoid(i, r)}
          />
        </>
      )}
    </>
  )
}
