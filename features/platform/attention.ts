import { daysBetween } from "@/lib/dates"
import { planOf } from "./logic"
import { money } from "./money"
import { LIMITS } from "./types"
import type { PlatformSeed } from "./types"

// The overview's "Needs attention" list (Task 3): computed from the seed, never stored.

/** Trials ending and data requests falling due within this many days are listed. */
export const ATTENTION_DAYS = 7
/** A tenant at or above this share of any plan limit is listed (the tenant usage meter's "near limit" mark). */
export const LIMIT_SHARE = 0.9

export type AttentionKind = "past_due" | "trial_ending" | "limit" | "support" | "data_request"
export type AttentionItem = {
  id: string
  kind: AttentionKind
  tenantId: string
  tenant: string
  detail: string
  /** The deadline (or, for a support request, when it was asked for). null for limits. */
  due: string | null
  /** Short time text for the row: "In 5 days", "2 days overdue", "Waiting 1 day". */
  when: string | null
  href: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const tenantHref = (id: string, tab?: string) => `/platform/tenants/${encodeURIComponent(id)}${tab ? `/${tab}` : ""}`

export function dueLabel(due: string, today: string): string {
  const d = daysBetween(due, today)
  if (d === 0) return "Today"
  if (d === 1) return "Tomorrow"
  if (d > 1) return `In ${d} days`
  return `${plural(-d, "day", "days")} overdue`
}

function waitingLabel(since: string, today: string): string {
  const d = daysBetween(today, since)
  return d <= 0 ? "Since today" : `Waiting ${plural(d, "day", "days")}`
}

/** Past-due row text. Without failed invoices on record (data lag) it says only that payment is past due. */
function pastDueDetail(owed: number, currency: string, failed: number, amounts: boolean): string {
  if (failed === 0) return "Payment past due"
  const n = plural(failed, "failed payment", "failed payments")
  return amounts ? `${money(owed, currency)} overdue · ${n}` : n
}

// Dates come as bare days ("2026-10-26") and as date-times; compare them on one form.
const day = (iso: string) => (iso.length === 10 ? `${iso}T00:00:00` : iso)
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

type Input = Pick<PlatformSeed, "tenants" | "plans" | "invoices" | "requests" | "dataRequests">

/**
 * Overdue money first (largest amount owed first), then everything with a date, soonest first (overdue data requests,
 * the longest-waiting support requests, trials about to end), then tenants near a plan limit (fullest first).
 */
export function attentionItems(
  { tenants, plans, invoices, requests, dataRequests }: Input,
  today: string,
  /** `amounts: false` leaves money out of the rows (staff without billing.read; D3). */
  { amounts = true }: { amounts?: boolean } = {},
): AttentionItem[] {
  const name = new Map(tenants.map((t) => [t.id, t.name]))
  const within = (iso: string) => daysBetween(iso, today) <= ATTENTION_DAYS

  const pastDue: { item: AttentionItem; owed: number }[] = tenants
    .filter((t) => t.status === "past_due")
    .map((t) => {
      const failed = invoices.filter((i) => i.tenantId === t.id && i.status === "failed")
      const owed = failed.reduce((s, i) => s + i.amount, 0)
      const currency = failed[0]?.currency ?? planOf(plans, t.plan)?.currency ?? ""
      const grace = t.billing.graceEndsOn ?? null
      return { owed, item: {
        id: `pay-${t.id}`, kind: "past_due" as const, tenantId: t.id, tenant: t.name,
        detail: pastDueDetail(owed, currency, failed.length, amounts),
        due: grace, when: grace ? (daysBetween(grace, today) < 0 ? "Grace period over" : `Grace ends ${dueLabel(grace, today).toLowerCase()}`) : null, href: tenantHref(t.id, "billing"),
      } }
    })
    .sort((a, b) => b.owed - a.owed || a.item.tenant.localeCompare(b.item.tenant))

  const dated: AttentionItem[] = [
    ...tenants
      .filter((t) => t.status === "trial" && t.billing.trialEndsOn && within(t.billing.trialEndsOn))
      .map((t): AttentionItem => {
        const end = t.billing.trialEndsOn as string
        return { id: `trial-${t.id}`, kind: "trial_ending", tenantId: t.id, tenant: t.name, detail: "Trial ends", due: end, when: dueLabel(end, today), href: tenantHref(t.id) }
      }),
    ...requests
      .filter((r) => r.status === "requested")
      .map((r): AttentionItem => ({
        id: `sup-${r.id}`, kind: "support", tenantId: r.tenantId, tenant: name.get(r.tenantId) ?? r.tenantId,
        detail: "Support access awaiting approval", due: r.requestedAt, when: waitingLabel(r.requestedAt, today), href: "/platform/support",
      })),
    ...dataRequests
      .filter((r) => (r.status === "received" || r.status === "in_progress") && within(r.dueAt))
      .map((r): AttentionItem => ({
        id: `dsr-${r.id}`, kind: "data_request", tenantId: r.tenantId, tenant: name.get(r.tenantId) ?? r.tenantId,
        detail: `${r.kind[0].toUpperCase()}${r.kind.slice(1)} request due`, due: r.dueAt, when: dueLabel(r.dueAt, today), href: "/platform/data-requests",
      })),
  ].sort((a, b) => cmp(day(a.due as string), day(b.due as string)))

  const limits = tenants
    .filter((t) => t.status !== "suspended")
    .flatMap((t) => {
      const plan = planOf(plans, t.plan)
      if (!plan) return []
      const full = LIMITS.map((l) => ({ label: l.label, share: plan.limits[l.key] > 0 ? t[l.used] / plan.limits[l.key] : 0 }))
        .filter((l) => l.share >= LIMIT_SHARE)
        .sort((a, b) => b.share - a.share)
      if (!full.length) return []
      const more = full.length > 1 ? ` · ${plural(full.length - 1, "more limit", "more limits")}` : ""
      return [{
        item: {
          id: `limit-${t.id}`, kind: "limit" as const, tenantId: t.id, tenant: t.name,
          detail: `${full[0].label} at ${Math.round(full[0].share * 100)}% of the plan limit${more}`, due: null, when: null, href: tenantHref(t.id, "usage"),
        },
        share: full[0].share,
      }]
    })
    .sort((a, b) => b.share - a.share || a.item.tenant.localeCompare(b.item.tenant))
    .map((x) => x.item)

  return [...pastDue.map((x) => x.item), ...dated, ...limits]
}
