import { MyRosterSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { mockEnabled } from "@/lib/mock-registry"

// Static (K1, I9): the typical My roster (calendar tab, a few shifts), no session and no API.
export default function Loading() {
  if (!mockEnabled()) return <PageSkeleton /> // the page is the unavailable state while the mock gate is closed (Task 23 opens it)
  return <MyRosterSkeleton />
}
