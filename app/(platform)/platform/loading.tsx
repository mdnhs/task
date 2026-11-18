import { LiveOverviewSkeleton } from "@/features/platform"

// Static (B6 K1): no data layer, no session. The real overview replaces it.
export default function Loading() {
  return <LiveOverviewSkeleton />
}
