import { attentionItems, type AttentionItem } from "./attention"
import { PLATFORM_LOCALE } from "./constants"
import { planOf, tenantMrr } from "./logic"
import { compact, money } from "./money"
import { kpis, monthKey, mrrByTenant, mrrSeries } from "./metrics"
import { filterForStaff, requireStaff } from "./permissions"
import type { AuditEntry, MrrMonth, PlatformSeed, PlatformTenant, StaffMember, SubEvent } from "./types"

// The /platform overview's view model (Task 3). Built on the server from the full seed, so only what the page renders
// (KPI numbers, 12 series rows, the plan mix, attention rows, 8 audit lines) reaches the client.
// Revenue (MRR, ARR, NRR, the MRR series, plan MRR, amounts owed) is computed only for staff roles with billing.read;
// the others get tenant counts only, so no revenue figure is in their payload (D3).

/** Cross-tenant totals are shown in the platform currency (D11). */
export const PLATFORM_CURRENCY = "EUR"
export const OVERVIEW_MONTHS = 12
export const ACTIVITY_COUNT = 8

export type DeltaTone = "good" | "bad" | "flat"
export type Delta = { text: string; tone: DeltaTone }
export type KpiCard = {
  key: string
  title: string
  /** Compact value, split so the number can count up: prefix "€", value "1.6", suffix "k". */
  prefix: string
  value: string
  suffix: string
  /** The exact value (tooltip and screen readers). */
  exact: string
  delta: Delta
  note: string
  /** A second fact under the title (trial conversion). */
  sub?: string
  href: string | null
}
export type SeriesRow = MrrMonth & { label: string }
/** `total` is the plan's MRR with billing.read, else its tenant count; `share` (0-100) is of MRR or of tenants to match. */
export type PlanMixRow = { id: string; name: string; paying: number; trials: number; total: string; share: number; shareLabel: string }
/** The audit fields the overview shows; before/after/reason stay on the server. */
export type ActivityLine = Pick<AuditEntry, "id" | "at" | "actor" | "action" | "target" | "detail">
export type OverviewData = {
  monthLabel: string
  kpis: KpiCard[]
  /** null when the staff role can't read billing (no billing.read). */
  revenue: { currency: string; series: SeriesRow[] } | null
  planMix: PlanMixRow[]
  attention: AttentionItem[]
  /** null when the staff role can't read the audit log. */
  activity: ActivityLine[] | null
}

/** ▲/▼ against the previous period, coloured by meaning (`better` = which direction is good), not by sign (D11). */
export function delta(change: number | null, unit: "pct" | "pts" | "count", better: "up" | "down"): Delta {
  if (change === null) return { text: "No prior month", tone: "flat" }
  const shown = unit === "count" ? Math.abs(Math.round(change)) : Math.round(Math.abs(change) * 10) / 10
  if (shown === 0) return { text: "No change", tone: "flat" }
  const up = change > 0
  const amount = unit === "pct" ? `${shown.toFixed(1)}%` : unit === "pts" ? `${shown.toFixed(1)} pts` : String(shown)
  return { text: `${up ? "▲" : "▼"} ${amount}`, tone: up === (better === "up") ? "good" : "bad" }
}

const monthDate = (key: string) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 1))
// Short = the first three letters ("Sep", as lib/dates prints dates), not en-IE's own short form ("Sept").
const monthName = (key: string, form: "short" | "long") => {
  const long = new Intl.DateTimeFormat(PLATFORM_LOCALE, { month: "long", timeZone: "UTC" }).format(monthDate(key))
  return form === "long" ? long : long.slice(0, 3)
}
const prevMonth = (key: string) => {
  const d = monthDate(key)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}
const addDays = (iso: string, n: number) => {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n))
  return d.toISOString().slice(0, 10)
}

const payingAt = (events: SubEvent[], month: string) => [...mrrByTenant(events, month).values()].filter((v) => v > 0).length

/** Tenants still trialling at the end of `month`: created by then, not yet paying, and the trial runs into the next month. */
function trialsAt(seed: Pick<PlatformSeed, "tenants" | "plans" | "subscriptions">, month: string) {
  const started = new Set(seed.subscriptions.filter((e) => e.kind === "start" && monthKey(e.at) <= month).map((e) => e.tenantId))
  const ends = (t: PlatformTenant) => t.billing.trialEndsOn ?? addDays(t.createdAt, planOf(seed.plans, t.plan)?.trialDays ?? 0)
  return seed.tenants.filter((t) => monthKey(t.createdAt) <= month && !started.has(t.id) && monthKey(ends(t)) > month).length
}

/** Tenants with a failed invoice that had fallen due by the end of `month`. */
const pastDueAt = (seed: Pick<PlatformSeed, "invoices">, month: string) =>
  new Set(seed.invoices.filter((i) => i.status === "failed" && monthKey(i.dueAt) <= month).map((i) => i.tenantId)).size

