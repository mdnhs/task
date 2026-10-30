"use client"

import { formatDate } from "@/lib/dates"
import { PLATFORM_LOCALE } from "../../constants"
import type { T360Head, UsageTab } from "../../tenant-360"
import { useLiveTenant } from "./live"
import { UsageChart, meterState } from "./usage-chart"

const num = (n: number) => n.toLocaleString(PLATFORM_LOCALE)

// Usage tab: 90 days per metric against the plan limit. Users and storage are daily levels; messages and transcription
// are month-to-date totals against the monthly allowance (tenant-360.ts → usageSeries).
export function UsageTabView({ head, data }: { head: T360Head; data: UsageTab }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const plan = head.plans.find((p) => p.id === t.plan)
  return (
    <div className="pf-usage-grid">
      {data.metrics.map((m) => {
        const limit = plan?.limits[m.key]
        const state = meterState(m.used, limit)
        const unit = m.unit ? ` ${m.unit}` : ""
        const pct = limit ? Math.round((m.used / limit) * 100) : null
        const first = m.series[0]?.date
        const last = m.series[m.series.length - 1]?.date
        return (
          <section key={m.key} className="card chart-card" aria-labelledby={`pf-u-${m.key}-h`}>
            <div className="card-head">
              <div>
                <h2 id={`pf-u-${m.key}-h`}>{m.label}</h2>
                <div className="sub">{m.kind === "flow" ? "Month to date, against the monthly allowance" : "Daily, against the plan limit"}</div>
              </div>
              <div className="pf-usage-now num" data-state={state}>
                <b>{num(m.used)}</b> / {limit !== undefined ? num(limit) : "—"}{unit}
                {pct !== null && <span>{pct}%</span>}
              </div>
            </div>
            <UsageChart metric={m} limit={limit} variant="full" />
            <div className="sr-only">
              <table>
                <caption>{m.label} from {first ? formatDate(first) : ""} to {last ? formatDate(last) : ""}</caption>
                <thead><tr><th scope="col">Day</th><th scope="col">{m.kind === "flow" ? "Month to date" : m.label}</th></tr></thead>
                <tbody>
                  {m.series.map((p) => <tr key={p.date}><th scope="row">{p.date}</th><td>{num(p.value)}{unit}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
