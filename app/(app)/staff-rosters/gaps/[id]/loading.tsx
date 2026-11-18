import { mockEnabled } from "@/lib/mock-registry"
import { GapPage, GapPageSkeleton, getDerivedGaps, getRosters } from "@/features/staff-rosters"
import { PageSkeleton } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { lastSegment } from "@/lib/request-path"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

// Like /tasks/[ref]: the id comes from the pathname header proxy.ts sets, and the real gap is rendered masked (SkMask).
// Unknown id: the typical skeleton (the page then 404s).
export default async function Loading() {
  if (!mockEnabled()) return <PageSkeleton /> // the page is the unavailable state: no seed to size a skeleton from
  const session = await getSkeletonSession()
  if (!can(session.role, "staff")) return <PageSkeleton />
  const write = canWrite(session, "staff")
  const id = await lastSegment("/staff-rosters/gaps/")
  const sensitive = can(session.role, "staff", "write")
  const [org, user] = await Promise.all([getMockOrg(), getSkeletonUser()])
  const { gaps, staff } = await getRosters(sensitive, await getDerivedGaps(session, user.name, org.today))
  if (!id || !gaps.some((g) => g.id === id)) return <GapPageSkeleton canWrite={write} />
  return (
    <SkMask label="Loading roster gap">
      <GapPage id={id} gaps={gaps} staff={staff} today={org.today} tz={org.timezone} tzLabel={org.tzLabel} canWrite={write} sensitive={sensitive} actor={user.name} scopeKey={`${session.tenant.id}:${session.role.id}`} />
    </SkMask>
  )
}
