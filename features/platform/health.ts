import type { Health, Invoice, Plan, PlatformTenant, UsagePoint } from "./types"

const avg = (pts: UsagePoint[]) => (pts.length ? pts.reduce((s, p) => s + p.activeUsers, 0) / pts.length : 0)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** D5: 0-100 customer health with the reasons behind any deductions. Healthy >= 70, Watch 40-69, At risk < 40. */
export function healthScore(t: PlatformTenant, plan: Plan | undefined, usage: UsagePoint[], invoices: Invoice[], openSupport: number): Health {
  let score = 100
  const reasons: string[] = []
  const take = (points: number, reason: string) => {
    score -= points
    reasons.push(reason)
  }

  if (t.status === "suspended") take(50, "Suspended")
  if (t.status === "past_due") take(40, "Payment past due")
  const failed = invoices.filter((i) => i.status === "failed").length
  if (failed > 0) take(Math.min(failed, 2) * 15, plural(failed, "failed payment", "failed payments"))

  if (plan && plan.limits.activeUsers > 0 && t.users / plan.limits.activeUsers > 0.95) take(10, "Near user limit")

  // Usage trend: average daily active users, last 30 days against the 30 before. Skipped without a previous period.
  const recent = avg(usage.slice(-30))
  const before = avg(usage.slice(-60, -30))
  if (usage.length >= 60 && before > 0) {
    const drop = Math.round(((before - recent) / before) * 100)
    if (drop >= 20) take(15, `Usage down ${drop}%`)
  }

  if (openSupport > 0) take(Math.min(openSupport, 3) * 5, plural(openSupport, "open support request", "open support requests"))

  score = Math.max(0, Math.min(100, score))
  return { score, band: score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk", reasons }
}
