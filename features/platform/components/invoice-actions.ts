"use client"

import { toast } from "sonner"

import { DUNNING_MAX, markPaid, recoversTenant, refund, retryPayment, voidInvoice, type InvoiceRow } from "../billing"
import { money } from "../money"
import { auditEntry, dateY, nowIso, sensitiveEntry } from "../logic"
import { mergePatch } from "../patches"
import { auditOutbox, invoicePatchStore, tenantPatchStore, tenantsStore, knownAudit } from "../store"
import type { AuditEntry, Invoice, StaffRole, TenantStatus } from "../types"

// One invoice write path for the billing ledger (Task 6), the tenant 360 billing tab and its header (Task 5). Store
// patch contract (store.ts): an invoice patch plus an audit line in the outbox; never the full stores. After a retry or
// mark paid that leaves a past-due tenant with nothing failed or overdue, the tenant is patched back to active and a
// `tenant.payment_recovered` line is written (controller ruling, Task 5 fix round 1).

export type InvoiceActionCtx = { operator: { name: string; role: StaffRole }; today: string; provider: { name: string; mode: string } }

const known = knownAudit

/** Writes the invoice patch and its audit line (D7 with a reason; a retry records who, the role and the change). */
export function commitInvoice(ctx: InvoiceActionCtx, before: InvoiceRow, after: Invoice, action: string, detail: string, reason?: string) {
  const at = nowIso(ctx.today)
  invoicePatchStore.set((all) => ({
    ...all,
    [after.id]: mergePatch(all[after.id], { status: after.status, attempts: after.attempts, nextRetryAt: after.nextRetryAt, events: after.events }),
  }))
  const change = {
    before: { status: before.status, attempts: before.attempts, nextRetryAt: before.nextRetryAt },
    after: { status: after.status, attempts: after.attempts, nextRetryAt: after.nextRetryAt },
  }
  const entry: AuditEntry =
    reason !== undefined
      ? sensitiveEntry(known(), { at, actor: ctx.operator.name, staffRole: ctx.operator.role, tenantId: before.tenantId, action, target: before.tenantName, detail, ...change, reason })
      : { ...auditEntry(known(), at, ctx.operator.name, action, before.tenantName, detail), tenantId: before.tenantId, staffRole: ctx.operator.role, ...change }
  auditOutbox.set((list) => [entry, ...list])
}

/** The tenant's live status: its patch, else the full store record (a full page loaded it), else the server row. */
export function liveTenantStatus(tenantId: string, fallback: TenantStatus): TenantStatus {
  const full = tenantsStore.get()?.find((t) => t.id === tenantId)
  return tenantPatchStore.get()?.[tenantId]?.status ?? full?.status ?? fallback
}

/**
 * After a payment: if the rule says the tenant recovered, patch it to active and audit it. `invoices` = what the caller
 * holds live (it must include every unpaid invoice of the tenant); `paid` is the invoice just paid. Returns whether it did.
 */
export function recoverIfPaidUp(ctx: InvoiceActionCtx, paid: InvoiceRow, after: Invoice, invoices: InvoiceRow[]): boolean {
  const status = liveTenantStatus(paid.tenantId, paid.tenantStatus)
  const mine = invoices.filter((i) => i.tenantId === paid.tenantId).map((i) => (i.id === after.id ? after : i))
  if (!mine.some((i) => i.id === after.id)) mine.push(after)
  const at = nowIso(ctx.today)
  if (!recoversTenant(status, mine, at)) return false
  tenantPatchStore.set((all) => ({ ...all, [paid.tenantId]: mergePatch(all[paid.tenantId], { status: "active" }) }))
  auditOutbox.set((list) => [
    {
      ...auditEntry(known(), at, ctx.operator.name, "tenant.payment_recovered", paid.tenantName, `Payment recovered on ${paid.number}: no failed or overdue invoices left`),
      tenantId: paid.tenantId, staffRole: ctx.operator.role, before: { status }, after: { status: "active" },
    },
    ...list,
  ])
  return true
}

export type InvoiceHandlers = {
  onRetry(i: InvoiceRow): void
  onMarkPaid(i: InvoiceRow, reason: string): void
  onRefund(i: InvoiceRow, reason: string): void
  onVoid(i: InvoiceRow, reason: string): void
}

/** The four invoice actions with their toasts, shared by every caller. `invoices` as for recoverIfPaidUp. */
export function invoiceActions(ctx: InvoiceActionCtx, invoices: InvoiceRow[]): InvoiceHandlers {
  const by = (reason: string) => ({ at: nowIso(ctx.today), actor: ctx.operator.name, reason })
  const amount = (i: InvoiceRow) => money(i.amount, i.currency)
  const recovered = (i: InvoiceRow, out: Invoice) => {
    if (recoverIfPaidUp(ctx, i, out, invoices)) toast.success(`${i.tenantName} is active again`, { description: "No failed or overdue invoices are left." })
  }
  return {
    onRetry(i) {
      const out = retryPayment(i, { at: nowIso(ctx.today), hasPaymentMethod: i.hasPaymentMethod, actor: ctx.operator.name })
      const ok = out.status === "paid"
      commitInvoice(ctx, i, out, "invoice.retried", `Retried ${i.number} (attempt ${out.attempts}): ${ok ? "paid" : "failed"}`)
      const via = `${ctx.provider.name}${ctx.provider.mode === "live" ? "" : `, ${ctx.provider.mode} mode`}`
      if (ok) toast.success(`${i.number} paid`, { description: `${amount(i)} charged via ${via}` })
      else toast.error(`${i.number}: payment failed`, {
        description: out.nextRetryAt ? `No payment method on file. Next retry ${dateY(out.nextRetryAt)}.` : `All ${DUNNING_MAX} attempts have failed.`,
      })
      if (ok) recovered(i, out)
    },
    onMarkPaid(i, reason) {
      const out = markPaid(i, by(reason))
      commitInvoice(ctx, i, out, "invoice.marked_paid", `Marked ${i.number} paid: ${reason}`, reason)
      toast.success(`${i.number} marked paid`)
      recovered(i, out)
    },
    onRefund(i, reason) {
      commitInvoice(ctx, i, refund(i, by(reason)), "invoice.refunded", `Refunded ${amount(i)} on ${i.number}: ${reason}`, reason)
      toast.success(`${amount(i)} refunded to ${i.tenantName}`)
    },
    onVoid(i, reason) {
      commitInvoice(ctx, i, voidInvoice(i, by(reason)), "invoice.voided", `Voided ${i.number}: ${reason}`, reason)
      toast.success(`${i.number} voided`)
    },
  }
}
