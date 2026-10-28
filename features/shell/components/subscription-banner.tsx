import Link from "next/link"

import { formatDate } from "@/lib/dates"
import type { Tenant } from "@/lib/types"

// Shown above every page when the company's subscription needs attention (FR-SAAS-08).
export function SubscriptionBanner({ tenant, tzLabel }: { tenant: Tenant; tzLabel: string }) {
  if (tenant.status === "trial") {
    return (
      <div className="sub-banner" role="status">
        <span>
          Trial ends {tenant.trialEndsOn ? formatDate(tenant.trialEndsOn) : "soon"} ({tzLabel})
        </span>
        <Link href="/settings/billing">Choose a plan</Link>
      </div>
    )
  }
  if (tenant.status === "past_due") {
    return (
      <div className="sub-banner" data-tone="warn" role="status">
        <span>
          Payment failed. Update billing by {tenant.graceEndsOn ? formatDate(tenant.graceEndsOn) : "the grace date"} to
          keep full access.
        </span>
        <Link href="/settings/billing">Update billing</Link>
      </div>
    )
  }
  if (tenant.status === "suspended") {
    return (
      <div className="sub-banner" data-tone="danger" role="status">
        <span>Read-only: subscription inactive. You can still export data.</span>
        <Link href="/settings/billing">Reactivate</Link>
      </div>
    )
  }
  return null
}
