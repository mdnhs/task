import { DeniedSkeleton, SupportSkeleton, getPlatformSeed, supportData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

// Same gate and view model as the page: no audit lines without audit.read, and a denied role gets no data at all.
export default async function Loading() {
  const g = await gate("support.request", "platform support access")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, org] = await Promise.all([getPlatformSeed(), getOrg()])
  const { requests, audit, tenants } = supportData(seed, g.op)
  return <SupportSkeleton requests={requests} audit={audit} tenants={tenants} today={org.today} tzLabel={org.tzLabel} tz={org.timezone} />
}
