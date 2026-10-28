import { AuditView, getAuditEvents } from "@/features/audit"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "audit")) return <AccessRestricted moduleLabel="Audit Log" />
  const events = await getAuditEvents()
  return <AuditView events={events} today={org.today} tzLabel={org.tzLabel} user={{ name: user.name, role: user.role }} />
}
