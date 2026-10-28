import { ReportsSkeleton, getReportSeed } from "@/features/reports"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"
import { getOrg } from "@/lib/org"
import { PageSkeleton } from "@/features/shell"

// Async so the skeleton matches the role (staff: report card and own history; managers: board, review queue only when
// they can review, history with the owner column) and uses the real row counts. loading.tsx gets no params.
export default async function Loading() {
  const [session, org] = await Promise.all([getSession(), getOrg()])
  if (!can(session.role, "reports")) return <PageSkeleton />
  const { staff, seed } = await getReportSeed(session)
  const queue = seed.filter((r) => r.status === "submitted" || r.status === "resubmitted").length
  return <ReportsSkeleton staff={staff} canReview={!staff && canWrite(session, "reports")} depts={org.departments.length} queue={queue} rows={seed.length} />
}
