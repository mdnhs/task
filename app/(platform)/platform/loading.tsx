import { OverviewSkeleton, getPlatformSeed } from "@/features/platform"

export default async function Loading() {
  const { tenants } = await getPlatformSeed()
  return <OverviewSkeleton rows={tenants.length} />
}
