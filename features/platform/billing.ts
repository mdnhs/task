import { REASON_MIN } from "./constants"
import { monthKey } from "./metrics"
import { requireStaff } from "./permissions"
import type { BillingView, Invoice, InvoiceEvent, InvoiceSort, InvoiceStatus, PlatformSeed, StaffMember, TenantStatus } from "./types"

// Billing ledger and dunning (Task 6, /platform/billing). Pure: the actions take an invoice and return a new one with
// the change recorded in `events`; the caller writes it as a patch (store.ts → invoicePatchStore) plus an audit entry.
// The tenant 360 billing tab (Task 5) reuses the actions, the history and the dunning schedule.

/** Automatic charge attempts before dunning stops and suggests suspension (never automatic). */
export const DUNNING_MAX = 3
/** Days between automatic retries. */
export const RETRY_DAYS = 3

/** Wall-clock ISO (no zone) plus whole days, on the wall clock: a 23:30 retry stays at 23:30 across a month end. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 19)}Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 19)
}

const CHARGE = new Set<InvoiceEvent["kind"]>(["charged", "charge_failed"])
const PAID = new Set<InvoiceEvent["kind"]>(["charged", "marked_paid"])

export const canRetry = (i: Pick<Invoice, "status">) => i.status === "open" || i.status === "failed"
export const canMarkPaid = canRetry
export const canVoid = canRetry
export const canRefund = (i: Pick<Invoice, "status">) => i.status === "paid"

function need(ok: boolean, what: string, i: Invoice) {
  if (!ok) throw new Error(`Cannot ${what} invoice ${i.number}: it is ${i.status}`)
}
function reasonOf(reason: string): string {
  const r = reason.trim()
  if (r.length < REASON_MIN) throw new Error(`A reason of at least ${REASON_MIN} characters is required`)
  return r
}
const withEvent = (i: Invoice, e: InvoiceEvent, patch: Partial<Invoice>): Invoice => ({ ...i, ...patch, events: [...(i.events ?? []), e] })

/** One charge attempt through the provider. Mock outcome: it succeeds when the tenant has a payment method on file.
 *  A failure schedules the next retry RETRY_DAYS out, until the DUNNING_MAX-th failure (no further retry). */
export function retryPayment(i: Invoice, o: { at: string; hasPaymentMethod: boolean; actor: string }): Invoice {
  need(canRetry(i), "retry", i)
  const attempt = i.attempts + 1
  if (o.hasPaymentMethod) return withEvent(i, { at: o.at, kind: "charged", attempt, by: o.actor }, { status: "paid", attempts: attempt, nextRetryAt: null })
  return withEvent(i, { at: o.at, kind: "charge_failed", attempt, by: o.actor }, {
    status: "failed", attempts: attempt, nextRetryAt: attempt >= DUNNING_MAX ? null : addDays(o.at, RETRY_DAYS),
  })
}

type Manual = { at: string; actor: string; reason: string }

/** Paid outside the provider (bank transfer…). No charge attempt is added. */
export function markPaid(i: Invoice, o: Manual): Invoice {
  need(canMarkPaid(i), "mark paid", i)
  return withEvent(i, { at: o.at, kind: "marked_paid", by: o.actor, reason: reasonOf(o.reason) }, { status: "paid", nextRetryAt: null })
}

export function refund(i: Invoice, o: Manual): Invoice {
  need(canRefund(i), "refund", i)
  return withEvent(i, { at: o.at, kind: "refunded", by: o.actor, reason: reasonOf(o.reason) }, { status: "refunded", nextRetryAt: null })
}

export function voidInvoice(i: Invoice, o: Manual): Invoice {
  need(canVoid(i), "void", i)
  return withEvent(i, { at: o.at, kind: "voided", by: o.actor, reason: reasonOf(o.reason) }, { status: "void", nextRetryAt: null })
}

/** The status before the console's first recorded event (the seed's own state). */
function seedState(i: Invoice): { status: InvoiceStatus; attempts: number } {
  const ev = i.events ?? []
  if (!ev.length) return { status: i.status, attempts: i.attempts }
  const attempts = i.attempts - ev.filter((e) => CHARGE.has(e.kind)).length
  return { status: ev[0].kind === "refunded" ? "paid" : attempts > 0 ? "failed" : "open", attempts }
}

