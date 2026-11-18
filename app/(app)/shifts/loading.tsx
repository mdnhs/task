import { ShiftsSkeleton } from "@/features/shifts"
import { PageSkeleton } from "@/features/shell"
import { canWrite, shiftScope } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1, ruling I9): no API, no session lookup. The TYPICAL manager view: the week grid with a full page of people and the write controls; a staff member's own-shifts view differs by a
// small layout change when the real page replaces it.
export default async function Loading() {
  const session = await getSkeletonSession()
  const scope = shiftScope(session.role)
  if (scope === "none") return <PageSkeleton />
  return <ShiftsSkeleton canWrite={scope === "all" && canWrite(session, "shifts")} />
}
