import { IncidentForm, getRosters } from "@/features/staff-rosters"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Log incident (was a dialog on /staff-rosters; long forms are pages). Same gate as the "Log incident" button: staff
// write access on an active tenant. Seeded like /staff-rosters (same data + scopeKey) so the new row shows there.
export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "staff") || !canWrite(session, "staff")) return <AccessRestricted moduleLabel="Staff & Rosters" />
  const { incidents, staff } = await getRosters(can(session.role, "staff", "write"))
  return <IncidentForm incidents={incidents} staff={staff} today={org.today} tz={org.timezone} actor={user.name} scopeKey={`${session.tenant.id}:${session.role.id}`} />
}
