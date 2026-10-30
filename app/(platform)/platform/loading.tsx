import { DeniedSkeleton, OverviewDashboardSkeleton, getPlatformSeed, overviewData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../gate"

// Same gate and view model as the page: a viewer the page will refuse gets no data in the loading HTML either.
export default async function Loading() {
  const g = await gate("tenants.read", "the platform overview")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, org] = await Promise.all([getPlatformSeed(), getOrg()])
  return <OverviewDashboardSkeleton data={overviewData(seed, org.today, g.op)} today={org.today} tzLabel={org.tzLabel} />
}
