import { StaffRostersView, getRosters } from "@/features/staff-rosters"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "staff")) return <AccessRestricted moduleLabel="Staff & Rosters" />
  // Contact details and notes are sensitive (FR-STAFF-03): only roles with staff write access receive them.
  const sensitive = can(session.role, "staff", "write")
  const { incidents, gaps, staff } = await getRosters(sensitive)
  return (
    <StaffRostersView
      incidents={incidents}
      gaps={gaps}
      staff={staff}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "staff")}
      sensitive={sensitive}
      actor={user.name}
      scopeKey={`${session.tenant.id}:${session.role.id}`}
    />
  )
}
