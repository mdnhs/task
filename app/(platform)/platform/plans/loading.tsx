import { DeniedSkeleton, PlansSkeleton, getPlatformSeed, plansData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { skeletonGate } from "../../skeleton-gate"

// Same gate and view model as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await skeletonGate("billing.read", "platform plans")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, org] = await Promise.all([getPlatformSeed(), getOrg()])
  return <PlansSkeleton data={plansData(seed, g.op)} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
