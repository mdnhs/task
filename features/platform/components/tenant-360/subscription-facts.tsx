import { dateY } from "../../logic"
import { money } from "../../money"
import type { PlanLite } from "../../tenant-360"
import type { PlatformTenant } from "../../types"

// MOCK (I16): the subscription facts of the unbacked billing tab (seed data, amounts with billing.read). The live overview is LiveOverviewTab in ../live-360.tsx.

const paying = (t: PlatformTenant) => t.status === "active" || t.status === "past_due"

/** The next billing date line: renewal, trial end or nothing. */
export function billingDate(t: PlatformTenant): { label: string; iso: string } | null {
  if (t.billing.renewsOn) return { label: t.cancelAtPeriodEnd ? "Ends" : "Renews", iso: t.billing.renewsOn }
  if (t.billing.trialEndsOn) return { label: "Trial ends", iso: t.billing.trialEndsOn }
  return null
}

/** Subscription facts shared by the overview and billing tabs. Amounts only with billing.read. */
export function SubscriptionFacts({ t, plan, amounts, tzLabel }: { t: PlatformTenant; plan: PlanLite | undefined; amounts: boolean; tzLabel: string }) {
  const date = billingDate(t)
  const mrr = plan?.priceMonthly != null && paying(t) ? plan.priceMonthly : 0
  return (
    <dl className="pf-meta">
      <div><dt>Plan</dt><dd>{plan?.name ?? t.plan}</dd></div>
      {amounts && plan?.priceMonthly != null && <div><dt>Price</dt><dd className="num">{money(plan.priceMonthly, plan.currency)} / month</dd></div>}
      {amounts && <div><dt>MRR</dt><dd className="num">{mrr ? money(mrr, plan!.currency) : "—"}</dd></div>}
      {date && <div><dt>{date.label}</dt><dd className="num">{dateY(date.iso)} {tzLabel}</dd></div>}
      {t.billing.graceEndsOn && t.status === "past_due" && <div><dt>Grace period ends</dt><dd className="num">{dateY(t.billing.graceEndsOn)} {tzLabel}</dd></div>}
      <div><dt>Created</dt><dd className="num">{dateY(t.createdAt)}</dd></div>
      {t.suspendedAt && <div><dt>Suspended</dt><dd className="num">{dateY(t.suspendedAt)} {tzLabel}</dd></div>}
    </dl>
  )
}
