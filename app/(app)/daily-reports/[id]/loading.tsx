import { ReportFormSkeleton } from "@/features/reports"
import { PageSkeleton } from "@/features/shell"
import { can, canReview } from "@/lib/permissions"
import { getSession } from "@/lib/session"

// loading.tsx gets no route params and the template has a fixed 10 sections, so no data fetch: session only, like
// tasks/[ref]/loading.tsx. The "Needs attention" count is a typical value.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "reports")) return <PageSkeleton />
  // Manager-home roles are never the report owner, so they always get the read-only review layout.
  const review = session.role.home === "manager" ? (canReview(session.role, session.tenant.status) ? "reviewer" : "reader") : undefined
  // Staff can fill a draft from linked records, so their edit layout includes the suggestions banner.
  return <ReportFormSkeleton review={review} prefill={session.role.home === "staff"} />
}
