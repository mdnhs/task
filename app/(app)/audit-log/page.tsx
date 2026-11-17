import { AuditView, getAuditEvents } from "@/features/audit"
import { AccessRestricted, getUser } from "@/features/shell"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getMockOrg(), getUser()])
  if (!can(session.role, "audit")) return <AccessRestricted moduleLabel="Audit Log" />
  const events = await getAuditEvents()
  return <AuditView events={events} today={org.today} tzLabel={org.tzLabel} user={{ name: user.name, role: user.role }} scopeKey={session.tenant.id} />
}
