import { LocationsSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { locationAdminGate } from "./gate"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

export default async function Loading() {
  const g = await locationAdminGate(await getSkeletonSession(), await getSkeletonUser())
  if (!g) return <PageSkeleton />
  return <LocationsSkeleton data={g.data} scopeKey={g.scopeKey} />
}
