import { GapPage, GapPageSkeleton, getRosters } from "@/features/staff-rosters"
import { PageSkeleton, getUser } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { lastSegment } from "@/lib/request-path"
import { canWrite, getSession } from "@/lib/session"

// Like /tasks/[ref]: the id comes from the pathname header proxy.ts sets, and the real gap is rendered masked (SkMask).
// Unknown id: the typical skeleton (the page then 404s).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "staff")) return <PageSkeleton />
  const write = canWrite(session, "staff")
  const id = await lastSegment("/staff-rosters/gaps/")
  const sensitive = can(session.role, "staff", "write")
  const [{ gaps, staff }, org, user] = await Promise.all([getRosters(sensitive), getOrg(), getUser()])
  if (!id || !gaps.some((g) => g.id === id)) return <GapPageSkeleton canWrite={write} />
  return (
    <SkMask label="Loading roster gap">
      <GapPage id={id} gaps={gaps} staff={staff} today={org.today} tz={org.timezone} tzLabel={org.tzLabel} canWrite={write} sensitive={sensitive} actor={user.name} scopeKey={`${session.tenant.id}:${session.role.id}`} />
    </SkMask>
  )
}
