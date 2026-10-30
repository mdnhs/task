import { beforeEach, describe, expect, it } from "vitest"

import { recoversTenant, type InvoiceRow } from "../billing"
import { applyPatch } from "../patches"
import { auditOutbox, auditStore, invoicePatchStore, tenantPatchStore, tenantsStore } from "../store"
import type { Invoice, TenantStatus } from "../types"
import { commitInvoice, invoiceActions } from "./invoice-actions"

const NOW = "2026-10-20T09:00:00"
const ctx = { operator: { name: "Aoife Brennan", role: "billing" as const }, today: NOW, provider: { name: "Stripe", mode: "test" } }

const row = (id: string, status: Invoice["status"], over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id, tenantId: "t3", number: `OD-${id}`, issuedAt: "2026-10-02T08:00:00", dueAt: "2026-10-16T08:00:00", amount: 149, currency: "EUR", status,
  attempts: 1, nextRetryAt: null, lines: [], tenantName: "Millbrook", tenantSlug: "millbrook", tenantStatus: "past_due" as TenantStatus,
  paymentMethod: "Card ending 4274", hasPaymentMethod: true, ...over,
})

function resetStores() {
  for (const s of [tenantPatchStore, invoicePatchStore, auditOutbox, auditStore, tenantsStore]) s.reset()
  tenantPatchStore.seed({})
  invoicePatchStore.seed({})
  auditOutbox.seed([])
}

describe("recoversTenant (controller ruling: payment recovered)", () => {
  const inv = (status: Invoice["status"], dueAt = "2026-10-16T08:00:00") => ({ status, dueAt })
  it("is true for a past-due tenant with nothing failed and no overdue open invoice", () => {
    expect(recoversTenant("past_due", [inv("paid"), inv("open", "2026-10-30T08:00:00"), inv("void")], NOW)).toBe(true)
  })
  it("is false while a failed or an overdue open invoice remains", () => {
    expect(recoversTenant("past_due", [inv("paid"), inv("failed")], NOW)).toBe(false)
    expect(recoversTenant("past_due", [inv("paid"), inv("open", "2026-10-19T08:00:00")], NOW)).toBe(false)
  })
  it("only applies to past-due tenants", () => {
    expect(recoversTenant("active", [inv("paid")], NOW)).toBe(false)
    expect(recoversTenant("suspended", [inv("paid")], NOW)).toBe(false)
  })
})

describe("invoiceActions (one write path for ledger, billing tab and header)", () => {
  beforeEach(resetStores)

  it("retry that pays the last failed invoice patches the tenant active and audits tenant.payment_recovered", () => {
    const a = row("A", "failed")
    invoiceActions(ctx, [a, row("B", "paid")]).onRetry(a)
    expect(invoicePatchStore.get()!.A.status).toBe("paid")
    expect(tenantPatchStore.get()!.t3).toEqual({ status: "active" })
    const lines = auditOutbox.get()!
    expect(lines.map((e) => e.action)).toEqual(["tenant.payment_recovered", "invoice.retried"])
    expect(lines[0]).toMatchObject({ tenantId: "t3", staffRole: "billing", before: { status: "past_due" }, after: { status: "active" } })
    expect(lines[1].tenantId).toBe("t3")
  })

  it("mark paid recovers too; a remaining failed invoice keeps the tenant past due", () => {
    const a = row("A", "failed")
    invoiceActions(ctx, [a, row("C", "failed")]).onMarkPaid(a, "Paid by bank transfer")
    expect(tenantPatchStore.get()!.t3).toBeUndefined()
    expect(auditOutbox.get()!.map((e) => e.action)).toEqual(["invoice.marked_paid"])
    resetStores()
    invoiceActions(ctx, [a]).onMarkPaid(a, "Paid by bank transfer")
    expect(tenantPatchStore.get()!.t3?.status).toBe("active")
  })

  it("uses the live tenant status: a tenant already active (patched) is left alone", () => {
    tenantPatchStore.set(() => ({ t3: { status: "active" } }))
    const a = row("A", "failed")
    invoiceActions(ctx, [a]).onRetry(a)
    expect(auditOutbox.get()!.map((e) => e.action)).toEqual(["invoice.retried"])
  })

  it("a failed retry (no payment method) doesn't recover", () => {
    const a = row("A", "failed", { hasPaymentMethod: false })
    invoiceActions(ctx, [a]).onRetry(a)
    expect(invoicePatchStore.get()!.A.status).toBe("failed")
    expect(tenantPatchStore.get()!.t3).toBeUndefined()
  })

  it("refund and void never touch the tenant; D7 lines carry the reason and tenantId", () => {
    const p = row("P", "paid")
    const o = row("O", "open")
    const h = invoiceActions(ctx, [p, o])
    h.onRefund(p, "Charged twice by mistake")
    h.onVoid(o, "Billed in error this month")
    expect(tenantPatchStore.get()).toEqual({})
    expect(auditOutbox.get()!.map((e) => [e.action, e.tenantId, e.reason])).toEqual([
      ["invoice.voided", "t3", "Billed in error this month"],
      ["invoice.refunded", "t3", "Charged twice by mistake"],
    ])
  })

  it("commitInvoice writes the patch and a before/after line", () => {
    const a = row("A", "open")
    commitInvoice(ctx, a, { ...a, status: "void" }, "invoice.voided", "Voided", "Billed in error this month")
    expect(applyPatch(a, invoicePatchStore.get()!.A).status).toBe("void")
    expect(auditOutbox.get()![0]).toMatchObject({ before: { status: "open" }, after: { status: "void" } })
  })
})
