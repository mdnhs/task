import { StaffRostersSkeleton, getRosters } from "@/features/staff-rosters"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton uses the real row count and the role's controls (loading.tsx gets no params).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "staff")) return <PageSkeleton />
  const { incidents } = await getRosters(false)
  return <StaffRostersSkeleton rows={incidents.length} canWrite={canWrite(session, "staff")} />
}
