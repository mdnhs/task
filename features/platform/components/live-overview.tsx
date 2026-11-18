import Link from "next/link"

import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import type { LiveMetrics } from "../adapters"
import { minorMoney } from "../format"

type Kpi = { key: string; title: string; value: string; sub?: string; href?: string }

/**
 * The console overview on the API (B6 T6.8): the KPIs are GET /v1/platform/metrics. MRR counts active subscriptions only; past due is its own number and is never in MRR (C11). Money is per
 * currency, in the API's integer minor units. A role without billing.read gets no revenue and no metrics in the markup (the API refuses them), only the tenant count.
 * `mock` shows the sample cards that need data the API does not have (plan mix, recent activity, the MRR history): the caller passes them as children on a demo deployment.
 */
export function LiveOverview({ metrics, tenants, canRevenue, mock, children }: { metrics: LiveMetrics | null; tenants: number; canRevenue: boolean; mock: boolean; children?: React.ReactNode }) {
  const kpis: Kpi[] = [{ key: "tenants", title: "Tenants", value: String(tenants), href: "/platform/tenants" }]
  if (canRevenue && metrics) {
    const mrr = metrics.mrr.length ? metrics.mrr : [{ currency: "", minor: 0 }]
    kpis.unshift(
      ...mrr.map((m) => ({ key: `mrr-${m.currency}`, title: mrr.length > 1 ? `MRR ${m.currency}` : "MRR", value: m.currency ? minorMoney(m.minor, m.currency) : "0", sub: "Active subscriptions" })),
      { key: "arr", title: "ARR", value: metrics.arr.length ? metrics.arr.map((a) => minorMoney(a.minor, a.currency)).join(" · ") : "0", sub: "MRR × 12" },
      { key: "trials", title: "Trials", value: String(metrics.trials), href: "/platform/tenants?view=trial" },
      { key: "past_due", title: "Past due", value: String(metrics.pastDue), sub: "Not counted in MRR", href: "/platform/tenants?view=past_due" },
      { key: "churn", title: "Churn", value: String(metrics.churn), sub: "Last 30 days" },
    )
  }
  return (
    <>
      <PageHead title="Overview" subtitle={canRevenue ? "Revenue and tenants across the platform" : "Tenants across the platform"} />
      <section className="stats pf-kpis" aria-label="Platform numbers">
        {kpis.map((k) => (
          <article key={k.key} className="stat">
            <div className="stat-top">
              <div>
                <h3>{k.title}</h3>
                {k.sub && <div className="pf-kpi-sub">{k.sub}</div>}
              </div>
              {k.href && <Link className="arrow" href={k.href} aria-label={`Open ${k.title}`}><Icon name="arrow" /></Link>}
            </div>
            <div className="value num">{k.value}</div>
          </article>
        ))}
      </section>
      {mock && children}
    </>
  )
}
