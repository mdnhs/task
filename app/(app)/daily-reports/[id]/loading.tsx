import { ReportPage, ReportPageSkeleton, getReportSeed } from "@/features/reports"
import { PageSkeleton, getUser } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { formatDate } from "@/lib/dates"
import { getOrg } from "@/lib/org"
import { can, canReview } from "@/lib/permissions"
import { lastSegment } from "@/lib/request-path"
import { canWrite, getSession } from "@/lib/session"

// Like /tasks/[ref]: the id comes from the pathname header proxy.ts sets, and the real report is rendered masked (SkMask).
// Unknown id: the typical-counts skeleton.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "reports")) return <PageSkeleton />
  const staff = session.role.home === "staff"
  const typical = <ReportPageSkeleton edit={staff && canWrite(session, "reports")} review={!staff && canReview(session.role, session.tenant.status)} />
  const id = await lastSegment("/daily-reports/")
  const [seed, org, user] = await Promise.all([getReportSeed(session), getOrg(), getUser()])
  if (!seed || !id || !seed.reports.some((r) => r.id === id)) return typical
  const me = seed.people.find((p) => p.id === seed.meId)?.name || user.name
  return (
    <SkMask label="Loading shift report">
      <ReportPage
        id={id}
        seed={seed}
        now={org.today}
        tz={org.timezone}
        tzLabel={org.tzLabel}
        canWrite={canWrite(session, "reports")}
        canReview={canReview(session.role, session.tenant.status)}
        me={me}
        tenantId={session.tenant.id}
        exportMeta={{ company: session.tenant.name, generated: `${formatDate(org.today)} · ${org.tzLabel}`, brand: session.tenant.brand }}
      />
    </SkMask>
  )
}
