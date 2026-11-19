import { LocationFormSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { mockEnabled } from "@/lib/mock-registry"

// Static (K1, I9): loading.tsx gets no params, so it draws the TYPICAL location form (synthetic, two shift types), never the first location's data.
export default function Loading() {
  if (!mockEnabled()) return <PageSkeleton /> // the page is the unavailable state while the mock gate is closed (Task 23 opens it)
  return <LocationFormSkeleton />
}