/** Issue, charge attempts and manual actions, oldest first. The seed records no attempt dates: attempt 1 is on the due
 *  date and each retry RETRY_DAYS later; a seed refund or void has no date of its own, so the due date stands in. */
export function invoiceHistory(i: Invoice): InvoiceEvent[] {
  const s = seedState(i)
  const out: InvoiceEvent[] = [{ at: i.issuedAt, kind: "issued" }]
  for (let k = 1; k <= s.attempts; k++) {
    const last = k === s.attempts
    out.push({ at: addDays(i.dueAt, RETRY_DAYS * (k - 1)), kind: last && (s.status === "paid" || s.status === "refunded") ? "charged" : "charge_failed", attempt: k })
  }
  if (!i.events?.length && (s.status === "refunded" || s.status === "void")) out.push({ at: i.dueAt, kind: s.status === "refunded" ? "refunded" : "voided" })
  return [...out, ...(i.events ?? [])]
}

/** When the money arrived (the last successful charge or manual payment); null when it is not paid. */
export function paidAt(i: Invoice): string | null {
  if (i.status !== "paid") return null
  return invoiceHistory(i).filter((e) => PAID.has(e.kind)).at(-1)?.at ?? i.dueAt
}

export type DunningStep = { attempt: number; at: string | null; state: "failed" | "next" | "planned" }
export type Dunning = { steps: DunningStep[]; suggestSuspend: boolean }

/** A failed invoice's retry schedule: past attempts, the next retry, then the planned ones. The DUNNING_MAX-th failure
 *  suggests suspension (a link to the tenant's settings; nothing happens on its own). Null when nothing is failing. */
export function dunning(i: Invoice): Dunning | null {
  if (i.status !== "failed") return null
  const tries = invoiceHistory(i).filter((e) => CHARGE.has(e.kind))
  const steps: DunningStep[] = []
  for (let k = 1; k <= Math.max(DUNNING_MAX, i.attempts); k++) {
    if (k <= i.attempts) steps.push({ attempt: k, at: tries[k - 1]?.at ?? null, state: "failed" })
    else if (k === i.attempts + 1) steps.push({ attempt: k, at: i.nextRetryAt, state: "next" })
    else steps.push({ attempt: k, at: i.nextRetryAt ? addDays(i.nextRetryAt, RETRY_DAYS * (k - i.attempts - 1)) : null, state: "planned" })
  }
  return { steps, suggestSuspend: i.attempts >= DUNNING_MAX }
}

// ---------- Ledger ----------

export type Total = { amount: number; count: number }
export type BillingSummary = { collected: Total; open: Total; failed: Total; refunded: Total }

/** D11: totals across tenants in the platform currency. Collected = paid this month (platform clock, by payment date);
 *  open, failed and refunded are what stands now. Every seed invoice is in EUR, so no conversion is needed yet. */
export function billingSummary(invoices: Invoice[], month: string): BillingSummary {
  const t = (): Total => ({ amount: 0, count: 0 })
  const s: BillingSummary = { collected: t(), open: t(), failed: t(), refunded: t() }
  const add = (x: Total, i: Invoice) => { x.amount += i.amount; x.count++ }
  for (const i of invoices) {
    if (i.status === "paid") {
      const at = paidAt(i)
      if (at && monthKey(at) === month) add(s.collected, i)
    } else if (i.status === "open" || i.status === "failed" || i.status === "refunded") add(s[i.status], i)
  }
  return s
}

export const BILLING_VIEWS: { value: BillingView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "failed", label: "Failed (dunning)" },
  { value: "refunded", label: "Refunded" },
]
export const isBillingView = (v: unknown): v is BillingView => BILLING_VIEWS.some((x) => x.value === v)
const inView = (i: Pick<Invoice, "status">, v: BillingView) => v === "all" || i.status === v
export const billingViewCounts = (rows: Pick<Invoice, "status">[]) =>
  Object.fromEntries(BILLING_VIEWS.map((v) => [v.value, rows.filter((r) => inView(r, v.value)).length])) as Record<BillingView, number>