export function overviewData(seed: PlatformSeed, today: string, op: StaffMember): OverviewData {
  const month = monthKey(today)
  const prev = prevMonth(month)
  const vs = `vs ${monthName(prev, "short")}`
  const cur = PLATFORM_CURRENCY
  const allowed = (href: string) => (filterForStaff([{ href }], op).length ? href : null)
  const canRevenue = requireStaff(op, "billing.read")

  const series = mrrSeries(seed.subscriptions, month, OVERVIEW_MONTHS)
  const k = kpis(series, seed.tenants, seed.subscriptions)
  const count = (n: number) => ({ prefix: "", value: String(n), suffix: "" })
  const paying = seed.tenants.filter((t) => t.status === "active" || t.status === "past_due").length

  const counts: KpiCard[] = [
    {
      key: "active", title: "Active tenants", ...count(paying), exact: String(paying),
      delta: delta(payingAt(seed.subscriptions, month) - payingAt(seed.subscriptions, prev), "count", "up"), note: vs, href: allowed("/platform/tenants"),
    },
    {
      key: "trials", title: "Trials", ...count(k.trials), exact: String(k.trials), delta: delta(k.trials - trialsAt(seed, prev), "count", "up"),
      note: vs, sub: k.trialConversionPct === null ? "No trials decided yet" : `${Math.round(k.trialConversionPct)}% converted`, href: allowed("/platform/tenants"),
    },
    { key: "past_due", title: "Past due", ...count(k.pastDue), exact: String(k.pastDue), delta: delta(k.pastDue - pastDueAt(seed, prev), "count", "down"), note: vs, href: allowed("/platform/billing") },
  ]
  if (!canRevenue) {
    const live = (t: PlatformTenant) => t.status !== "suspended"
    const all = seed.tenants.filter(live).length
    return {
      monthLabel: `${monthName(month, "long")} ${month.slice(0, 4)}`,
      kpis: counts,
      revenue: null,
      planMix: seed.plans.map((p) => {
        const on = seed.tenants.filter((t) => t.plan === p.id && live(t))
        const share = all > 0 ? (on.length / all) * 100 : 0
        return {
          id: p.id, name: p.name, total: `${on.length} ${on.length === 1 ? "tenant" : "tenants"}`, share, shareLabel: `${Math.round(share)}% of tenants`,
          paying: on.filter((t) => t.status === "active" || t.status === "past_due").length, trials: on.filter((t) => t.status === "trial").length,
        }
      }),
      attention: filterForStaff(attentionItems(seed, today, { amounts: false }), op),
      activity: activityFor(seed, op),
    }
  }

  const kPrev = kpis(mrrSeries(seed.subscriptions, prev, OVERVIEW_MONTHS), seed.tenants, seed.subscriptions)
  const cards: KpiCard[] = [
    { key: "mrr", title: "MRR", ...compact(k.mrr, cur), exact: money(k.mrr, cur), delta: delta(k.mrrDeltaPct, "pct", "up"), note: vs, href: allowed("/platform/billing") },
    { key: "arr", title: "ARR", ...compact(k.arr, cur), exact: money(k.arr, cur), delta: delta(k.mrrDeltaPct, "pct", "up"), note: vs, href: allowed("/platform/billing") },
    ...counts,
    {
      key: "nrr", title: "Net revenue retention", prefix: "", value: k.nrrPct === null ? "—" : String(Math.round(k.nrrPct)), suffix: k.nrrPct === null ? "" : "%",
      exact: k.nrrPct === null ? "No prior month" : `${k.nrrPct.toFixed(1)}%`,
      delta: delta(k.nrrPct !== null && kPrev.nrrPct !== null ? k.nrrPct - kPrev.nrrPct : null, "pts", "up"), note: vs, href: allowed("/platform/billing"),
    },
  ]

  const total = seed.tenants.reduce((s, t) => s + tenantMrr(t, seed.plans), 0)
  const planMix = seed.plans.map((p) => {
    const on = seed.tenants.filter((t) => t.plan === p.id)
    const mrr = on.reduce((s, t) => s + tenantMrr(t, seed.plans), 0)
    const share = total > 0 ? (mrr / total) * 100 : 0
    return {
      id: p.id, name: p.name, total: money(mrr, p.currency), share, shareLabel: `${Math.round(share)}% of MRR`,
      paying: on.filter((t) => t.status === "active" || t.status === "past_due").length,
      trials: on.filter((t) => t.status === "trial").length,
    }
  })

  return {
    monthLabel: `${monthName(month, "long")} ${month.slice(0, 4)}`,
    kpis: cards,
    revenue: { currency: cur, series: series.map((s) => ({ ...s, label: monthName(s.month, "short") })) },
    planMix,
    attention: filterForStaff(attentionItems(seed, today, { amounts: true }), op),
    activity: activityFor(seed, op),
  }
}

/** The last audit lines, newest first, with only the fields the card shows. null without audit.read. */
function activityFor(seed: Pick<PlatformSeed, "audit">, op: StaffMember): ActivityLine[] | null {
  if (!requireStaff(op, "audit.read")) return null
  return [...seed.audit]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_COUNT)
    .map(({ id, at, actor, action, target, detail }) => ({ id, at, actor, action, target, detail }))
}
