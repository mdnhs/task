import { DashboardSkeleton, StaffDashboardSkeleton } from "@/features/dashboard"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { mockEnabled } from "@/lib/mock-registry"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1, ruling I9): no API, no session lookup. The TYPICAL manager home (the owner's: every card) or the staff home; the real page then replaces it, and a role with less access
// sees a small layout change, never a delay. The Today entry is the closed "chip" (the default until the user switches the automatic card on).
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "dashboard")) return <PageSkeleton />
  if (session.role.home !== "staff") {
    return <DashboardSkeleton today={{ mode: "chip", tiles: 5, team: true }} cards={4} teamRows={5} teamTotal={25} withCoverage={mockEnabled()} />
  }
  return <StaffDashboardSkeleton today={{ mode: "chip", tiles: 4, team: false }} />
}
