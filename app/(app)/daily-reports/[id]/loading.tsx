import { ReportPageSkeleton } from "@/features/reports"
import { PageSkeleton } from "@/features/shell"
import { can, canReview, canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1, ruling I9): no API, no session lookup, no id lookup. The typical report: the manager's review page (task table, notes, version history, tools and Return / Accept); a member's
// editor differs by a small layout change when the real page replaces it.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "reports")) return <PageSkeleton />
  return <ReportPageSkeleton edit={false} review={canReview(session.role, session.tenant.status) && canWrite(session, "reports")} />
}
