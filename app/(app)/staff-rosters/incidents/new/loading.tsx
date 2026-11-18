import { mockEnabled } from "@/lib/mock-registry"
import { IncidentForm, getRosters } from "@/features/staff-rosters"
import { PageSkeleton } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

// The real (empty) form rendered masked, so every field and wrapped hint matches the loaded page.
export default async function Loading() {
  if (!mockEnabled()) return <PageSkeleton /> // the page is the unavailable state: no seed to size a skeleton from
  const session = await getSkeletonSession()
  if (!can(session.role, "staff") || !canWrite(session, "staff")) return <PageSkeleton />
  const [{ incidents, staff }, org, user] = await Promise.all([getRosters(can(session.role, "staff", "write")), getMockOrg(), getSkeletonUser()])
  return (
    <SkMask label="Loading incident form">
      <IncidentForm incidents={incidents} staff={staff} today={org.today} tz={org.timezone} actor={user.name} scopeKey={`${session.tenant.id}:${session.role.id}`} />
    </SkMask>
  )
}
