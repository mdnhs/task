import { PlanEditSkeleton, getPlatformSeed } from "@/features/platform"

// loading.tsx gets no params, so the plan's own values are blocks; labels and module names are the real text.
export default async function Loading() {
  const { plans, entitlements } = await getPlatformSeed()
  const currencies = new Set(plans.map((p) => p.currency))
  return <PlanEditSkeleton modules={entitlements.productModules.map((m) => m.label)} currency={currencies.size === 1 ? plans[0].currency : undefined} />
}
