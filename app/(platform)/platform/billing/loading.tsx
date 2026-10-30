import { BillingSkeleton, DeniedSkeleton, billingData, getPlatformSeed, getPlatformSettings, isBillingView } from "@/features/platform"
import { getOrg } from "@/lib/org"
import { requestParam } from "@/lib/request-path"

import { gate } from "../../gate"

// Same gate, view model and saved view (`?view=`, forwarded by proxy.ts) as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await gate("billing.read", "platform billing")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, settings, org, view] = await Promise.all([getPlatformSeed(), getPlatformSettings(), getOrg(), requestParam("view")])
  return (
    <BillingSkeleton
      data={billingData(seed, g.op, settings.payments)}
      view={isBillingView(view) ? view : "all"}
      today={org.today}
      tzLabel={org.tzLabel}
      operator={{ name: g.op.name, role: g.op.role }}
    />
  )
}
