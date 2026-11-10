import { LocationsSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { locationAdminGate } from "./gate"

export default async function Loading() {
  const g = await locationAdminGate()
  if (!g) return <PageSkeleton />
  return <LocationsSkeleton data={g.data} scopeKey={g.scopeKey} />
}
