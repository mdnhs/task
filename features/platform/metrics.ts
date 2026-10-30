import type { MrrMonth, PlatformTenant, SubEvent } from "./types"

/** YYYY-MM of a platform wall-clock ISO string. Plain slicing: no Date, so no UTC shift at month ends. */
export const monthKey = (iso: string) => iso.slice(0, 7)

function addMonths(key: string, n: number): string {
  const total = parseInt(key.slice(0, 4), 10) * 12 + (parseInt(key.slice(5, 7), 10) - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
}

/**
 * MRR by month for the `months` months ending at `endMonth`, computed from the event log (D4).
 * Events before the window still count towards the opening MRR. `new` = start + reactivate; `contraction` and `churn` are negative.
 */
export function mrrSeries(events: SubEvent[], endMonth: string, months: number): MrrMonth[] {
  const first = addMonths(endMonth, -(months - 1))
  const series: MrrMonth[] = Array.from({ length: months }, (_, i) => ({ month: addMonths(first, i), mrr: 0, new: 0, expansion: 0, contraction: 0, churn: 0 }))
  let opening = 0
  for (const e of events) {
    const m = monthKey(e.at)
    if (m < first) opening += e.mrrDelta
    else if (m <= endMonth) {
      const row = series[series.findIndex((s) => s.month === m)]
      if (e.kind === "start" || e.kind === "reactivate") row.new += e.mrrDelta
      else if (e.kind === "upgrade") row.expansion += e.mrrDelta
      else if (e.kind === "downgrade") row.contraction += e.mrrDelta
      else row.churn += e.mrrDelta
    }
  }
  let run = opening
  for (const row of series) {
    run += row.new + row.expansion + row.contraction + row.churn
    row.mrr = run
  }
  return series
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null)

/** Each tenant's MRR at the end of `month`, from the event log (tenants with no events are absent). */
export function mrrByTenant(events: SubEvent[], month: string): Map<string, number> {
  const by = new Map<string, number>()
  for (const e of events) if (monthKey(e.at) <= month) by.set(e.tenantId, (by.get(e.tenantId) ?? 0) + e.mrrDelta)
  return by
}

/** Headline numbers of the last month in a series (kpis). Rates are null when there is no base to divide by. */
export type Kpis = {
  mrr: number
  arr: number
  /** MRR change against the month before, in %. */
  mrrDeltaPct: number | null
  /** Net revenue retention of the tenants already paying at the end of the month before, in %. */
  nrrPct: number | null
  logoChurnPct: number | null
  arpa: number
  trials: number
  trialConversionPct: number | null
  pastDue: number
}

/** Headline numbers for the last month of `series`. Rates are null when there is no base to divide by. */
export function kpis(series: MrrMonth[], tenants: PlatformTenant[], events: SubEvent[]): Kpis {
  const cur = series[series.length - 1]
  const prev = series.length > 1 ? series[series.length - 2] : undefined
  const mrr = cur?.mrr ?? 0
  const paying = tenants.filter((t) => t.status === "active" || t.status === "past_due").length
  const mrrDeltaPct = cur && prev && prev.mrr > 0 ? ((cur.mrr - prev.mrr) / prev.mrr) * 100 : null

  // NRR and logo churn share one starting cohort: the tenants paying at the end of the month before.
  // NRR = (starting MRR + that cohort's expansion - contraction - churn this month) / starting MRR. New tenants
  // (and anything they do in their first month) and reactivations of lapsed tenants are not in the cohort.
  let nrrPct: number | null = null
  let logoChurnPct: number | null = null
  if (cur && prev) {
    const start = mrrByTenant(events, prev.month)
    const cohort = new Set([...start].filter(([, v]) => v > 0).map(([id]) => id))
    const startMrr = [...cohort].reduce((s, id) => s + (start.get(id) ?? 0), 0)
    const moved = events
      .filter((e) => cohort.has(e.tenantId) && monthKey(e.at) === cur.month && (e.kind === "upgrade" || e.kind === "downgrade" || e.kind === "cancel"))
      .reduce((s, e) => s + e.mrrDelta, 0)
    nrrPct = pct(startMrr + moved, startMrr)
    // Logo churn: cohort tenants that cancelled in the last month, over the cohort.
    const lost = new Set(events.filter((e) => e.kind === "cancel" && cohort.has(e.tenantId) && monthKey(e.at) === cur.month).map((e) => e.tenantId)).size
    logoChurnPct = pct(lost, cohort.size)
  }

  // Trial conversion: of tenants created in the window that are no longer trialling, those that ever started paying.
  const months = new Set(series.map((s) => s.month))
  const paid = new Set(events.filter((e) => e.kind === "start").map((e) => e.tenantId))
  const decided = tenants.filter((t) => t.status !== "trial" && months.has(monthKey(t.createdAt)))
  const trialConversionPct = pct(decided.filter((t) => paid.has(t.id)).length, decided.length)

  return {
    mrr,
    arr: mrr * 12,
    mrrDeltaPct,
    nrrPct,
    logoChurnPct,
    arpa: paying > 0 ? mrr / paying : 0,
    trials: tenants.filter((t) => t.status === "trial").length,
    trialConversionPct,
    pastDue: tenants.filter((t) => t.status === "past_due").length,
  }
}
