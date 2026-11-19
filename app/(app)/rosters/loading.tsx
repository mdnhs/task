import { RostersSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { mockEnabled } from "@/lib/mock-registry"

// Static (K1, ruling I9): no API, no session lookup. The TYPICAL week of one location with the write controls; a role with less access, or another roster, differs by a small layout change when
// the real page replaces it. While the page is the unavailable state (the mock gate is closed) a generic skeleton is shown.
export default function Loading() {
  if (!mockEnabled()) return <PageSkeleton />
  return <RostersSkeleton />
}