export function filterInvoices<R extends Pick<Invoice, "id" | "number" | "status"> & { tenantName?: string }>(rows: R[], f: { view: BillingView; q: string }): R[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => inView(r, f.view) && (!q || [r.number, r.id, r.tenantName ?? ""].some((x) => x.toLowerCase().includes(q))))
}

export const DEFAULT_INVOICE_SORT: InvoiceSort = { key: "issued", dir: "desc" }
const STATUS_RANK: Record<InvoiceStatus, number> = { failed: 0, open: 1, paid: 2, refunded: 3, void: 4 }
const byNumber = (a: { number: string }, b: { number: string }) => a.number.localeCompare(b.number, "en", { numeric: true })

/** Ties fall back to the invoice number; an invoice with no retry sorts after every dated one. The input is not changed. */
export function sortInvoices<R extends Invoice & { tenantName: string }>(rows: R[], s: InvoiceSort): R[] {
  const key = (r: R): string | number => {
    switch (s.key) {
      case "number": return 0
      case "tenant": return r.tenantName.toLowerCase()
      case "issued": return r.issuedAt
      case "due": return r.dueAt
      case "amount": return r.amount
      case "status": return STATUS_RANK[r.status]
      case "attempts": return r.attempts
      case "next": return r.nextRetryAt ?? ""
    }
  }
  const sign = s.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    if (s.key === "number") return sign * byNumber(a, b)
    if (s.key === "next" && !a.nextRetryAt !== !b.nextRetryAt) return a.nextRetryAt ? -1 : 1
    const x = key(a)
    const y = key(b)
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))
    return sign * c || byNumber(a, b)
  })
}

// ---------- View model (server) ----------

/** A ledger row: the invoice plus the tenant facts the ledger and the sheet show. */
/** `tenantStatus`: the tenant's status on the server, the fallback for the payment-recovered rule (invoice-actions.ts). */
export type InvoiceRow = Invoice & { tenantName: string; tenantSlug: string; tenantStatus: TenantStatus; paymentMethod: string; hasPaymentMethod: boolean }

/**
 * Controller ruling (Task 5 fix 1): after a payment (retry or mark paid), a past-due tenant is active again once none
 * of its invoices is failed and no open one is overdue (`dueAt` before `now`). `invoices` = the tenant's invoices with
 * the change applied.
 */
export function recoversTenant(status: TenantStatus, invoices: Pick<Invoice, "status" | "dueAt">[], now: string): boolean {
  return status === "past_due" && !invoices.some((i) => i.status === "failed" || (i.status === "open" && i.dueAt < now))
}
export type BillingData = {
  invoices: InvoiceRow[]
  /** Payment provider (platform settings), for the subtitle and the retry toast. */
  provider: { name: string; mode: string }
  /** `write` = billing.write: retry, mark paid, refund, void. */
  can: { write: boolean }
}

/** "None on file" (the seed's wording) or empty = no payment method to charge. */
export const hasPaymentMethod = (pm: string | undefined) => !!pm && !/^none\b/i.test(pm.trim())

/** The /platform/billing view model: invoices with tenant names and payment state only; no usage, contacts or audit log. */
export function billingData(seed: Pick<PlatformSeed, "tenants" | "invoices">, op: StaffMember, payments: { provider: string; mode: string }): BillingData {
  const byId = new Map(seed.tenants.map((t) => [t.id, t]))
  return {
    invoices: seed.invoices.map((i) => {
      const t = byId.get(i.tenantId)
      const pm = t?.billing.paymentMethod ?? ""
      return { ...i, tenantName: t?.name ?? i.tenantId, tenantSlug: t?.slug ?? "", tenantStatus: t?.status ?? "active", paymentMethod: pm, hasPaymentMethod: hasPaymentMethod(pm) }
    }),
    provider: { name: payments.provider, mode: payments.mode },
    can: { write: requireStaff(op, "billing.write") },
  }
}
