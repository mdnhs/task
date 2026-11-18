import { REPORT_PAGE_SIZE, ReportsSkeleton } from "@/features/reports"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1, ruling I9): no API, no session lookup. The TYPICAL manager inbox (the owner's scope: team select, person column, a full first page with "Load more"); the member's view and a
// shorter list differ by a small layout change when the real page replaces it.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "reports")) return <PageSkeleton />
  return <ReportsSkeleton own={false} rows={REPORT_PAGE_SIZE} teams={2} />
}
