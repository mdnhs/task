import { IncidentForm, getRosters } from "@/features/staff-rosters"
import { PageSkeleton, getUser } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// The real (empty) form rendered masked, so every field and wrapped hint matches the loaded page.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "staff") || !canWrite(session, "staff")) return <PageSkeleton />
  const [{ incidents, staff }, org, user] = await Promise.all([getRosters(can(session.role, "staff", "write")), getOrg(), getUser()])
  return (
    <SkMask label="Loading incident form">
      <IncidentForm incidents={incidents} staff={staff} today={org.today} tz={org.timezone} actor={user.name} scopeKey={`${session.tenant.id}:${session.role.id}`} />
    </SkMask>
  )
}
