import { DeniedSkeleton, PlanNewSkeleton, getPlatformSeed } from "@/features/platform"

import { gate } from "../../../gate"

export default async function Loading() {
  const g = await gate("plans.write", "platform plan editing")
  if ("denied" in g) return <DeniedSkeleton />
  const { plans, entitlements } = await getPlatformSeed()
  // The new plan takes the first plan's currency (see NewPlanForm).
  return <PlanNewSkeleton modules={entitlements.productModules.map((m) => m.label)} currency={plans[0]?.currency} />
}
