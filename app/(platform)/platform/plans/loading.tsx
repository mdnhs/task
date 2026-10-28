import { PlansSkeleton, getPlatformSeed } from "@/features/platform"

export default async function Loading() {
  const { plans } = await getPlatformSeed()
  return <PlansSkeleton plans={plans.length} modules={plans.map((p) => p.modules.length)} />
}
